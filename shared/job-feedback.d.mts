export function failureAdvice(
  error?: string,
  options?: { hosted?: boolean; uncertain?: boolean },
): {
  reason: string;
  action: string;
};
export function elapsedLabel(start: string, currentTime?: number): string;
export function retrySeconds(
  retry: { retryAt?: string; seconds?: number } | undefined,
  currentTime?: number,
): number;
