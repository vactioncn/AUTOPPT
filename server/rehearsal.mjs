import { randomUUID } from "node:crypto";
import { projectOrThrow, put, now } from "./store.mjs";
import { contentSignature } from "../shared/rehearsal.mjs";
import { runtimeMode } from "./diagnostics.mjs";
const fail = (message, status = 409) => {
  throw Object.assign(new Error(message), { status });
};
export function registerRehearsal(
  app,
  { available = () => runtimeMode() !== "hosted" } = {},
) {
  // Ephemeral play sessions never enter project packages. An interrupted run
  // can simply be restarted. Completed records live in the existing project JSON.
  const sessions = new Map();
  const getProject = (req) => {
    if (!available()) fail("当前平台未开放标准放映，可直接检查交付。", 403);
    return projectOrThrow(req.params.id);
  };
  app.post("/api/projects/:id/rehearsal/start", (req, res) => {
    const p = getProject(req);
    if (!p.slides.length || p.slides.some((s) => !s.image && !s.scene))
      fail("请先补齐全部页面画面，再从头演练。");
    const signature = contentSignature(p);
    if (req.body.signature !== signature) fail("内容已更新，请重新打开演练。");
    const time = Date.now();
    for (const [key, run] of sessions)
      if (time - run.time > 12 * 3600000) sessions.delete(key);
    if (sessions.size >= 1000) sessions.delete(sessions.keys().next().value);
    const session = randomUUID();
    sessions.set(session, { projectId: p.id, signature, last: -1, time });
    res.json({ session });
  });
  const read = (req) => {
    const p = getProject(req),
      run = sessions.get(req.body.session);
    if (!run || run.projectId !== p.id || Date.now() - run.time > 12 * 3600000)
      fail("这次演练已结束，请从头开始。");
    if (run.signature !== contentSignature(p)) fail("内容已更新，请重新演练。");
    return { p, run };
  };
  app.post("/api/projects/:id/rehearsal/page", (req, res) => {
    const { p, run } = read(req),
      index = req.body.index;
    if (
      !Number.isInteger(index) ||
      index < 0 ||
      index >= p.slides.length ||
      index > run.last + 1
    )
      fail("请按顺序完成演练。");
    run.last = Math.max(run.last, index);
    res.json({ visited: run.last + 1 });
  });
  app.post("/api/projects/:id/rehearsal/complete", (req, res) => {
    const { p, run } = read(req);
    if (run.last !== p.slides.length - 1)
      fail("请从头播放完全部页面，再结束演练。");
    run.completedAt ||= now();
    p.rehearsal = { signature: run.signature, completedAt: run.completedAt };
    put("project", p); // Do not bump the mother deck revision.
    res.json(p.rehearsal);
  });
}
