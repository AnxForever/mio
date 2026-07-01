/**
 * Mio — 夜间记忆整合调度器（适配自 cola-companion）
 *
 * 关键改动：
 * - 使用 Mio 的 paths 与 types（StreamingProvider / SessionContext）
 * - 整合后额外检查关系晋升 checkProgression()
 * - cron: 30 21 * * *，120 分钟 jitter + 漏跑补跑
 * - 可选 3-phase consolidation (feature-gated)
 *
 * Pipeline (standard):
 * snapshot bank → runConsolidation → refreshBankSoul
 * → checkProgression → runDiary → clearBookmarks
 * → cleanOldSnapshots → checkpoint
 *
 * Pipeline (3-phase):
 * snapshot bank → runFullConsolidation (Phase1→Phase2→Phase3)
 * → refreshBankSoul → checkProgression → runDiary
 * → clearBookmarks → cleanOldSnapshots → checkpoint
 */

import { Cron } from 'croner';
import { logger } from '../utils/logger.js';
import { runConsolidation } from '../subagent/consolidate.js';
import { runDiary } from '../subagent/diary.js';
import { modManager } from '../mod/mod-manager.js';
import { selectProvider } from '../providers/index.js';
import {
  snapshotBank,
  cleanOldSnapshots,
  clearBookmarks,
  readConsolidateCheckpoint,
  writeConsolidateCheckpoint,
  ensureBankStructure,
} from '../memory/bank.js';
import { checkProgression } from '../relationship/progression.js';
import { autoGenerateLoreEntries } from '../memory/lorebook.js';
import { getConfig } from '../config.js';
import { runConsistencyCheck, getSteeringHints, clearCachedHints } from '../memory/judge.js';
import { runExperienceTraitCycle } from '../emotion/experience-trait.js';
import { invalidatePADCache } from '../emotion/pad.js';
import {
  readEntityGraph,
  writeEntityGraph,
  extractRelations,
  mergeEntityGraph,
  getRelationContext,
} from '../memory/entity-graph.js';
import { readStructuredMemoryFromDisk } from '../memory/structured-memory.js';
import type { StreamingProvider, SessionContext } from '../types.js';

/** 默认 cron 表达式：每天 21:30 本地时间 */
const DEFAULT_CRON = '30 21 * * *';
/** jitter 上限：120 分钟 */
const JITTER_MAX_MS = 120 * 60 * 1000;

let schedulerInstance: NightlyScheduler | null = null;

/**
 * NightlyScheduler — 夜间记忆整合调度器
 *
 * 负责：cron 注册、jitter 延迟、漏跑补跑、完整整合 pipeline。
 */
export class NightlyScheduler {
  private cronJob?: Cron;
  private provider: StreamingProvider;
  private ctx?: Partial<SessionContext>;
  private cronExpr: string;
  private enabled: boolean;

  constructor(provider?: StreamingProvider, ctx?: Partial<SessionContext>) {
    const config = getConfig();
    this.provider = (provider ??
      selectProvider(config.provider, ctx?.model ?? config.model, config.features.providerFallback)) as StreamingProvider;
    this.ctx = ctx;
    this.cronExpr = process.env.MIO_NIGHTLY_CRON ?? config.nightlyCron ?? DEFAULT_CRON;
    this.enabled = process.env.MIO_NIGHTLY_ENABLED !== 'false';
  }

  /**
   * 注册 cron 调度。
   * 启动时自动检查漏跑。
   */
  start(): void {
    if (!this.enabled) {
      logger.info('[nightly] disabled by config');
      return;
    }
    if (this.cronJob) return;

    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    this.cronJob = new Cron(this.cronExpr, { timezone: tz }, () => {
      // jitter：最多 120 分钟随机延迟，分散负载
      const jitter = Math.floor(Math.random() * JITTER_MAX_MS);
      logger.info(`[nightly] cron fired, jittering ${Math.round(jitter / 60000)}min`);
      setTimeout(() => {
        this.runTonight().catch((err) => {
          logger.error('[nightly] run failed', { err: String(err) });
        });
      }, jitter);
    });

    // 启动时检查漏跑
    this.catchUp().catch((err) => {
      logger.error('[nightly] catch-up failed', { err: String(err) });
    });

    logger.info(`[nightly] scheduled: ${this.cronExpr} (${tz})`);
  }

  /** 停止调度 */
  stop(): void {
    this.cronJob?.stop();
    this.cronJob = undefined;
  }

  /**
   * 漏跑检查：启动时补跑昨天之前未整合的天。
   * 仅补最近 1-3 天内漏跑的一天。
   */
  async catchUp(): Promise<void> {
    const last = readConsolidateCheckpoint();
    const today = formatDate(new Date());
    if (last === today) return; // 今天已跑
    if (last) {
      const lastDate = new Date(last);
      const daysAgo = Math.floor((Date.now() - lastDate.getTime()) / 86400000);
      if (daysAgo >= 1 && daysAgo <= 3) {
        logger.info(`[nightly] catch-up: last consolidate was ${last}, running for ${today}`);
        await this.runTonight();
      }
    } else {
      // 从未跑过，立即执行一次
      logger.info('[nightly] catch-up: no checkpoint found, running initial consolidation');
      await this.runTonight();
    }
  }

