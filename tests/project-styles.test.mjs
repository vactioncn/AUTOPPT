import test from "node:test";
import assert from "node:assert/strict";
import { projectStyles, HOSTED_BUILTIN_STYLE_IDS } from "../shared/styles.mjs";
import { styleLibraryEntries } from "../shared/style-library.mjs";

test("hosted project choices use the approved snapshot while management keeps drafts", () => {
  const source = {
    id: "source",
    rules: "unpublished edits",
    publishedAt: "saved",
  };
  const draft = { id: "draft", rules: "private draft" };
  const published = {
    id: "catalog-source",
    catalogSourceId: source.id,
    rules: "approved",
  };
  const styles = [source, draft, published];
  const before = structuredClone(styles);
  assert.deepEqual(projectStyles(styles, true), [published]);
  assert.equal(
    styleLibraryEntries(styles, { hosted: true, canManage: true }).length,
    2,
  );
  assert.deepEqual(projectStyles(styles), styles);
  assert.deepEqual(styles, before);

  published.catalogHidden = true;
  assert.deepEqual(projectStyles(styles, true), []);
  assert.deepEqual(projectStyles(styles, true, published.id), [published]);
  assert.deepEqual(projectStyles(styles, true, source.id), [source]);
  assert.equal(
    styleLibraryEntries(styles, { hosted: true, canManage: true }).length,
    2,
  );
});

test("withdrawing a published built-in never restores its source as a new-project choice", () => {
  const builtin = {
    id: HOSTED_BUILTIN_STYLE_IDS[0],
    builtin: true,
    rules: "release rules",
  };
  const withdrawn = {
    id: `catalog-${builtin.id}`,
    catalogSourceId: builtin.id,
    replacesStyleId: builtin.id,
    catalogHidden: true,
    rules: "last approved",
  };
  assert.deepEqual(projectStyles([builtin], true), [builtin]);
  assert.deepEqual(projectStyles([builtin, withdrawn], true), []);
  assert.deepEqual(projectStyles([builtin, withdrawn], true, withdrawn.id), [
    withdrawn,
  ]);
  assert.deepEqual(projectStyles([builtin, withdrawn], true, builtin.id), [
    builtin,
  ]);
});

test("customer redaction is supported; project-only, deleted and unusable styles cannot be newly selected", () => {
  const publicStyle = {
    id: "approved",
    catalogSourceId: "source",
    canUse: true,
    rules: "",
  };
  const imported = {
    id: "imported",
    projectOnly: true,
    rules: "legacy project",
  };
  const invalid = [
    { ...publicStyle, id: "deleted", deletedAt: "saved" },
    { ...publicStyle, id: "disabled", canUse: false },
    { id: "empty", catalogSourceId: "empty-source", rules: " " },
    imported,
  ];
  assert.deepEqual(projectStyles([publicStyle, ...invalid], true), [
    publicStyle,
  ]);
  assert.deepEqual(
    projectStyles([publicStyle, ...invalid], true, imported.id),
    [publicStyle, imported],
  );
});
