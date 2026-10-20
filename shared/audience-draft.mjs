// One draft request per settled edit. A cancelled response must never replace
// newer input or a manually edited brief, even if the transport ignores abort.
export function createAudienceDraft({
  generate,
  onResult,
  onState,
  autoGenerate = true,
  delay = 900,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  let input,
    signature,
    timer,
    request,
    disposed = false;
  const failures = new Map();
  const state = (status, error = "") => onState({ status, error });
  const cancel = () => {
    if (timer !== undefined) clearTimer(timer);
    timer = undefined;
    request?.abort();
    request = undefined;
  };
  const schedule = (force = false) => {
    cancel();
    const { description, brief, enabled, composing, context } = input;
    if (!enabled || !description.trim()) return state("idle");
    if (!force && brief.trim()) return state("ready");
    if (!force && !autoGenerate) return state("idle");
    if (composing) return state("waiting");
    const key = JSON.stringify([context, description]);
    if (!force && failures.has(key)) return state("error", failures.get(key));
    state("waiting");
    timer = setTimer(
      async () => {
        timer = undefined;
        const controller = new AbortController();
        request = controller;
        state("generating");
        try {
          const audience = await generate(description, controller.signal);
          if (disposed || request !== controller) return;
          request = undefined;
          failures.delete(key);
          state("ready");
          onResult(audience);
        } catch (error) {
          if (disposed || request !== controller) return;
          request = undefined;
          const message =
            error instanceof Error ? error.message : "请稍后重试。";
          failures.set(key, message);
          state("error", message);
        }
      },
      force ? 0 : delay,
    );
  };
  return {
    update(next) {
      if (disposed) return;
      const nextSignature = JSON.stringify(next);
      if (signature === nextSignature) return;
      input = next;
      signature = nextSignature;
      schedule();
    },
    retry() {
      if (!disposed && input) schedule(true);
    },
    cancel() {
      cancel();
      state("idle");
    },
    dispose() {
      disposed = true;
      cancel();
      state("idle");
    },
  };
}
