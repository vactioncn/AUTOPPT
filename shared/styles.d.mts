export const DEFAULT_STYLE_ID: string;
export const HOSTED_BUILTIN_STYLE_IDS: readonly string[];
export function offeredStyles<
  T extends {
    id: string;
    builtin?: boolean;
    deletedAt?: string;
    catalogSourceId?: string;
    catalogHidden?: boolean;
    projectOnly?: boolean;
    replacesStyleId?: string;
  },
>(styles: T[], hosted?: boolean, currentStyleId?: string): T[];
export function projectStyles<
  T extends {
    id: string;
    rules?: string;
    canUse?: boolean;
    builtin?: boolean;
    deletedAt?: string;
    catalogSourceId?: string;
    catalogHidden?: boolean;
    projectOnly?: boolean;
    replacesStyleId?: string;
  },
>(styles: T[], hosted?: boolean, currentStyleId?: string): T[];
export const BUILTIN_STYLE_COVERS: Readonly<Record<string, string>>;
export function defaultStyleId(
  styles: {
    id: string;
    rules?: string;
    canUse?: boolean;
    deletedAt?: string;
  }[],
): string;
