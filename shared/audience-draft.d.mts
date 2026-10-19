export type AudienceDraftState = {
  status: "idle" | "waiting" | "generating" | "ready" | "error";
  error: string;
};
export function createAudienceDraft(options: {
  generate: (
    description: string,
    signal: AbortSignal,
  ) => Promise<{ description: string; brief: string }>;
  onResult: (audience: { description: string; brief: string }) => void;
  onState: (state: AudienceDraftState) => void;
}): {
  update(input: {
    description: string;
    brief: string;
    enabled: boolean;
    composing: boolean;
    context: string;
  }): void;
  retry(): void;
  dispose(): void;
};
