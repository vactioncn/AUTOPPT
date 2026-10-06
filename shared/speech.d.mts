export type SpeechOptions = { voiceId: string; emotion: string; speed: number };
export const SPEECH_VOICES: { id: string; name: string; description: string }[];
export const SPEECH_EMOTIONS: { id: string; name: string }[];
export const SPEECH_DEFAULTS: SpeechOptions;
export function speechOptions(input?: Partial<SpeechOptions>): SpeechOptions;
export function splitSpeech(text: string, limit?: number): string[];
