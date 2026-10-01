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
  purpose?: "transfer" | "reconstruction";
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
export type Style = {
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
  appliedTrialId?: string;
};
export type ReferenceProfile = {
  name?: string;
  ref: string;
  role: string;
  layout: string;
  typography: string;
  graphics: string;
  avoid: string;
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
  id: string;
  styleId: string;
  parentId: string | null;
  jobId: string;
  notes: string;
  feedback: string;
  mode: string;
  layoutId?: string;
  engine?: "web" | "image";
  purpose?: "transfer" | "reconstruction";
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
  undo: { label: string } | null;
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
  id: string;
  type: string;
  projectId: string | null;
  styleId?: string;
  status: string;
  stage: string;
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
  features?: { styleUrlImport?: boolean };
  projects: ProjectSummary[];
  styles: Style[];
  settings: Settings;
  jobs: Job[];
};
