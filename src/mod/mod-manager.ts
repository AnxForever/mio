/**
 * Mio — Mod Manager
 *
 * Manages persona mods. Scans the mods/ directory for any mod that has a
 * soul.md file — both built-in (male/female) and custom characters.
 */

import { existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { modSoulPath, colaDir } from '../memory/paths.js';
import { readFileSyncSafe, writeFileSyncSafe, readBankSoul, writeBankSoul } from '../memory/bank.js';
import { logger } from '../utils/logger.js';

/** Active mod persistence file */
const MOD_STATE_FILE = join(colaDir(), 'mods', '.active-mod');

/**
 * ModManager — scans mods/ directory for any persona with a soul.md.
 * Built-in: male, female. Custom: any character created via Character Factory.
 */
export class ModManager {
  private activeModName: string;

  constructor() {
    this.activeModName = this.loadPersistedMod() ?? this.firstAvailable() ?? 'female';
  }

  /** Currently active mod name */
  get activeMod(): string {
    return this.activeModName;
  }

  /** List all mods that have a soul.md file */
  listMods(): string[] {
    const modsDir = join(colaDir(), 'mods');
    if (!existsSync(modsDir)) return [];

    try {
      return readdirSync(modsDir, { withFileTypes: true })
        .filter(e => e.isDirectory() && !e.name.startsWith('.'))
        .filter(e => existsSync(modSoulPath(e.name)))
        .map(e => e.name);
    } catch {
      return [];
    }
  }

  /** Check if a mod exists (has a soul.md) */
  isValidMod(name: string): boolean {
    return existsSync(modSoulPath(name));
  }

  /** First available mod, or null */
  private firstAvailable(): string | null {
    const mods = this.listMods();
    // Prefer female as default
    if (mods.includes('female')) return 'female';
    if (mods.includes('male')) return 'male';
    return mods[0] || null;
  }

  /**
   * Switch to a different mod.
   * Accepts any mod name that has a soul.md file.
   */
  async switchMod(name: string): Promise<void> {
    if (!this.isValidMod(name)) {
      throw new Error(
        `Invalid mod: "${name}". Available: ${this.listMods().join(', ') || '(none)'}`,
      );
    }

    const old = this.activeModName;
    this.flushBankSoulToMod(old);
    this.loadModSoulIntoBank(name);
    this.activeModName = name;
    this.persistActiveMod();
    logger.info(`[mod] switched: ${old} → ${name}`);
  }

  /** Flush bank working copy back to source mod soul.md */
  private flushBankSoulToMod(modName: string): void {
    if (!modName || !this.isValidMod(modName)) return;
    const bankSoul = readBankSoul();
    if (!bankSoul) return;
    writeFileSyncSafe(modSoulPath(modName), bankSoul);
  }

  /** Load mod soul.md into bank working copy */
  private loadModSoulIntoBank(modName: string): void {
    const content = readFileSyncSafe(modSoulPath(modName));
    writeBankSoul(content);
  }

  /** Refresh bank soul from current mod (called after nightly consolidation) */
  async refreshBankSoul(): Promise<void> {
    this.loadModSoulIntoBank(this.activeModName);
  }

  /** Get current mod's soul content for prompt assembly */
  getCurrentSoulContent(): string {
    const bank = readBankSoul();
    if (bank) return bank;
    return readFileSyncSafe(modSoulPath(this.activeModName));
  }

  /** Get a specific mod's soul content without switching */
  getAgentContentForMod(modName: string): string {
    return readFileSyncSafe(modSoulPath(modName));
  }

  private loadPersistedMod(): string | null {
    const v = readFileSyncSafe(MOD_STATE_FILE).trim();
    return v || null;
  }

  private persistActiveMod(): void {
    writeFileSyncSafe(MOD_STATE_FILE, this.activeModName);
  }
}

/** Singleton */
let _instance: ModManager | null = null;
export function modManager(): ModManager {
  if (!_instance) _instance = new ModManager();
  return _instance;
}
