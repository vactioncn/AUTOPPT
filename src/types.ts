export type DesignOptions = {
  audience: { description: string; brief: string } | null;
  palette: { name: string; instructions: string; colors: string[] } | null;
};
export type SceneElement = {
  id: string;
  type: "text" | "rect" | "ellipse" | "line" | "chart";
  x: number;
  y: number;
  w: number;
  h: number;
  text?: string;
  fontSize?: number;
  lines?: string[];
  fontFace?: string;
  bold?: boolean;
  color?: string;
  align?: "left" | "center" | "right";
  fill?: string | null;
  stroke?: string;
  strokeWidth?: number;
  radius?: number;
  arrow?: boolean;
  flipH?: boolean;
  chartType?: "bar" | "line";
  labels?: string[];
  values?: number[];
  unit?: string;
  foreground?: string;
};
export type Scene = {
  version: 1;
  width: 1600;
  height: 900;
  background: string;
  elements: SceneElement[];
};
export type DesignSystem = {
  version: 1;
  tokens: {
    background: string;
    foreground: string;
    accent: string;
    muted: string;
    fontFace: string;
    titleSize: number;
    bodySize: number;
    titleWeight: number;
    margin: number;
    lineWidth: number;
    cornerRadius: number;
  };
  layouts: {
    id: string;
    kind: string;
    name: string;
    description: string;
    maxItems: number;
    titleBox: number[];
    contentBox: number[];
    align: "left" | "center" | "right";
    origin: "reference" | "extended";
  }[];
};
export type DesignLanguage = Record<
  | "identity"
  | "typography"
  | "colorSystem"
  | "compositionPrinciples"
  | "graphicLanguage"
  | "detailLanguage"
  | "adaptationRules"
  | "avoid",
  string
