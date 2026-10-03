// Preserve the approved saved style identity so upgrades reuse it without overwriting edits.
export const DEFAULT_STYLE_ID = "27266b4f-7da5-4549-ae74-7c9cf7e910ca";

// Display assets only: never add these covers to model reference images.
export const BUILTIN_STYLE_COVERS = {
  [DEFAULT_STYLE_ID]: "/style-covers/restrained-childhood-editorial.png",
};

// Only new projects use this preference; saved project selections stay intact.
export function defaultStyleId(styles) {
  const available = styles.filter((s) => !s.deletedAt && s.rules?.trim());
  return (
    available.find((s) => s.id === DEFAULT_STYLE_ID)?.id ||
    available[0]?.id ||
    ""
  );
}
