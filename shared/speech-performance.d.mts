export type DeliveryUnit = {
  id: string;
  text: string;
  emotion: string;
  pace: number;
  pauseAfter: number;
  emphasis: boolean;
  sound: string;
  reason: string;
};
export type PerformanceSettings = { style: string; sounds: boolean };
export type PerformancePage = {
  id: string;
  title: string;
  notes: string;
  text: string;
  units: DeliveryUnit[];
};
export type SpeechPerformance = {
  id: string;
  version: number;
  model: string;
  createdAt: string;
  settings: PerformanceSettings;
  pages: PerformancePage[];
};
export type PerformanceTask = {
  id: string;
  status: string;
  progress: string;
  completed: number;
  total: number;
};
export const PERFORMANCE_VERSION: number;
export const DELIVERY_EMOTIONS: { id: string; name: string }[];
export const DELIVERY_SOUNDS: { id: string; name: string }[];
export function performanceSettings(
  input?: Partial<PerformanceSettings>,
): PerformanceSettings;
export function speechUnits(text: string): { id: string; text: string }[];
export function validateDelivery(
  units: { id: string; text: string }[],
  output: unknown,
  settings: PerformanceSettings,
  notes?: string,
): DeliveryUnit[];
export function supportsDeliverySounds(model: string): boolean;
export function performanceMatches(
  plan: SpeechPerformance | null,
  pages: { id: string; text: string }[],
): boolean;
export function compilePerformancePage(
  page: PerformancePage,
  model: string,
  options: { speed: number },
): {
  text: string;
  spokenText: string;
  delivery: { emotion: string; speed: number; volume: number };
  pauseAfter: number;
}[];
