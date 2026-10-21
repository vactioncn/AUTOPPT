import { HOSTED_BUILTIN_STYLE_IDS, offeredStyles } from "./styles.mjs";

// Both roles share the gallery. Administrators can preview completed draft
// samples immediately; customers continue to browse only published snapshots.
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
      const samples = manageStyle?.sampleExamples || [];
      const preview =
        samples.length > 0 &&
        (!style.catalogSourceId ||
          samples.length !== style.examples?.length ||
          samples.some(
            (sample, index) => sample.id !== style.examples[index]?.id,
          ));
      return {
        style: preview
          ? { ...manageStyle, examples: samples, samplePreview: true }
          : style,
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
