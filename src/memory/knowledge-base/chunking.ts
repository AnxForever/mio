/**
 * Mio — recursive character text splitter for the knowledge base.
 *
 * Borrowed from AstrBot's recursive chunker: split by a priority list of
 * separators, recurse into oversized pieces, then merge adjacent pieces up to
 * chunkSize with a sliding overlap. Multilingual separators (CJK + latin).
 */

export interface Chunk {
  index: number;
  text: string;
}

export interface ChunkOptions {
  /** Target max characters per chunk (default 500). */
  chunkSize?: number;
  /** Characters of overlap carried from the previous chunk (default 60). */
  overlap?: number;
}

const SEPARATORS = ['\n\n', '\n', '。', '！', '？', '. ', '! ', '? ', '；', ';', '，', ',', ' ', ''];

/** Split text by the first applicable separator, recursing into oversized pieces. */
function splitRecursive(text: string, seps: string[], chunkSize: number): string[] {
  if (text.length <= chunkSize) return text.length > 0 ? [text] : [];
  const [sep, ...rest] = seps;
  if (sep === undefined) return [text]; // no separators left — emit as-is
  if (sep === '') {
    // hard split on size as the last resort
    const out: string[] = [];
    for (let i = 0; i < text.length; i += chunkSize) out.push(text.slice(i, i + chunkSize));
    return out;
  }
  const parts = text.split(sep);
  if (parts.length === 1) return splitRecursive(text, rest, chunkSize); // separator absent → next
  const out: string[] = [];
  for (const part of parts) {
    const piece = part + sep; // keep the separator to preserve readability
    if (piece.length <= chunkSize) {
      if (piece.trim()) out.push(piece);
    } else {
      out.push(...splitRecursive(part, rest, chunkSize));
    }
  }
  return out;
}

/** Merge small adjacent pieces up to chunkSize, carrying `overlap` chars between chunks. */
function mergeWithOverlap(pieces: string[], chunkSize: number, overlap: number): string[] {
  const chunks: string[] = [];
  let cur = '';
  for (const p of pieces) {
    if (cur === '' || cur.length + p.length <= chunkSize) {
      cur += p;
    } else {
      chunks.push(cur.trim());
      const tail = overlap > 0 ? cur.slice(-overlap) : '';
      cur = tail + p;
    }
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks;
}

/**
 * Split free text into overlapping chunks suitable for embedding.
 * Returns [] for empty/whitespace input.
 */
export function chunkText(text: string, opts: ChunkOptions = {}): Chunk[] {
  const chunkSize = opts.chunkSize ?? 500;
  const overlap = Math.min(opts.overlap ?? 60, Math.floor(chunkSize / 2));
  const clean = text.trim();
  if (!clean) return [];
  const pieces = splitRecursive(clean, SEPARATORS, chunkSize);
  const merged = mergeWithOverlap(pieces, chunkSize, overlap);
  return merged.map((t, index) => ({ index, text: t }));
}
