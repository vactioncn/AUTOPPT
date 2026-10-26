export function createAppPaths(value = "") {
  const base = String(value).replace(/\/+$/, "");
  if (base && !/^\/[a-zA-Z0-9_-]+$/.test(base))
    throw new Error("Application base must be a single URL path segment");
  return {
    base,
    path(path) {
      if (!base || typeof path !== "string" || !path.startsWith("/") || path.startsWith("//")) return path;
      if (path === base || path.startsWith(base + "/") || path.startsWith(base + "?") || path.startsWith(base + "#")) return path;
      return base + path;
    },
    strip(path) {
      return base && (path === base || path.startsWith(base + "/")) ? path.slice(base.length) || "/" : path;
    },
  };
}
const paths = createAppPaths(typeof __AUTOPPT_BASE_PATH__ === "undefined" ? "" : __AUTOPPT_BASE_PATH__);
export const appBasePath = paths.base;
export const appPath = paths.path;
export const stripAppBasePath = paths.strip;