>;
export type Plan = {
  pageNumber?: number;
  designOptions?: DesignOptions;
  compositionPlan?: {
    version: number;
    alternatives: { concept: string; reason: string }[];
    reason: string;
    direction: string;
    signature: string;
    review: Record<
      "layout" | "whitespace" | "hierarchy" | "color" | "originality",
      string
    >;
    recent: { pageId: string; signature: string }[];
  };
  promptMode?:
    | "verbatim-style-v1"
    | "verbatim-style-v2"
    | "verbatim-style-v3"
    | "verbatim-style-v4";
  styleRules?: string;
  contentPrompt?: string;
  copyReused?: boolean;
  imageRequest?: {
    prompt: string;
    model: string;
    providerOrigin?: string;
    size?: string;
    quality?: string;
  };
  imageResponse?: {
    width: number;
    height: number;
    reportedModel?: string | null;
    reportedSize?: string | null;
    reportedQuality?: string | null;
    revisedPrompt?: string | null;
  };
  sourceStyle?: StyleStamp;
  attachments?: ContentAttachment[];
  attachmentPlacements?: {
    id: string;
    role: string;
    placement: string;
    preserve: string;
  }[];
  planningVersion?: number;
  designLanguage?: DesignLanguage;
  styleExecution?: Record<
    "typeHierarchy" | "spatialRhythm" | "graphicHierarchy" | "microDetail",
    string
  >;
  contentBrief?: { claim: string; visualTask: string; relationship: string };
  selectionReason?: string;
  compositionKey?: string;
  visualForm?: string;
  engine?: "web" | "image";
  layoutId?: string;
  content?: {
    title: string;
    subtitle?: string;
    items: { label: string; body: string }[];
    metric?: string;
    chart?: { type: string; labels: string[]; values: number[]; unit: string };
  };
  scene?: Scene;
  title: string;
  displayText: string[];
  screenCopy?: {
    version: number;
    editScope: "composition" | "details";
    metrics: {
      sourceCharacters: number;
      characters: number;
      groups: number;
      warnings: string[];
    };
    mustKeep: { text: string; sourceQuote: string; attachmentId?: string }[];
    spokenOnly: { sourceQuote: string; reason: string }[];
    semanticSupport?: { sourceQuote: string; attachmentId?: string }[];
    rationale: string;
    review: {
      status: "reviewed";
      draftCharacters: number;
      reason: string;
      changes: string[];
      splitSuggestion: string;
    };
  };
  layout: string;
  visual: string;
  rationale: string;
  referenceId?: string;
  recipeName?: string;
  referenceReason?: string;
  styleFeatures?: string[];
  adaptations?: string;
  referenceSpec?: ReferenceSpec;
  purpose?: "transfer" | "reconstruction" | "cover";
  referenceMode?: "with-reference" | "rules-only" | "content-attachments";
};
export type ContentAttachment = {
  id: string;
  name: string;
  filename: string;
  width: number;
  height: number;
};
export type Version = {
  attachments?: ContentAttachment[];
  id: string;
  createdAt: string;
  notes: string;
  plan: Plan | null;
  image: string | null;
  scene?: Scene | null;
  styleId: string;
  planStyle?: StyleStamp;
  imageStyle?: StyleStamp;
  review?: ImageReview | null;
  reviewError?: string | null;
  stale: boolean;
};
export type Slide = {
  attachments?: ContentAttachment[];
  pendingAttachments?: ContentAttachment[];
  id: string;
  notes: string;
  batchIds: string[];
  styleId: string;
  plan: Plan | null;
  pendingPlan?: Plan;
  pendingPlanStyle?: StyleStamp;
  planStyle?: StyleStamp;
  imageStyle?: StyleStamp;
  review?: ImageReview | null;
  reviewError?: string | null;
  image: string | null;
  scene?: Scene | null;
  status: string;
  stale: boolean;
  error?: string;
  versions: Version[];
  createdAt: string;
};
export type StyleContext = {
  useCase?: string;
  industry?: string;
  audience?: string;
  topic?: string;
  strengthen?: string;
  avoid?: string;
};
export type GeneratedStyle = {
  id: string;
  references: number[];
  rationale: string;
  nameCn: string;
  nameEn: string;
  description: string;
  boundary: string;
  direction: string;
  visualDna: string[];
  styleModel: {
    mustKeep: string[];
    flexible: string[];
    rare: string[];
    forbidden: string[];
  };
  lockSentences: string[];
  risks: string[];
  colors: string[];
  rules: string;
};
export type Style = {
  autoName?: boolean;
  analysisContext?: StyleContext;
  cover?: string;
  coverTrialId?: string;
  versionToken?: string;
  compositionMode?: "direct" | "content-led";
  source?: {
    url: string;
    title: string;
    importedAt: string;
    images: { ref: string; url: string }[];
  };
  designLanguage?: DesignLanguage;
  imageRecipes?: {
    name: string;
    sourceId: string;
    layout: string;
    typography: string;
    graphics: string;
    avoid: string;
  }[];
  designSystem?: DesignSystem;
  id: string;
  name: string;
  description: string;
  rules: string;
  colors: string[];
  refs: string[];
  status: string;
  builtin: boolean;
  error?: string;
  deletedAt?: string;
  referenceProfiles?: ReferenceProfile[];
  styleAnalysis?: {
    version: number;
    id?: string;
    relation?: string;
    relationReason?: string;
    excludedReferences?: number[];
    styles?: GeneratedStyle[];
    summary: string;
    sharedTraits: { trait: string; references: number[] }[];
    differences: string[];
    uncertainties: string[];
    direction: string;
  };
  appliedTrialId?: string;
};
export type ReferenceProfile = {
  lineage?: string;
  mood?: string;
  rhythm?: string;
  useCases?: string;
  designLogic?: string;
  observed?: string[];
  inferred?: string[];
  name?: string;
  ref: string;
  role: string;
  layout: string;
  typography: string;
  graphics: string;
  avoid: string;
  color?: string;
  imagery?: string;
  texture?: string;
  density?: string;
  details?: string;
  spec?: ReferenceSpec;
};
export type ReferenceSpec = {
  version: number;
  sourceRegion: number[];
  sourceDescription: string;
  aspectRatio: number;
  originalText: string[];
  regions: {
    id: string;
    label: string;
    kind: string;
    box: number[];
    text: string;
    evidence: string;
    confidence: string;
    measurements: Record<string, number | string | null>;
  }[];
  constraints: {
    dimension: string;
    target: string;
    rule: string;
    evidence: string;
    locked: boolean;
  }[];
  adaptationRules: string[];
};
export type ImageReview = {
  version: number;
  status: "deviations" | "uncertain" | "matched";
  summary: string;
  checkedAt: string;
  referenceId: string;
  image: string;
  checks: {
    dimension: string;
    status: "match" | "deviation" | "uncertain";
    expected: string;
    actual: string;
    evidence: string;
    likelyStage: string;
    suggestion: string;
    region: number[] | null;
  }[];
};
export type Trial = {
  designOptions?: DesignOptions;
  id: string;
  styleId: string;
  parentId: string | null;
  jobId: string;
  notes: string;
  feedback: string;
  mode: string;
  layoutId?: string;
  engine?: "web" | "image";
  purpose?: "transfer" | "reconstruction" | "cover";
  referenceMode?: "with-reference" | "rules-only";
  primaryRef: string;
  styleSnapshot: Style;
  plan: Plan | null;
  image: string | null;
  scene?: Scene | null;
  imageStyle?: StyleStamp;
  review?: ImageReview | null;
  reviewError?: string | null;
  status: string;
  stage?: string;
  error?: string;
  createdAt: string;
  appliedAt?: string;
};
export type StyleStamp = {
  id: string;
  name: string;
  fingerprint: string;
  designRefs: string[];
  imageRefs: string[];
};
export type Batch = {
  id: string;
  jobId?: string;
  text: string;
  label: string;
  slideIds: string[];
  createdAt: string;
};
export type Proposal = {
  id: string;
  type: string;
  sourceIds: string[];
  notes: string[];
  plans: Plan[];
};
export type Project = {
  designOptions?: DesignOptions;
  id: string;
  title: string;
  styleId: string;
  updatedAt: string;
  createdAt: string;
  revision: number;
  batches: Batch[];
  slides: Slide[];
  draft: string;
  proposal: Proposal | null;
  undo: { label: string; replacementIds?: string[] } | null;
};
export type ProjectSummary = {
  id: string;
  title: string;
  styleId: string;
  updatedAt: string;
  pageCount: number;
  batchCount: number;
  wordCount: number;
  cover?: string;
  coverScene?: Scene;
};
export type Job = {
  failures?: { id: string; page: number; error: string }[];
  pageProgress?: {
    phase?: "analysis" | "images";
    total: number;
    preserved: number;
    succeeded: number;
    current: { id: string; page: number } | null;
    failed: { id: string; page: number; error: string }[];
  };
  autoRetry?: {
    attempt: number;
    maxRetries: number;
    seconds: number;
    reason?: string;
  };
  slideIds?: string[] | null;
  targetSlideIds?: string[];
  batchId?: string;
  id: string;
  type: string;
  projectId: string | null;
  styleId?: string;
  status: string;
  stage: string;
  updatedAt?: string;
  done: number;
  total: number;
  error?: string;
  createdAt: string;
};
export type Connection = {
  baseUrl: string;
  model: string;
  hasKey: boolean;
  apiKey?: string;
};
export type Settings = { text: Connection; image: Connection };
export type Bootstrap = {
  buildInfo?: import("../shared/diagnostics.mjs").BuildInfo;
  dataRootLabel?: string;
  capabilities?: import("../shared/diagnostics.mjs").Capabilities;
  features?: {
    projectPackages?: boolean;
    styleUrlImport?: boolean;
    insertAndManuscriptExport?: boolean;
    motionPresentation?: boolean;
    speechPresentation?: boolean;
  };
  projects: ProjectSummary[];
  styles: Style[];
  settings: Settings;
  jobs: Job[];
};