  /**
   * 夜间整合主流程。
   *
   * Pipeline:
   * 1. ensureBankStructure
   * 2. snapshotBank — before-state 快照
   * 3. runConsolidation — bank-consolidate 子 agent
   * 4. refreshBankSoul — 刷新工作副本
   * 5. checkProgression — 关系阶段晋升检查（Mio 扩展）
   * 6. runDiary — diary 子 agent
   * 7. clearBookmarks — 清空当日书签
   * 8. cleanOldSnapshots — 清理旧快照
   * 9. writeConsolidateCheckpoint — 推进 checkpoint
   */
  async runTonight(targetDate?: Date): Promise<void> {
    const date = targetDate ?? new Date();
    const today = formatDate(date);
    logger.info(`[nightly] starting consolidation for ${today}`);

    // 1. 确保目录结构
    ensureBankStructure();

    // 2. 找当天 scopeKey
    const scopeKey = today;

    // 3. before-state 快照
    snapshotBank(today);
    logger.info(`[nightly] snapshot created for ${today}`);

    // 4. 跑 consolidate（标准模式或 3-phase 模式）
    const config = getConfig();
    if (config.features.threePhaseConsolidation) {
      // 3-phase consolidation: LIGHT → DEEP → REM
      logger.info('[nightly] using 3-phase consolidation');
      const { runFullConsolidation } = await import('../memory/consolidation-phases.js');
      const report = await runFullConsolidation();
      logger.info(`[nightly] 3-phase done: P1(${report.phase1.selectedCount}/${report.phase1.totalBookmarks}) P2(${report.phase2.changes.length} changes) P3(${report.phase3.rulesGenerated} rules)`);

      // Log top changes
      const topChanges = report.phase2.changes.slice(0, 3);
      for (const c of topChanges) {
        logger.info(`[nightly]   → ${c.target}: ${c.summary.slice(0, 60)}`);
      }
    } else {
      // Standard single-pass consolidation (backward compat)
      const consolidateResult = await runConsolidation(
        today,
        scopeKey,
        this.provider,
        this.ctx,
      );
      logger.info(`[nightly] consolidate done: ${consolidateResult.slice(0, 100)}`);
    }

    // 5. refreshBankSoul — 刷新工作副本
    await modManager().refreshBankSoul();
    logger.info('[nightly] bank soul refreshed');

    // 6. checkProgression — 关系阶段晋升检查（Mio 扩展）
    const progressed = checkProgression();
    if (progressed) {
      logger.info('[nightly] relationship stage advanced');
    }

    // 6a. Auto-generate lore entries from high-confidence durable facts
    if (getConfig().features.lorebook) {
      autoGenerateLoreEntries();
      logger.info('[nightly] lorebook auto-generated');
    }

    // 7. 跑 diary
    const diaryResult = await runDiary(today, scopeKey, this.provider, this.ctx);
    logger.info(`[nightly] diary done: ${diaryResult.slice(0, 100)}`);

    // 7a. LLM-as-Judge consistency check (zero LLM calls — pure pattern matching)
    if (getConfig().features.llmJudge) {
      try {
        const judgeReport = runConsistencyCheck();
        logger.info(`[nightly] consistency check: score=${judgeReport.score}/100, issues=${judgeReport.issues.length}`);
        if (judgeReport.issues.length > 0) {
          for (const issue of judgeReport.issues.slice(0, 3)) {
            logger.info(`[nightly]   → [${issue.severity}] ${issue.description.slice(0, 80)}`);
          }
        }
      } catch (err) {
        logger.error('[nightly] consistency check failed', { err: String(err) });
      }
    }

    // 7b. Experience-to-trait feedback cycle
    if (getConfig().features.experienceTraitFeedback) {
      try {
        const experienceProfile = runExperienceTraitCycle();
        if (experienceProfile) {
          logger.info(`[nightly] experience-trait: ${experienceProfile.total} exchanges classified`);
          // Experience-trait shifts write pad-config.json via updateTraitState.
          // writePADConfig already refreshes the in-memory cache, but invalidate
          // defensively so the next read reloads from disk in case any other path
          // (or an external edit) touched the file.
          invalidatePADCache();
        }
      } catch (err) {
        logger.error('[nightly] experience-trait cycle failed', { err: String(err) });
      }
    }

    // 7c. Entity-relation graph extraction
    if (getConfig().features.entityRelationGraph) {
      try {
        const structured = readStructuredMemoryFromDisk();
        if (structured && structured.durableFacts.length > 0) {
          const relations = extractRelations(structured);
          if (relations.length > 0) {
            mergeEntityGraph(relations);
            const context = getRelationContext();
            logger.info(`[nightly] entity-graph: ${relations.length} relations extracted (${context})`);
          }
        }
      } catch (err) {
        logger.error('[nightly] entity-graph extraction failed', { err: String(err) });
      }
    }

    // 8. 清空 BOOKMARKS（仅当 diary 已写入）
    clearBookmarks();
    logger.info('[nightly] bookmarks cleared');

    // 9. 清理旧快照（保留最近 7 天）
    cleanOldSnapshots(7);

    // 10. 推进 checkpoint
    writeConsolidateCheckpoint(today);
    logger.info(`[nightly] consolidation complete for ${today}`);
  }

  /** 手动触发夜间整合 */
  async triggerNow(): Promise<void> {
    await this.runTonight();
  }
}

/**
 * 全局单例工厂。
 * 首次调用时创建实例，后续调用返回同一实例。
 */
export function nightlyScheduler(
  provider?: StreamingProvider,
  ctx?: Partial<SessionContext>,
): NightlyScheduler {
  if (!schedulerInstance) {
    schedulerInstance = new NightlyScheduler(provider, ctx);
  }
  return schedulerInstance;
}

/** 格式化日期 YYYY-MM-DD */
function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
