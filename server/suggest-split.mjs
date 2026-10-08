import { createHash } from "node:crypto";
import { get, put, transaction, projectOrThrow } from "./store.mjs";
import { sentences, unitsFromEnds } from "./core.mjs";
import { jsonModel } from "./models.mjs";

const fail = (message) => {
  throw Object.assign(new Error(message), { status: 409 });
};

export function registerSuggestSplit(app, { model = jsonModel } = {}) {
  const running = new Map();
  app.post("/api/projects/:id/suggest-split", async (req, res) => {
    const p = projectOrThrow(req.params.id);
    const { slideId, requestId } = req.body;
    if (typeof requestId !== "string" || !/^[\w-]{16,80}$/.test(requestId))
      throw Object.assign(new Error("请重新打开拆分窗口后再试。"), {
        status: 400,
      });
    const s = p.slides.find((s) => s.id === slideId);
    if (!s) throw new Error("页面不存在");
    const id = JSON.stringify([p.id, slideId, requestId]);
    const digest = createHash("sha256").update(s.notes).digest("hex");
    // Claim before any asynchronous work. Completed results survive lost HTTP
    // responses and server restarts; no manuscript or credentials are stored.
    const existing = transaction(() => {
      const record = get("split-suggestion", id);
      if (!record) put("split-suggestion", { id, digest, status: "pending" });
      return record;
    });
    if (existing) {
      if (existing.digest !== digest) fail("原文已变化，请重新打开拆分窗口。");
      if (existing.status === "complete") return res.json(existing.result);
      if (running.has(id)) return res.json(await running.get(id));
      // An interrupted/failed call may already have been charged. Never replay it.
      fail(
        "上次建议未能确认完成。为避免重复调用，请手动分界；如需新建议，请重新打开拆分窗口并确认。",
      );
    }
    const operation = (async () => {
      const parts = sentences(s.notes);
      let cuts = [];
      if (parts.length >= 2) {
        const out = await model(
          '分析演讲段落，建议语义转折的分界。只建议，不改写。返回 {"ends":[各单元最后一句编号]}，从1开始，严格递增，最后一个为总句数。',
          parts.map((s, i) => `[${i + 1}]${s}`).join("\n"),
        );
        const units = unitsFromEnds(parts, out.ends);
        let n = 0;
        cuts = units.slice(0, -1).map((u) => (n += u.length));
      }
      const result = { cuts };
      put("split-suggestion", { id, digest, status: "complete", result });
      return result;
    })();
    running.set(id, operation);
    try {
      res.json(await operation);
    } finally {
      running.delete(id);
    }
  });
}
