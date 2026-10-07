import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const { outputText } = ts.transpileModule(
  readFileSync(new URL("../../src/onboarding.ts", import.meta.url), "utf8"),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
    },
  },
);
export function preferenceStorage() {
  const entries = new Map();
  return {
    entries,
    get length() {
      return entries.size;
    },
    key: (index) => [...entries.keys()][index] ?? null,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, value),
    removeItem: (key) => entries.delete(key),
  };
}

// New JS realm and empty sessionStorage on every launch; only localStorage survives.
// Exercise the production default storage instead of injecting a storage callback.
export function launchGenerationClient(scope, localStorage) {
  const exports = {};
  const sessionStorage = preferenceStorage();
  runInNewContext(outputText, {
    exports,
    localStorage,
    sessionStorage,
    crypto,
    TextEncoder,
  });
  return { request: exports.createGenerationRequest(scope), sessionStorage };
}
