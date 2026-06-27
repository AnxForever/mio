export interface PersonaRequest {
  name: string;
  gender: 'male' | 'female';
  style: string;
  age?: number;
  occupation?: string;
  traits?: string[];
}

export interface PersonaResult {
  soul: string;
  preview: string;
  tokenEstimate: number;
}

export interface DualModeState {
  currentMode: PersonaMode;
  switchedAt: string;
  switchCount: number;
  hysteresis: number;
}

export type PersonaMode = 'base' | 'deep';

export interface PADState {
  pleasure: number;
  arousal: number;
  dominance: number;
}

export interface ResponseSignals {
  responseLatencyMs: number;
  messageBurst: boolean;
  lengthRatio: number;
  sessionGapHours: number;
  engagementTrend: 'rising' | 'steady' | 'falling';
}

export interface MultiAxisState {
  closeness: number;
  trust: number;
  neediness: number;
  updatedAt?: string;
}

export interface IntentResult {
  primary: string;
  all?: { label: string; confidence: number }[];
  tone?: 'positive' | 'negative' | 'neutral';
  energy?: 'high' | 'mid' | 'low';
  topics?: string[];
}
