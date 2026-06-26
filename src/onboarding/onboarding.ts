/**
 * Mio — First-run onboarding flow
 *
 * Guides a new user through:
 *   1. Selecting an AI provider
 *   2. Entering an API key
 *   3. Choosing a persona (boyfriend / girlfriend)
 *   4. Naming Mio
 *   5. Sending the first message
 *
 * Exports:
 *   - isFirstRun():                whether the onboarding should run
 *   - runOnboarding(provider):     CLI-guided onboarding
 *   - OnboardingAPI:               types for the HTTP-based flow
 *   - OnboardingState:             serializable state machine
 *   - loadOnboardingState/saveOnboardingState: persistence helpers
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { dirname, join } from 'node:path';
import { PROVIDER_PRESETS } from '../config.js';
import { runTurn } from '../core/agent-loop.js';
import { modManager } from '../mod/mod-manager.js';
import { selectProvider, getProviderInfo } from '../providers/index.js';
import { updateConfig, getDataDir } from '../config.js';
import type { Gender, ProviderPreset } from '../types.js';

// ─── Types ───

export interface OnboardingState {
  done: boolean;
  currentStep: number;
  /** The provider preset selected by the user (e.g. 'anthropic', 'deepseek') */
  provider?: string;
  /** The API key for the selected provider */
  apiKey?: string;
  /** Chosen gender/persona */
  gender?: Gender;
  /** Custom name for Mio */
  name?: string;
  /** The user's first message to Mio */
  firstMessage?: string;
}

export interface OnboardingStep {
  step: number;
  question: string;
  /** The key this step writes to in the state */
  key: string;
  /** Optional validation function */
  validate?: (value: string) => string | null; // null = valid, string = error msg
}

// ─── Steps ───

const STEPS: OnboardingStep[] = [
  {
    step: 1,
    question: 'Select your AI provider:',
    key: 'provider',
    validate: (v: string) => {
      const providers = Object.keys(PROVIDER_PRESETS).filter((p) => p !== 'mock');
      if (providers.includes(v)) return null;
      return `Invalid provider. Choose from: ${providers.join(', ')}`;
    },
  },
  {
    step: 2,
    question: 'Enter your API key (or press Enter for mock/offline):',
    key: 'apiKey',
  },
  {
    step: 3,
    question: 'Choose personality: boyfriend or girlfriend:',
    key: 'gender',
    validate: (v: string) => {
      const g = v.toLowerCase().trim();
      if (g === 'boyfriend' || g === 'girlfriend') return null;
      return 'Please enter "boyfriend" or "girlfriend".';
    },
  },
  {
    step: 4,
    question: 'Give Mio a name (default: Mio):',
    key: 'name',
  },
  {
    step: 5,
    question: 'Say your first message to Mio:',
    key: 'firstMessage',
    validate: (v: string) => {
      if (v.trim().length === 0) return 'Please say something.';
      return null;
    },
  },
];

// ─── Persistence ───

function onboardingPath(): string {
  return join(getDataDir(), 'onboarding-state.json');
}

export function loadOnboardingState(): OnboardingState | null {
  const path = onboardingPath();
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as OnboardingState;
  } catch {
    return null;
  }
}

export function saveOnboardingState(state: OnboardingState): void {
  const path = onboardingPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2), 'utf-8');
}

export function clearOnboardingState(): void {
  const path = onboardingPath();
  if (existsSync(path)) {
    writeFileSync(path, JSON.stringify({ done: true, currentStep: 0 }, null, 2), 'utf-8');
  }
}

// ─── First run check ───

/**
 * Check if this is the first run.
 * Returns `true` if data/config.json does NOT exist (no previous config).
 */
export function isFirstRun(): boolean {
  const path = join(getDataDir(), 'config.json');
  return !existsSync(path);
}

// ─── CLI onboarding ───

/**
 * Run the full CLI-guided onboarding flow.
 *
 * Prompts the user through each step, saves the config, sends the first
 * message to Mio via the agent loop, displays Mio's response, and marks
 * onboarding as complete.
 *
 * @param existingProvider  Optional pre-existing provider (for the HTTP flow).
 */
