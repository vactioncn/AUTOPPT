// Audited from the model dispatchers in models, speech/provider and presenter.
// Include conditionally free branches: readiness/validation is inside the claim.
export const paidOperations = [
  ["audience", "/api/design-options/audience"],
  ["palette", "/api/design-options/palette"],
  ["manuscript", "/api/projects/:id/batches"],
  ["insert", "/api/projects/:id/slides"],
  ["render", "/api/projects/:id/render"],
  ["split", "/api/projects/:id/slides/:sid/split"],
  ["proposal", "/api/projects/:id/proposal"],
  ["proposal-commit", "/api/projects/:id/proposal/commit"],
  ["suggest-split", "/api/projects/:id/suggest-split"],
  ["job-retry", "/api/jobs/:id/retry"],
  ["style-create", "/api/styles"],
  ["style-url", "/api/styles/from-url"],
  ["style-analyze", "/api/styles/:id/analyze"],
  ["style-trial", "/api/styles/:id/trials"],
  ["motion-create", "/api/projects/:id/motion"],
  ["motion-retry", "/api/motion/:id/retry"],
  ["performance", "/api/projects/:id/speech-performance"],
  ["speech-preview", "/api/speech/preview"],
  ["voice-clone", "/api/speech/voices/clone"],
  ["narration-create", "/api/projects/:id/narration"],
  ["narration-retry", "/api/narration/:id/retry"],
  ["presenter-create", "/api/projects/:id/presenter"],
  ["presenter-retry", "/api/presenter/:id/retry"],
].map(([name, route]) => ({
  name,
  route,
  pattern: new RegExp("^" + route.replace(/:[^/]+/g, "[^/]+") + "$"),
}));
export const paidOperation = (path) =>
  paidOperations.find((r) => r.pattern.test(path));
export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  return value;
}
