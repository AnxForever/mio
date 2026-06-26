/**
 * Relationship progression stubs for @mio/emotion.
 */
import type { RelationshipState } from './types.internal.js';

let _state: RelationshipState = { stage: 'acquaintance', interactionCount: 0, emotionalDepth: 0 };

export function readRelationshipState(): RelationshipState {
  return { ..._state };
}

export function recordInteraction(): void {
  _state.interactionCount++;
}

/** For host app to sync state into the package. */
export function setRelationshipState(state: RelationshipState): void {
  _state = { ...state };
}
