export type Audience = { description: string; brief: string };
export const AUDIENCE_PRESETS: ReadonlyArray<{
  id: string;
  label: string;
  hint: string;
  audience: Readonly<Audience>;
}>;
export function audiencePreset(id: string): Audience | null;
export function audiencePresetId(audience: Audience | null): string;
