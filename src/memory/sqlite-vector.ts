/**
 * Mio — SQLite + sqlite-vec backend for the vector memory store (U2).
 *
 * Replaces the JSONL-file index with a SQLite database (memory-bank/vector.db),
 * eliminating two scaling problems of the old format:
 *   - Write amplification: the old writeEntry rewrote the entire index file on
 *     every single insert. SQLite does an O(1) UPSERT.
 *   - O(n) dense search: the old search decoded and scored every dense vector
 *     in memory. sqlite-vec's vec0 virtual table does approximate KNN.
 *
 * Dual-format handling (mirrors vector.ts):
 *   - dense (minimax, 1536-dim Float32): stored as a BLOB in `entries` AND in
 *     the `vec_dense` vec0 virtual table for KNN. Distance is L2; since MiniMax
 *     vectors are L2-normalized, cosine = 1 - d^2/2.
 *   - sparse (tf, variable-length Record<string,number>): stored as JSON text
 *     in `entries`. sqlite-vec can't index variable sparse vectors, so search
 *     falls back to application-level cosine — but storage no longer rewrites
 *     the whole file per insert.
 *
 * The public vector.ts API delegates here; callers are unaffected.
 */

import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { join } from 'node:path';
import { getDataDir } from '../config.js';
import type { SparseVector } from './embedding.js';

// ─── Types ───

/** A stored vector record. `embedding` is sparse (object) or dense (Float32Array). */
export interface SqliteVectorEntry {
  id: string;
  text: string;
  source: string;
  timestamp: string;
  embeddingType: 'tf' | 'minimax';
  embedding: SparseVector | Float32Array;
}

export interface ScoredSqliteEntry extends SqliteVectorEntry {
  score: number;
}

interface EntryRow {
  id: string;
  text: string;
  source: string;
  timestamp: string;
  embedding_type: 'tf' | 'minimax';
  embedding: Buffer;
}

// ─── Database singleton ───

let _db: Database.Database | null = null;
let _dbPath: string | null = null;

function dbPath(): string {
  return join(getDataDir(), 'memory-bank', 'vector.db');
}

/**
 * Open (or create) the database, load sqlite-vec, and ensure the schema.
 * Re-opens if the data directory changed (tests switch MIO_DIR per-case).
 */
