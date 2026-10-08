// Audited contract for HTTP routes that may invoke a billable model.
// Keep this independent from browser request mocks so a server-only helper
// remains visible even when no current UI calls it.
export const modelRouteContract = [
  {
    name: "speech-performance",
    path: /^\/api\/projects\/[^/]+\/speech-performance$/,
    requiredUi: true,
  },
  {
    name: "presenter-create",
    path: /^\/api\/projects\/[^/]+\/presenter$/,
    requiredUi: true,
  },
  {
    name: "presenter-retry",
    path: /^\/api\/presenter\/[^/]+\/retry$/,
    requiredUi: true,
  },
  {
    name: "manuscript",
    path: /^\/api\/projects\/[^/]+\/batches$/,
    requiredUi: true,
  },
  {
    name: "render",
    path: /^\/api\/projects\/[^/]+\/render$/,
    requiredUi: true,
  },
  {
    name: "merge-proposal",
    path: /^\/api\/projects\/[^/]+\/proposal$/,
    requiredUi: true,
  },
  {
    name: "proposal-commit",
    path: /^\/api\/projects\/[^/]+\/proposal\/commit$/,
    requiredUi: true,
  },
  {
    name: "suggest-split",
    path: /^\/api\/projects\/[^/]+\/suggest-split$/,
    requiredUi: true,
  },
  {
    name: "split-generate",
    path: /^\/api\/projects\/[^/]+\/slides\/[^/]+\/split$/,
    when: (request) => request.postDataJSON().generate === true,
    requiredUi: true,
  },
  {
    name: "insert-generate",
    path: /^\/api\/projects\/[^/]+\/slides$/,
    when: (request) => request.postDataJSON().generate !== false,
    requiredUi: true,
  },
  {
    name: "motion-create",
    path: /^\/api\/projects\/[^/]+\/motion$/,
    requiredUi: true,
  },
  {
    name: "motion-retry",
    path: /^\/api\/motion\/[^/]+\/retry$/,
    requiredUi: true,
  },
  { name: "job-retry", path: /^\/api\/jobs\/[^/]+\/retry$/, requiredUi: true },
  { name: "style-create", path: /^\/api\/styles$/, requiredUi: true },
  { name: "style-url", path: /^\/api\/styles\/from-url$/, requiredUi: true },
  {
    name: "style-analyze",
    path: /^\/api\/styles\/[^/]+\/analyze$/,
    requiredUi: true,
  },
  {
    name: "style-trial",
    path: /^\/api\/styles\/[^/]+\/trials$/,
    requiredUi: true,
  },
  {
    name: "audience",
    path: /^\/api\/design-options\/audience$/,
    requiredUi: true,
  },
  {
    name: "palette-server-helper",
    path: /^\/api\/design-options\/palette$/,
    requiredUi: false,
  },
  {
    name: "speech-preview",
    path: /^\/api\/speech\/preview$/,
    requiredUi: true,
  },
  {
    name: "voice-clone",
    path: /^\/api\/speech\/voices\/clone$/,
    requiredUi: true,
  },
  {
    name: "narration-create",
    path: /^\/api\/projects\/[^/]+\/narration$/,
    requiredUi: true,
  },
  {
    name: "narration-retry",
    path: /^\/api\/narration\/[^/]+\/retry$/,
    requiredUi: true,
  },
];
