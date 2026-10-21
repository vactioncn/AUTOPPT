import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { RELEASE_STYLES } from "../shared/builtin-style-catalog.mjs";
import {
  DEFAULT_STYLE_ID,
  HOSTED_BUILTIN_STYLE_IDS,
} from "../shared/styles.mjs";

// These are the four approved styles shown in the hosted library. Their full
// prompts teach authoring, while the user's new images supply the visual facts.
const catalog = [
  {
    id: DEFAULT_STYLE_ID,
    name: "克制儿童摄影杂志风",
    promptFile: "restrained-childhood-editorial.txt",
  },
  ...RELEASE_STYLES,
];
export const STYLE_WRITING_EXAMPLES = HOSTED_BUILTIN_STYLE_IDS.map((id) => {
  const item = catalog.find((style) => style.id === id);
  if (!item) throw new Error(`Missing approved style writing example: ${id}`);
  const prompt = readFileSync(
    new URL(`./styles/${item.promptFile}`, import.meta.url),
    "utf8",
  ).trim();
  return {
    id,
    name: item.name,
    prompt,
    sha256: createHash("sha256").update(prompt).digest("hex"),
  };
});
export const writingExampleSources = STYLE_WRITING_EXAMPLES.map(
  ({ id, name, sha256 }) => ({ id, name, sha256 }),
);