function getDb(): Database.Database {
  const path = dbPath();
  if (_db && _dbPath === path) return _db;
  if (_db) {
    try { _db.close(); } catch { /* ignore */ }
    _db = null;
  }
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  sqliteVec.load(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS entries (
      id             TEXT PRIMARY KEY,
      text           TEXT NOT NULL,
      source         TEXT NOT NULL,
      timestamp      TEXT,
      embedding_type TEXT NOT NULL,
      embedding      BLOB NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_entries_source ON entries(source);
    CREATE INDEX IF NOT EXISTS idx_entries_type   ON entries(embedding_type);
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
  `);
  _db = db;
  _dbPath = path;
  return db;
}

/** Close the DB (used by tests between data dirs). */
export function closeDb(): void {
  if (_db) {
    try { _db.close(); } catch { /* ignore */ }
    _db = null;
    _dbPath = null;
  }
}

/**
 * Lazily create the dense KNN table once we know the embedding dimension.
 * vec0 tables require a fixed dimension at creation time, so we record it in
 * `meta` and create the virtual table on the first dense insert.
 */
function ensureDenseTable(db: Database.Database, dim: number): void {
  const row = db.prepare("SELECT value FROM meta WHERE key = 'dense_dim'").get() as { value: string } | undefined;
  if (row) return;
  db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS vec_dense USING vec0(embedding float[${dim}])`);
  db.prepare("INSERT OR REPLACE INTO meta(key, value) VALUES ('dense_dim', ?)").run(String(dim));
}

function hasDenseTable(db: Database.Database): boolean {
  return !!db.prepare("SELECT value FROM meta WHERE key = 'dense_dim'").get();
}

// ─── Serialization ───

function denseToBlob(v: Float32Array): Buffer {
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
}

function blobToDense(b: Buffer): Float32Array {
  const out = new Float32Array(b.byteLength / 4);
  Buffer.from(out.buffer).set(b);
  return out;
}

function sparseToBlob(v: SparseVector): Buffer {
  return Buffer.from(JSON.stringify(v), 'utf8');
}

function blobToSparse(b: Buffer): SparseVector {
  return JSON.parse(b.toString('utf8')) as SparseVector;
}

function rowToEntry(row: EntryRow): SqliteVectorEntry {
  const embedding = row.embedding_type === 'minimax'
    ? blobToDense(row.embedding)
    : blobToSparse(row.embedding);
  return {
    id: row.id,
    text: row.text,
    source: row.source,
    timestamp: row.timestamp,
    embeddingType: row.embedding_type,
    embedding,
  };
}

// ─── Writes ───

/**
 * Insert or replace a single entry by id. Keeps the SQLite rowid stable across
 * updates so the dense KNN table stays in sync. O(1) — no full-file rewrite.
 */
export function upsertEntry(entry: SqliteVectorEntry): void {
  const db = getDb();
  const isDense = entry.embeddingType === 'minimax';
  const blob = isDense
    ? denseToBlob(entry.embedding as Float32Array)
    : sparseToBlob(entry.embedding as SparseVector);

  const existing = db.prepare('SELECT rowid FROM entries WHERE id = ?').get(entry.id) as { rowid: number } | undefined;
  let rowid: number;
  if (existing) {
    rowid = existing.rowid;
    db.prepare(
      'UPDATE entries SET text=?, source=?, timestamp=?, embedding_type=?, embedding=? WHERE rowid=?',
    ).run(entry.text, entry.source, entry.timestamp, entry.embeddingType, blob, rowid);
    // Drop any stale dense row for this rowid (type may have changed).
    if (hasDenseTable(db)) db.prepare('DELETE FROM vec_dense WHERE rowid=?').run(BigInt(rowid));
  } else {
    const info = db.prepare(
      'INSERT INTO entries(id, text, source, timestamp, embedding_type, embedding) VALUES (?,?,?,?,?,?)',
    ).run(entry.id, entry.text, entry.source, entry.timestamp, entry.embeddingType, blob);
    rowid = Number(info.lastInsertRowid);
  }

  if (isDense) {
    const arr = entry.embedding as Float32Array;
    ensureDenseTable(db, arr.length);
    // vec0 virtual tables reject INSERT OR REPLACE; the update path above already
    // DELETEs the stale dense row, so a plain INSERT is correct and conflict-free.
    // vec0 rowid must be bound as a BigInt (INTEGER64) — a plain JS number is rejected.
    db.prepare('INSERT INTO vec_dense(rowid, embedding) VALUES (?, ?)').run(BigInt(rowid), denseToBlob(arr));
  }
}

/** Upsert many entries in a single transaction (used by reindex / migration). */
export function upsertBatch(entries: SqliteVectorEntry[]): void {
  const db = getDb();
  const tx = db.transaction((rows: SqliteVectorEntry[]) => {
    for (const e of rows) upsertEntry(e);
  });
  tx(entries);
}

/** Delete all entries of a given source (e.g. 'bookmark') plus their dense rows. */
export function deleteBySource(source: string): void {
  const db = getDb();
  if (hasDenseTable(db)) {
    db.prepare(
      'DELETE FROM vec_dense WHERE rowid IN (SELECT rowid FROM entries WHERE source = ?)',
    ).run(source);
  }
  db.prepare('DELETE FROM entries WHERE source = ?').run(source);
}

/** Delete one entry by id plus its dense row if present. */
export function deleteById(id: string): boolean {
  const db = getDb();
  const row = db.prepare('SELECT rowid FROM entries WHERE id = ?').get(id) as { rowid: number } | undefined;
  if (!row) return false;
  if (hasDenseTable(db)) {
    db.prepare('DELETE FROM vec_dense WHERE rowid = ?').run(BigInt(row.rowid));
  }
  db.prepare('DELETE FROM entries WHERE id = ?').run(id);
  return true;
}

// ─── Reads ───

/** All entries, materialized. */
export function readAll(): SqliteVectorEntry[] {
  const db = getDb();
  const rows = db.prepare('SELECT id, text, source, timestamp, embedding_type, embedding FROM entries').all() as EntryRow[];
  return rows.map(rowToEntry);
}

/** All bookmark entries (for incremental reindex dedup). */
export function readBookmarkIds(): Set<string> {
  const db = getDb();
  const rows = db.prepare("SELECT id FROM entries WHERE source = 'bookmark'").all() as { id: string }[];
  return new Set(rows.map((r) => r.id));
}

/** Distinct embedding types currently present among bookmark entries. */
export function bookmarkEmbeddingTypes(): Set<string> {
  const db = getDb();
  const rows = db.prepare("SELECT DISTINCT embedding_type AS t FROM entries WHERE source = 'bookmark'").all() as { t: string }[];
  return new Set(rows.map((r) => r.t));
}

export function count(): number {
  const db = getDb();
  const row = db.prepare('SELECT COUNT(*) AS n FROM entries').get() as { n: number };
  return row.n;
}

export function stats(): { entries: number; sources: Record<string, number>; types: Record<string, number> } {
  const db = getDb();
  const sources: Record<string, number> = {};
  const types: Record<string, number> = {};
  for (const r of db.prepare('SELECT source, COUNT(*) AS n FROM entries GROUP BY source').all() as { source: string; n: number }[]) {
    sources[r.source] = r.n;
  }
  for (const r of db.prepare('SELECT embedding_type AS t, COUNT(*) AS n FROM entries GROUP BY embedding_type').all() as { t: string; n: number }[]) {
    types[r.t] = r.n;
  }
  return { entries: count(), sources, types };
}

// ─── Dense KNN search ───

/**
 * KNN over dense (minimax) vectors via sqlite-vec. Returns cosine scores.
 *
 * sqlite-vec's default metric is L2 distance. MiniMax vectors are L2-normalized,
 * so for unit vectors cosine = 1 - d^2/2. We over-fetch then map to cosine.
 */
export function searchDense(queryVec: Float32Array, limit: number, minScore: number): ScoredSqliteEntry[] {
  const db = getDb();
  if (!hasDenseTable(db)) return [];
  const rows = db.prepare(`
    SELECT e.id, e.text, e.source, e.timestamp, e.embedding_type, e.embedding, v.distance AS distance
    FROM vec_dense v
    JOIN entries e ON e.rowid = v.rowid
    WHERE v.embedding MATCH ? AND k = ?
    ORDER BY v.distance
  `).all(denseToBlob(queryVec), limit) as (EntryRow & { distance: number })[];

  const scored: ScoredSqliteEntry[] = [];
  for (const r of rows) {
    const score = 1 - (r.distance * r.distance) / 2;
    if (score >= minScore) scored.push({ ...rowToEntry(r), score });
  }
  return scored;
}

/** Read all sparse (tf) entries for application-level cosine scoring. */
export function readSparse(): SqliteVectorEntry[] {
  const db = getDb();
  const rows = db.prepare("SELECT id, text, source, timestamp, embedding_type, embedding FROM entries WHERE embedding_type = 'tf'").all() as EntryRow[];
  return rows.map(rowToEntry);
}
