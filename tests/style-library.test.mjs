import test from "node:test";
import assert from "node:assert/strict";
import { styleLibraryEntries } from "../shared/style-library.mjs";
import { HOSTED_BUILTIN_STYLE_IDS } from "../shared/styles.mjs";

const builtins = () =>
  HOSTED_BUILTIN_STYLE_IDS.map((id) => ({ id, builtin: true }));
test("both roles browse the published version; admin actions target its editable source", () => {
  const source = {
    id: "custom",
    name: "private revision",
    cover: "draft.jpg",
    publishedAt: "saved",
  };
  const published = {
    id: "catalog-custom",
    catalogSourceId: "custom",
    name: "published revision",
    cover: "published.jpg",
    examples: [{ id: "public" }],
  };
  const styles = [...builtins(), source, published];
  const before = structuredClone(styles);
  const admin = styleLibraryEntries(styles, { canManage: true, hosted: true });
  const customer = styleLibraryEntries([...builtins(), published], {
    hosted: true,
  });
  assert.deepEqual(
    admin.map((e) => e.style),
    customer.map((e) => e.style),
  );
  assert.equal(admin.at(-1).style, published);
  assert.equal(admin.at(-1).manageStyle, source);
  assert.equal(admin.at(-1).unpublished, false);
  assert(customer.every((e) => !e.manageStyle));
  assert.deepEqual(styles, before);
});

test("published builtin replacement appears once while its source remains editable", () => {
  const styles = builtins();
  const source = styles[0];
  const published = {
    id: "catalog-" + source.id,
    catalogSourceId: source.id,
    replacesStyleId: source.id,
  };
  const admin = styleLibraryEntries([...styles, published], {
    canManage: true,
    hosted: true,
  });
  const customer = styleLibraryEntries([...styles, published], {
    hosted: true,
  });
  assert.equal(admin.length, 4);
  assert.deepEqual(
    admin.map((e) => e.style),
    customer.map((e) => e.style),
  );
  assert.equal(
    admin.find((e) => e.style.id === published.id).manageStyle,
    source,
  );
});

test("unpublished styles remain in the admin library without a second catalog or exposing hidden copies", () => {
  const draft = { id: "draft", rules: "private" };
  const hidden = {
    id: "catalog-draft",
    catalogSourceId: "draft",
    catalogHidden: true,
  };
  const deleted = { id: "removed", deletedAt: "keep" };
  const legacy = { id: "bold", builtin: true };
  const result = styleLibraryEntries(
    [...builtins(), draft, hidden, deleted, legacy],
    { canManage: true, hosted: true },
  );
  assert.deepEqual(
    result.map((e) => e.style.id),
    [...HOSTED_BUILTIN_STYLE_IDS, draft.id],
  );
  assert.equal(result.at(-1).unpublished, true);
  assert.equal(result.at(-1).manageStyle, draft);
  const local = styleLibraryEntries([legacy, draft], { canManage: true });
  assert.equal(local.length, 2);
  assert(local.every((e) => !e.unpublished && e.manageStyle));
});
