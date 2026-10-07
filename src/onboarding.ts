import type { Bootstrap } from "./types";
import type { Capabilities } from "../shared/diagnostics.mjs";

export type OnboardingState = {
  workspace: "pending" | "skipped" | "complete";
  generation: "pending" | "confirmed" | "direct";
  page: "pending" | "done";
};
const initialState = (): OnboardingState => ({
  workspace: "pending",
  generation: "pending",
  page: "pending",
});
// Browser UI preferences only. No project content, credentials or quota values.
// Use the authenticated account ID, never a guessed identity or a data path.
// Account login clears legacy `autoppt-` caches. Keep these non-sensitive,
// account-scoped preferences outside that namespace so login does not replay them.
export function createOnboardingPreferences(
  scope: string,
  storage: () => Pick<Storage, "getItem" | "setItem"> = () => localStorage,
) {
  const key = `autoppt:onboarding:v1:${encodeURIComponent(scope)}`;
  let current = initialState();
  try {
    const value = JSON.parse(storage().getItem(key) || "null");
    if (value && typeof value === "object") {
      if (["pending", "skipped", "complete"].includes(value.workspace))
        current.workspace = value.workspace;
      if (["pending", "confirmed", "direct"].includes(value.generation))
        current.generation = value.generation;
      if (["pending", "done"].includes(value.page)) current.page = value.page;
    }
  } catch {
    /* Storage denied or corrupt: keep safe session defaults. */
  }
  return {
    read: () => ({ ...current }),
    update(change: Partial<OnboardingState>) {
      current = { ...current, ...change };
      try {
        storage().setItem(key, JSON.stringify(current));
      } catch {
        /* Session still works. */
      }
      return { ...current };
    },
  };
}

export function onboardingReadiness(
  data: Bootstrap,
  capabilities: Capabilities,
  account?: { hosted: boolean; modelReady?: boolean },
) {
  const hosted = account?.hosted || data.buildInfo?.runtimeMode === "hosted";
  // Worker credentials only authenticate internal requests; they say nothing
  // about the administrator's provider configuration. Fail closed in hosted.
  const textReady = hosted
    ? account?.modelReady === true
    : !!data.settings.text.hasKey;
  const imageReady = hosted
    ? account?.modelReady === true
    : !!data.settings.image.hasKey;
  const styleReady = data.styles.some(
    (style) => !style.deletedAt && !!style.rules?.trim(),
  );
  return {
    textReady,
    imageReady,
    styleReady,
    modelsReady: textReady && imageReady,
    ready: textReady && imageReady && styleReady,
    managed: !capabilities.localModelSettings.enabled,
  };
}
export function safeWorkspaceLabel(label?: string) {
  return label && !/[\\/]|[\r\n]/.test(label) ? label : "工作区";
}
export const exampleManuscript =
  "今天，我想和大家聊聊如何开始一件新事情。面对一个陌生的任务，我们常常希望先做好所有准备，才愿意迈出第一步。但更容易坚持的方法，是先完成一个小行动。比如，读一本书，可以先读两页；准备一次分享，可以先写下一段最想说的话。完成之后，再看看哪里需要调整。今天不必一次做到完美，只要找到一个足够小、现在就能开始的行动。让我们从这一步开始，慢慢把想法变成看得见的成果。";

// Keep the identity of an unacknowledged submission across retries and reloads.
// Store only a content digest and random ID, never manuscript text or credentials.
export function createGenerationRequest(
  scope: string,
  storage: () => Pick<Storage, "getItem" | "setItem" | "removeItem"> = () =>
    sessionStorage,
) {
  const key = `autoppt-generation-request:${scope}`;
  let pending: { digest: string; requestId: string } | null = null;
  try {
    pending = JSON.parse(storage().getItem(key) || "null");
  } catch {
    /* Session fallback. */
  }
  return {
    async forText(text: string) {
      const digest = Array.from(
        new Uint8Array(
          await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
        ),
        (byte) => byte.toString(16).padStart(2, "0"),
      ).join("");
      if (
        pending?.digest !== digest ||
        !/^[\w-]{16,80}$/.test(pending.requestId)
      ) {
        pending = { digest, requestId: crypto.randomUUID() };
        try {
          storage().setItem(key, JSON.stringify(pending));
        } catch {
          /* Session fallback. */
        }
      }
      return pending.requestId;
    },
    accepted() {
      pending = null;
      try {
        storage().removeItem(key);
      } catch {
        /* Session fallback. */
      }
    },
  };
}
