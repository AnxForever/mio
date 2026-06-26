/**
 * Config stubs for @mio/emotion.
 */
import { getEmotionConfig, type EmotionConfig } from './context.js';

export function getDataDir(): string {
  return getEmotionConfig().dataDir;
}

export function getConfig(): { features: Record<string, boolean>; dataDir: string } {
  const c = getEmotionConfig();
  return {
    features: {
      pad: c.padEnabled ?? true,
      multiAxisAffinity: c.multiAxisEnabled ?? true,
    },
    dataDir: c.dataDir,
  };
}
