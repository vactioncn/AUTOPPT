export function createAppPaths(value?: string): { base: string; path(path: string): string; strip(path: string): string };
export const appBasePath: string;
export function appPath(path: string): string;
export function stripAppBasePath(path: string): string;
