export interface PersonaRequest {
  userMessage: string;
  context: string;
  personaName: string;
  recentHistory?: string;
}

export interface PersonaResult {
  response: string;
  usedNodes: string[];
  tokenUsage: number;
}

export interface DualModeState {
  activeMode: 'boyfriend' | 'girlfriend';
  switchedAt: string;
}

export type PersonaMode = 'boyfriend' | 'girlfriend';

export interface PADState {
  pleasure: number;
  arousal: number;
  dominance: number;
}

export interface ResponseSignals {
  emotionalTone?: string;
  warmth?: number;
}

export interface MultiAxisState {
  warmth: number;
  trust: number;
  intimacy: number;
}

export interface IntentResult {
  label: string;
  category: string;
  confidence: number;
}
