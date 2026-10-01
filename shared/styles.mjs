export const DEFAULT_STYLE_ID = "restrained-minimal";

// Only new projects use this preference; saved project selections stay intact.
export function defaultStyleId(styles) {
  const available = styles.filter((s) => !s.deletedAt && s.rules?.trim());
  return (
    available.find((s) => s.id === DEFAULT_STYLE_ID)?.id ||
    available[0]?.id ||
    ""
  );
}
