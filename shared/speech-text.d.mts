export const SPEECH_TEXT_VERSION: number;
export function prepareSpeechText(input: string): {
  text: string;
  removed: { text: string; reason: string }[];
};
