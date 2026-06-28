import type { ContentBlock } from '../types.js';
import { transcribeAudio } from '../voice/stt.js';
import type { TurnInput } from './turn-types.js';

export async function prepareTurnInput(input: TurnInput): Promise<TurnInput> {
  if (!input.audioPath) return input;

  const transcript = (await transcribeAudio(input.audioPath)).trim();
  if (!transcript) return input;

  const baseText = input.text?.trim();
  return {
    ...input,
    text: baseText ? `${baseText}\n\n[语音转写]\n${transcript}` : transcript,
  };
}

export function buildUserContent(input: TurnInput): string | ContentBlock[] {
  if (input.imageBlocks && input.imageBlocks.length > 0) {
    if (input.text && input.text.trim().length > 0) {
      return [{ type: 'text', text: input.text }, ...input.imageBlocks];
    }
    return input.imageBlocks;
  }
  return input.text ?? '';
}