export async function runOnboarding(existingProvider?: string): Promise<void> {
  const rl = createInterface({ input, output });

  console.log('');
  console.log('╔══════════════════════════════════════╗');
  console.log('║          Welcome to Mio 💕            ║');
  console.log('╚══════════════════════════════════════╝');
  console.log('');

  const state: OnboardingState = { done: false, currentStep: 1 };

  // Step 1: Provider
  console.log('Select your AI provider:');
  const providers = Object.entries(PROVIDER_PRESETS).filter(([name]) => name !== 'mock');
  for (const [name, cfg] of providers) {
    const hasKey = cfg.apiKeyEnv && process.env[cfg.apiKeyEnv];
    const indicator = hasKey ? ' (key available)' : '';
    console.log(`  ${name.padEnd(12)} ${cfg.label}${indicator}`);
  }
  console.log('');
  let provider: string | null = null;
  while (!provider) {
    const ans = (await rl.question('Provider: ')).trim().toLowerCase();
    if (PROVIDER_PRESETS[ans] && ans !== 'mock') {
      provider = ans;
    } else {
      console.log(`Invalid. Choose from: ${Object.keys(PROVIDER_PRESETS).filter((p) => p !== 'mock').join(', ')}`);
    }
  }
  state.provider = provider;

  // Step 2: API key
  const preset = PROVIDER_PRESETS[provider];
  let apiKey = process.env[preset.apiKeyEnv] || '';
  if (!apiKey) {
    const raw = await rl.question('API key (or press Enter for offline/mock): ');
    apiKey = raw.trim();
  }
  state.apiKey = apiKey;

  // Step 3: Gender
  let gender: Gender = 'girlfriend';
  const rawGender = (await rl.question('Personality (boyfriend / girlfriend) [girlfriend]: ')).trim().toLowerCase();
  if (rawGender === 'boyfriend' || rawGender === 'girlfriend') {
    gender = rawGender;
  }
  state.gender = gender;

  // Step 4: Name
  const rawName = (await rl.question('Name for Mio [Mio]: ')).trim();
  const name = rawName || 'Mio';
  state.name = name;

  // Step 5: First message
  const firstMsg = (await rl.question('Say your first message to Mio: ')).trim();
  state.firstMessage = firstMsg || 'Hello!';

  rl.close();

  // ─── Apply configuration ───

  // Set env var so provider resolution picks it up
  if (apiKey && preset.apiKeyEnv) {
    process.env[preset.apiKeyEnv] = apiKey;
  }

  updateConfig({
    provider: provider as ProviderPreset,
    model: preset.defaultModel,
    gender,
    name,
  });

  // Switch mod if needed
  const mod = modManager();
  if (mod.activeMod !== gender) {
    try {
      await mod.switchMod(gender);
    } catch (err) {
      console.error(`[onboarding] failed to switch mod: ${err}`);
    }
  }

  // ─── Send first message ───
  console.log('\n--- Sending your first message to Mio... ---\n');

  try {
    const text = state.firstMessage;
    const providerInstance = selectProvider(provider, preset.defaultModel);
    const result = await runTurn(
      { text },
      { provider: providerInstance },
    );

    console.log(`\n${name}: ${result.text}\n`);
    console.log(`[session: ${result.sessionId}]\n`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`\n[error] Could not get a reply: ${msg}\n`);
    console.log('(Your config has been saved. You can try again from the REPL or web UI.)\n');
  }

  // Mark as done
  state.done = true;
  state.currentStep = 0;
  saveOnboardingState(state);

  console.log('╔══════════════════════════════════════╗');
  console.log('║       Onboarding complete! 🎉        ║');
  console.log('╚══════════════════════════════════════╝');
  console.log('');
}

// ─── HTTP onboarding helpers ───

export function getOnboardingSteps(): OnboardingStep[] {
  return STEPS;
}

export function getStep(stepNumber: number): OnboardingStep | undefined {
  return STEPS.find((s) => s.step === stepNumber);
}

export function validateStep(stepNumber: number, value: string): string | null {
  const step = getStep(stepNumber);
  if (!step) return 'Invalid step.';
  if (step.validate) return step.validate(value);
  return null;
}

export function applyValue(state: Partial<OnboardingState>, step: number, value: string): Partial<OnboardingState> {
  const s = getStep(step);
  if (!s) return state;
  return { ...state, [s.key]: value, currentStep: step + 1 };
}
