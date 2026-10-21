import { RELEASE_STYLES } from "./builtin-style-catalog.mjs";

// Preserve the approved saved style identity so upgrades reuse it without overwriting edits.
export const DEFAULT_STYLE_ID = "27266b4f-7da5-4549-ae74-7c9cf7e910ca";

// The invited web edition offers these four. Keep the full catalog for saved projects.
export const HOSTED_BUILTIN_STYLE_IDS = [
  DEFAULT_STYLE_ID,
  "365ab439-03d8-4fdb-9afe-0b6c91b2cce8",
  "bce75df0-dfc2-4529-b904-515af10d0142",
  "c54ffa0b-25d9-4e4e-9c38-2b770860fb9b",
];
const builtinIds = new Set([
  DEFAULT_STYLE_ID,
  ...RELEASE_STYLES.map((s) => s.id),
  "restrained-minimal",
  "editorial",
  "bold",
  "night",
]);

export function offeredStyles(styles, hosted = false, currentStyleId = "") {
  const available = styles.filter((s) => !s.deletedAt);
  if (!hosted) return available;
  const replaced = new Set(
    available
      .filter((s) => s.catalogSourceId && !s.catalogHidden)
      .map((s) => s.replacesStyleId)
      .filter(Boolean),
  );
  return available
    .filter(
      (s) =>
        s.id === currentStyleId ||
        (!s.catalogHidden && !s.projectOnly && !replaced.has(s.id)),
    )
    .filter(
      (s) =>
        HOSTED_BUILTIN_STYLE_IDS.includes(s.id) ||
        (!builtinIds.has(s.id) && !s.builtin) ||
        s.id === currentStyleId,
    )
    .sort((a, b) => {
      const rank = (s) => {
        const index = HOSTED_BUILTIN_STYLE_IDS.indexOf(s.id);
        return index < 0 ? HOSTED_BUILTIN_STYLE_IDS.length : index;
      };
      return rank(a) - rank(b);
    });
}

// Display assets only: never add these covers to model reference images.
export const BUILTIN_STYLE_COVERS = {
  ...Object.fromEntries(RELEASE_STYLES.map((s) => [s.id, s.cover])),
  [DEFAULT_STYLE_ID]: "/style-covers/restrained-childhood-editorial.png",
};

// Only new projects use this preference; saved project selections stay intact.
export function defaultStyleId(styles) {
  const available = styles.filter(
    (s) => !s.deletedAt && (s.canUse ?? !!s.rules?.trim()),
  );
  return (
    available.find((s) => s.id === DEFAULT_STYLE_ID)?.id ||
    available[0]?.id ||
    ""
  );
}
