import test from "node:test";
import assert from "node:assert/strict";
import {
  manuscriptTitle,
  presentationProgress,
} from "../shared/first-picture.mjs";
import { workspaceTarget } from "../shared/web-routes.mjs";

test("first picture routes survive login, unsafe redirect targets do not", () => {
  for (const route of [
    "new",
    "new/example",
    "new/27266b4f-7da5-4549-ae74-7c9cf7e910ca",
  ])
    assert.equal(workspaceTarget(route), route);
  for (const route of [
    "new/../../admin",
    "new/https://example.com",
    "//example.com",
    "new/invalid",
  ])
    assert.equal(workspaceTarget(route), "projects");
});
test("suggested names never modify manuscript, continuation favors actionable unfinished work", () => {
  const original = "\n# 我的第一场分享\n  原文、标点都要保留。";
  assert.equal(manuscriptTitle(original), "我的第一场分享");
  assert.equal(manuscriptTitle(""), "我的演讲");
  assert.equal(manuscriptTitle("长".repeat(200)).length, 36);
  const p = {
    draft: "",
    batches: [{ slideIds: ["a", "b"], generationMode: "preview" }],
    slides: [{ id: "a", image: "old.png" }, { id: "b" }],
  };
  const before = structuredClone(p);
  assert.equal(presentationProgress(p).kind, "preview");
  assert.equal(presentationProgress(p, true).kind, "working");
  assert.deepEqual(p, before);
  p.slides[1].status = "error";
  assert.equal(presentationProgress(p).kind, "failed");
  p.slides[1] = { id: "b", image: "new.png" };
  assert.equal(presentationProgress(p).kind, "ready");
  p.slides[0].stale = true;
  assert.equal(presentationProgress(p).kind, "review");
  p.slides[0].stale = false;
  p.draft = "新草稿";
  assert.equal(presentationProgress(p).kind, "draft");
  p.batches.push({ slideIds: [] });
  p.draft = "";
  assert.equal(presentationProgress(p).kind, "draft");
});
