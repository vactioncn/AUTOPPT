import { HOSTED_BUILTIN_STYLE_IDS, offeredStyles } from "./styles.mjs";

// Browse the same published presentation in both roles. Editing still targets
// the administrator's source, so opening a gallery never changes saved data.
export function styleLibraryEntries(
  styles,
  { canManage = false, hosted = false } = {},
) {
  const sources = new Map(
    styles
      .filter((s) => !s.deletedAt && !s.catalogSourceId)
      .map((s) => [s.id, s]),
  );
  const offered = offeredStyles(styles, hosted);
  const publishedSources = new Set(
    offered
      .filter((s) => s.catalogSourceId && !s.catalogHidden)
      .map((s) => s.catalogSourceId),
  );
  return offered
    .filter((s) => !s.catalogHidden && !publishedSources.has(s.id))
    .map((style) => {
      const manageStyle = canManage
        ? sources.get(style.catalogSourceId || style.id)
        : undefined;
      return {
        style,
        manageStyle,
        unpublished: !!(
          hosted &&
          manageStyle &&
          !style.catalogSourceId &&
          !HOSTED_BUILTIN_STYLE_IDS.includes(style.id) &&
          !manageStyle.publishedAt
        ),
      };
    });
}
