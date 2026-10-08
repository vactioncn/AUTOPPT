export const paidOperations: { name: string; route: string; pattern: RegExp }[];
export function paidOperation(
  path: string,
): { name: string; route: string; pattern: RegExp } | undefined;
export function canonical(value: unknown): unknown;
