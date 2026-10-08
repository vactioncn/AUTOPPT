export function userError(
  value: unknown,
  options?: { external?: boolean; status?: number; fallback?: string },
): string;
export function sanitizeErrorFields<T>(value: T): T;
