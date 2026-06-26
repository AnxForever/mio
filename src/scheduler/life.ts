/**
 * Mio — Life Scheduler
 *
 * Cron-driven scheduler for the autonomous life engine.
 * Fires every 3 hours with random jitter (0-30 min).
 *
 * Follows the same pattern as NightlyScheduler and ProactiveScheduler.
 */

import { Cron } from 'croner';
import { lifeEngine } from '../character/life-engine.js';
import { ensureActiveCharacter, readActiveCharacter } from '../character/factory.js';
import { appendBookmark } from '../memory/bank.js';
import { updatePAD, getPADState } from '../emotion/pad.js';
import { getConfig } from '../config.js';
import { logger } from '../utils/logger.js';

export class LifeScheduler {
  private cronJob: Cron | null = null;
  private running = false;

  start(): void {
    if (this.running) return;
    if (!getConfig().features.lifeEngine) {
      logger.info('[life-scheduler] disabled by config');
      return;
    }

    const active = ensureActiveCharacter();
    if (!active) {
      logger.info('[life-scheduler] no active character, skipping');
      return;
    }

    // Fire every 3 hours with jitter
    this.cronJob = new Cron('0 */3 * * *', {}, () => {
      const jitter = Math.floor(Math.random() * 30 * 60 * 1000); // 0-30 min
      setTimeout(async () => {
        const name = readActiveCharacter() || ensureActiveCharacter();
        if (!name) return;

        const event = await lifeEngine().tick(name).catch(() => null);
        if (event) {
          // Apply PAD impact
          try {
            updatePAD({
              pleasure: event.emotionalImpact.pleasure,
              arousal: event.emotionalImpact.arousal,
              dominance: event.emotionalImpact.dominance,
            });
          } catch {
            // PAD might not be initialized yet
          }

          // Bookmark for nightly consolidation
          appendBookmark({
            time: event.timestamp,
            what: `[life-event] ${event.description.slice(0, 80)}`,
            evidence: `category=${event.category} importance=${event.importance}`,
          });
        }
      }, jitter);
    });

    this.running = true;
    logger.info('[life-scheduler] started (every 3h)');
  }

  stop(): void {
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
    }
    this.running = false;
    logger.info('[life-scheduler] stopped');
  }
}

let _lifeScheduler: LifeScheduler | null = null;

export function lifeScheduler(): LifeScheduler {
  if (!_lifeScheduler) _lifeScheduler = new LifeScheduler();
  return _lifeScheduler;
}
