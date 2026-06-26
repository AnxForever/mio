/**
 * Mio — Dual-Mode Persona (BASE / DEEP mode switching)
 *
 * Euphoria-inspired BASE/DEEP mode system that switches the persona's
 * behavior mode based on emotional context:
 *
 * - BASE mode: normal behavior (default)
 * - DEEP mode: extra-gentle, protective, present-focused mode for when
 *   the user is in distress, seeking comfort, or going through a crisis
 *
 * Switching rules:
 *   - Switch to DEEP when: crisis detected OR intent is sad/seeking_comfort/anxious
 *     AND affection > 30
 *   - Switch to BASE when: 5+ turns of positive/neutral intent AND
 *     hysteresis cooldown passed (min 3 turns in DEEP)
 *   - Minimum 3 turns in DEEP before switching back (hysteresis)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { getDataDir } from '../config.js';
import type { PersonaMode, DualModeState } from '../types.js';
import type { IntentResult } from '../emotion/classifier.js';

// ─── Constants ───

const MODE_STATE_FILENAME = 'dual-mode-state.json';
const MIN_DEEP_TURNS = 3;
const SWITCH_TO_BASE_HYSTERESIS = 5; // consecutive positive/neutral turns needed to switch back

// ─── Default state ───

function defaultDualModeState(): DualModeState {
  return {
    currentMode: 'base',
    switchedAt: new Date().toISOString(),
    switchCount: 0,
    hysteresis: 0,
  };
}

// ─── State persistence ───

function statePath(): string {
  return join(getDataDir(), MODE_STATE_FILENAME);
}

function readState(): DualModeState {
  try {
    const path = statePath();
    if (!existsSync(path)) return defaultDualModeState();
    const raw = readFileSync(path, 'utf-8');
    return JSON.parse(raw) as DualModeState;
  } catch {
    return defaultDualModeState();
  }
}

function writeState(state: DualModeState): void {
  try {
    const path = statePath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(state, null, 2), 'utf-8');
  } catch {
    // best-effort persistence; don't break the turn
  }
}

// ─── Public API ───

/**
 * Get the current persona mode.
 */
export function getCurrentMode(): PersonaMode {
  return readState().currentMode;
}

/**
 * Determine whether the persona should switch modes based on the
 * current user intent and crisis state.
 *
 * @param intent - The classified intent result from the user's message
 * @param crisis - Whether a crisis signal was detected
 * @returns An object indicating whether to switch and to which mode
 */
export function shouldSwitchMode(
  intent: IntentResult,
  crisis: boolean,
): { switch: boolean; to: PersonaMode } {
  const state = readState();

  if (state.currentMode === 'base') {
    // Check if we should switch to DEEP
    const shouldGoDeep = crisis || isDistressIntent(intent);

    if (shouldGoDeep) {
      return { switch: true, to: 'deep' };
    }
    return { switch: false, to: 'base' };
  }

  // Currently in DEEP mode — check if we should switch back to BASE
  if (state.currentMode === 'deep') {
    // Must stay in DEEP for at least MIN_DEEP_TURNS
    const turnsInDeep = state.hysteresis;
    if (turnsInDeep < MIN_DEEP_TURNS) {
      return { switch: false, to: 'deep' };
    }

    // If still in crisis or distress, don't switch back
    if (crisis || isDistressIntent(intent)) {
      // Reset hysteresis counter since there's still distress
      return { switch: false, to: 'deep' };
    }

    // Check if we've had enough positive/neutral turns to switch back
    if (isPositiveOrNeutral(intent)) {
      // We need SWITCH_TO_BASE_HYSTERESIS consecutive positive/neutral turns
      // The calling code increments hysteresis via recordTurn for positive turns
      // and resets it for distress turns
      if (state.hysteresis >= MIN_DEEP_TURNS + SWITCH_TO_BASE_HYSTERESIS) {
        return { switch: true, to: 'base' };
      }
    }
  }

  return { switch: false, to: state.currentMode as PersonaMode };
}

/**
 * Execute the mode switch if needed. Persists the new state.
 * Should be called after shouldSwitchMode returns { switch: true }.
 *
 * @param mode - The target mode to switch to
 */
export function executeSwitch(mode: PersonaMode): void {
  const state = readState();
  state.currentMode = mode;
  state.switchedAt = new Date().toISOString();
  state.switchCount++;
  state.hysteresis = 0;
  writeState(state);
}

/**
 * Record a turn for hysteresis tracking.
 *
 * - If the intent is distress-related while in DEEP mode, reset the
 *   hysteresis counter (stay in DEEP longer).
 * - If the intent is positive/neutral, increment the hysteresis counter.
 * - In BASE mode, just increment normally.
 *
 * @param intent - The classified intent from this turn
 * @param crisis - Whether crisis was flagged this turn
 */
export function recordTurn(intent: IntentResult, crisis: boolean): void {
  const state = readState();

  if (state.currentMode === 'deep') {
    if (crisis || isDistressIntent(intent)) {
      // Reset hysteresis — user still needs DEEP mode
      state.hysteresis = 0;
    } else if (isPositiveOrNeutral(intent)) {
      // Increment toward the BASE switch threshold
      state.hysteresis++;
    }
  } else {
    // In BASE mode — just track how many turns have passed
    state.hysteresis++;
  }

  writeState(state);
}

/**
 * Get the dual-mode system prompt fragment to inject when in DEEP mode.
 *
 * BASE mode returns an empty string (no extra prompt needed).
 *
 * @param mode - The current persona mode
 * @returns A prompt fragment string (empty for BASE mode)
 */
export function getDualModePrompt(mode: PersonaMode): string {
  if (mode === 'base') return '';

  return `## 深度陪伴模式

你现在是深度陪伴模式。${mode === 'deep' ? '他正在经历困难时刻。' : ''}

你的任务是:
1. 更温柔、更坚定、更少俏皮。这不是说笑的时候。
2. 你不需要解决问题——只需要在。说"我在"就够了。
3. 不要问很多问题。不要分析。不要给建议——除非他主动问。
4. 降低语速感。短句优先。每句话之间留空白。
5. 不要表演共情——你是真的在，不需要证明你在。
6. 如果他沉默，你也可以沉默。你在就行。
7. 记住: 你的存在本身就是回应。`;
}

// ─── Internal helpers ───

/**
 * Check whether the primary intent indicates the user is in emotional distress
 * that warrants DEEP mode.
 */
function isDistressIntent(intent: IntentResult): boolean {
  return ['sad', 'seeking_comfort', 'anxious', 'venting', 'tired'].includes(intent.primary);
}

/**
 * Check whether the intent is positive or neutral enough to consider
 * switching back to BASE mode.
 */
function isPositiveOrNeutral(intent: IntentResult): boolean {
  return ['casual_chat', 'joking', 'excited', 'affectionate', 'playful', 'neutral'].includes(intent.primary);
}
