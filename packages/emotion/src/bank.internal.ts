/**
 * Bank I/O stubs for @mio/emotion.
 */
import { getIO } from './context.js';

export function appendBookmark(entry: { time: string; what: string; evidence: string }): void {
  getIO().appendBookmark(entry);
}
