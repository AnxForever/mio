import type { TurnRiskTag } from '../core/turn-router.js';
import type { PersonaRiskLevel } from '../persona/critic.js';

export interface RegressionCandidateTurn {
  timestamp: string;
  role: 'user' | 'assistant';
  content: string;
}

export interface RegressionCandidateCheck {
  name: string;
  forbiddenText: string[];
  expectedText: string[];
}

export interface RegressionCandidate {
  id: string;
  source: 'reply_intervention' | 'transcript_scan' | 'scenario_actor' | 'persona_case' | 'debug_trace';
  taxonomy: string;
  sessionId: string;
  observedAt: string;
  confidence: number;
  routeRisk?: PersonaRiskLevel;
  routeTags?: TurnRiskTag[];
  reason: string;
  seed: RegressionCandidateTurn[];
  turns: string[];
  checks: RegressionCandidateCheck[];
  provenance: {
    interventionId?: string;
    transcriptFile?: string;
    excerpt: string;
  };
}
