// mod/mod-manager.ts — MOD 人格切换系统（适配自 cola-companion）
// 关键变更：不扫描 mods/ 目录，显式支持 boyfriend 和 girlfriend 两个 MOD

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { modSoulPath, colaDir } from '../memory/paths.js';
import { readFileSyncSafe, writeFileSyncSafe, readBankSoul, writeBankSoul } from '../memory/bank.js';
import type { ModDef, Gender } from '../types.js';

/** 活跃 MOD 持久化文件 */
const MOD_STATE_FILE = join(colaDir(), 'mods', '.active-mod');

/** 合法 MOD 列表 */
const VALID_MODS: Gender[] = ['boyfriend', 'girlfriend'];

/**
 * ModManager — 人格 MOD 管理器
 * 显式支持 boyfriend / girlfriend 两个人格 MOD
 */
export class ModManager {
  private activeModName: string;

  constructor() {
    this.activeModName = this.loadPersistedMod() ?? 'girlfriend';
  }

  /** 当前激活的 MOD 名 */
  get activeMod(): string {
    return this.activeModName;
  }

  /** 列出所有可用 MOD（boyfriend + girlfriend） */
  listMods(): ModDef[] {
    return VALID_MODS.map((name) => ({
      name,
      soulPath: modSoulPath(name),
      fixed: false, // 两个人格均可被夜间整合演化
    }));
  }

  /** 检查 MOD 是否有 persona 文件 */
  modHasPersonaFile(name: string): boolean {
    return existsSync(modSoulPath(name));
  }

  /**
   * switchMod — 切换 MOD
   * 1. 验证名称为 boyfriend/girlfriend 2. 检查 persona 文件
   * 3. swapBankSoul(旧→新) 4. 更新 activeMod 5. 持久化
   */
  async switchMod(name: string): Promise<void> {
    if (!isValidModName(name)) {
      throw new Error(`Invalid MOD name: "${name}". Only 'boyfriend' and 'girlfriend' are supported.`);
    }
    if (!this.modHasPersonaFile(name)) {
      throw new Error(`MOD "${name}" has no soul.md persona file at ${modSoulPath(name)}`);
    }
    const old = this.activeModName;
    await this.swapBankSoul(old, name);
    this.activeModName = name;
    this.persistActiveMod();
  }

  /**
   * swapBankSoul — 切换 bank soul 工作副本
   * 1. flushBankSoulToMod(oldMod)：bank soul.md -> mods/<oldMod>/soul.md（回写工作副本修改）
   * 2. loadModSoulIntoBank(newMod)：mods/<newMod>/soul.md -> bank soul.md（加载新 MOD persona）
   */
  async swapBankSoul(oldMod: string, newMod: string): Promise<void> {
    this.flushBankSoulToMod(oldMod);
    this.loadModSoulIntoBank(newMod);
  }

  /** flushBankSoulToMod — 把 bank 工作副本回写到源 MOD soul.md */
  flushBankSoulToMod(modName: string): void {
    const bankSoul = readBankSoul();
    if (!bankSoul) return;
    writeFileSyncSafe(modSoulPath(modName), bankSoul);
  }

  /** loadModSoulIntoBank — 从源 MOD soul.md 加载到 bank 工作副本 */
  loadModSoulIntoBank(modName: string): void {
    const content = readFileSyncSafe(modSoulPath(modName));
    writeBankSoul(content);
  }

  /**
   * refreshBankSoul — 从当前 MOD 重新加载到 bank 工作副本
   * 在夜间整合完成后调用
   */
  async refreshBankSoul(): Promise<void> {
    this.loadModSoulIntoBank(this.activeModName);
  }

  /** 获取当前 MOD 的 soul 内容（用于 prompt 组装） */
  getCurrentSoulContent(): string {
    // 优先读 bank 工作副本（可能被运行时修改），fallback 到源 MOD
    const bank = readBankSoul();
    if (bank) return bank;
    return readFileSyncSafe(modSoulPath(this.activeModName));
  }

  /** 获取指定 MOD 的 soul 内容（不切换） */
  getAgentContentForMod(modName: string): string {
    return readFileSyncSafe(modSoulPath(modName));
  }

  /** 加载持久化的 active MOD 名 */
  private loadPersistedMod(): string | null {
    const v = readFileSyncSafe(MOD_STATE_FILE).trim();
    return v || null;
  }

  /** 持久化当前 active MOD 名 */
  private persistActiveMod(): void {
    writeFileSyncSafe(MOD_STATE_FILE, this.activeModName);
  }
}

/** MOD 名校验：仅允许 boyfriend / girlfriend */
function isValidModName(name: string): boolean {
  return VALID_MODS.includes(name as Gender);
}

/** 全局单例 */
let _instance: ModManager | null = null;
export function modManager(): ModManager {
  if (!_instance) _instance = new ModManager();
  return _instance;
}
