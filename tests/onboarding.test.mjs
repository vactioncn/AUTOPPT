import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
const { outputText } = ts.transpileModule(
  readFileSync(new URL("../src/onboarding.ts", import.meta.url), "utf8"),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  },
);
const { createOnboardingPreferences, onboardingReadiness, safeWorkspaceLabel } =
  await import(`data:text/javascript,${encodeURIComponent(outputText)}`);
const storage = () => {
  const entries = new Map();
  return {
    entries,
    getItem: (k) => entries.get(k) ?? null,
    setItem: (k, v) => entries.set(k, v),
  };
};
test("onboarding milestones are versioned, independent and scoped to the actual UI account", () => {
  const s = storage();
  const prefs = createOnboardingPreferences("hosted:fixture-one", () => s);
  assert.deepEqual(prefs.read(), {
    workspace: "pending",
    generation: "pending",
    page: "pending",
  });
  prefs.update({ workspace: "skipped" });
  prefs.update({ generation: "confirmed" });
  prefs.update({ page: "done" });
  assert.deepEqual(prefs.read(), {
    workspace: "skipped",
    generation: "confirmed",
    page: "done",
  });
  prefs.update({ generation: "direct" });
  prefs.update({ workspace: "pending", page: "pending" });
  assert.equal(
    prefs.read().generation,
    "direct",
    "help replay must not change paid-action consent",
  );
  assert.equal(
    createOnboardingPreferences("hosted:fixture-two", () => s).read()
      .generation,
    "pending",
  );
  // Account login removes legacy autoppt- caches; preferences must survive.
  for (const key of s.entries.keys())
    if (key.startsWith("autoppt-")) s.entries.delete(key);
  assert.equal(createOnboardingPreferences("hosted:fixture-one", () => s).read().generation, "direct");
  assert.match([...s.entries.keys()][0], /^autoppt:onboarding:v1:/);
  assert.deepEqual(Object.keys(JSON.parse([...s.entries.values()][0])), [
    "workspace",
    "generation",
    "page",
  ]);
});
test("unavailable, corrupt or unexpected local preferences do not block the session", () => {
  const prefs = createOnboardingPreferences("local-browser", () => {
    throw Error("storage blocked");
  });
  assert.equal(prefs.read().workspace, "pending");
  assert.equal(prefs.update({ workspace: "complete" }).workspace, "complete");
  assert.equal(prefs.read().workspace, "complete");
  const s = storage();
  s.getItem = () => "{broken";
  assert.equal(
    createOnboardingPreferences("broken", () => s).read().generation,
    "pending",
  );
  s.getItem = () =>
    JSON.stringify({
      workspace: "unexpected",
      generation: "yes",
      page: true,
      apiKey: "do not keep",
    });
  const clean = createOnboardingPreferences("invalid", () => s);
  assert.deepEqual(clean.read(), {
    workspace: "pending",
    generation: "pending",
    page: "pending",
  });
  clean.update({ page: "done" });
  assert(![...s.entries.values()][0].includes("apiKey"));
});
test("readiness uses bootstrap readiness and capability policy, with no invented balance or paths", () => {
  const data = {
    settings: { text: { hasKey: true }, image: { hasKey: false } },
    styles: [{ id: "one", rules: "usable" }],
  };
  const local = onboardingReadiness(data, {
    localModelSettings: { enabled: true },
  });
  assert.deepEqual(local, {
    textReady: true,
    imageReady: false,
    styleReady: true,
    modelsReady: false,
    ready: false,
    managed: false,
  });
  assert.equal(
    onboardingReadiness(
      { ...data, styles: [{ rules: "x", deletedAt: "date" }] },
      { localModelSettings: { enabled: false } },
    ).styleReady,
    false,
  );
  assert.equal(
    onboardingReadiness(data, { localModelSettings: { enabled: false } })
      .managed,
    true,
  );
  assert.equal(safeWorkspaceLabel("/Users/private/data"), "工作区");
  assert.equal(safeWorkspaceLabel("C:\\private\\data"), "工作区");
  assert.equal(safeWorkspaceLabel("Mac App 独立工作区"), "Mac App 独立工作区");
});
