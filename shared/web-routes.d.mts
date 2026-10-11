export type PublicPage =
  | "website"
  | "login"
  | "register"
  | "support"
  | "privacy"
  | "terms"
  | "notfound";
export function publicPage(pathname?: string, hash?: string): PublicPage | null;
export function workspaceTarget(value?: unknown): string;
export function navigateWeb(path: string, replace?: boolean): void;
