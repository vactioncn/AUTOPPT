import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

test(
  "provider recovery meters each attempt and batch checkpoints survive failures and changed notes",
  { timeout: 40000 },
  async (t) => {
    const dir = mkdtempSync(path.join(tmpdir(), "autoppt-model-recovery-"));
    process.env.AUTOPPT_DATA_DIR = dir;
    const config = {
      baseUrl: "http://fixture.invalid/v1",
      apiKey: "sk-fixture",
      model: "fixture-model",
    };
    writeFileSync(
      path.join(dir, "settings.json"),
      JSON.stringify({ text: config, image: config }),
    );
    const store = await import("../server/store.mjs");
    const { request, analyzePageContents } =
      await import("../server/models.mjs");
    const { enqueue, retry, newSlide } = await import("../server/jobs.mjs");
    t.after(() => {
      store.db.close();
      rmSync(dir, { recursive: true, force: true });
    });
    const handshake = {
      error: {
        message:
          'Post "https://example.test/responses": utls: TLS handshake: EOF',
      },
    };
    const response = (status, data) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { "content-type": "application/json" },
      });
    let calls = 0;
    const fetchMock = t.mock.method(globalThis, "fetch", async () => {
      calls++;
      return calls === 1
        ? response(500, handshake)
        : response(200, {
            choices: [{ message: { content: "{}" } }],
            usage: { prompt_tokens: 12, completion_tokens: 3 },
          });
    });
    await request("text", "/chat/completions", { model: config.model });
    assert.equal(calls, 2);
    const events = store.all("usage-event");
    assert.equal(events.length, 2);
    assert.equal(
      events.filter((e) => e.status === "uncertain" && e.httpStatus === 500)
        .length,
      1,
    );
    assert.equal(
      events.filter((e) => e.status === "success" && e.usage.inputTokens === 12)
        .length,
      1,
    );
    for (const [kind, status, data] of [
      ["image", 500, handshake],
      ["text", 500, { error: "generic error" }],
      ["text", 401, handshake],
      ["text", 500, { ...handshake, uncertain: true }],
    ]) {
      calls = 0;
      fetchMock.mock.mockImplementation(async () => {
        calls++;
        return response(status, data);
      });
      await assert.rejects(request(kind, "/fixture", { model: config.model }));
      assert.equal(calls, 1);
    }
    // A clear 503 rejection may recover for text and images, and every physical attempt is metered.
    for (const kind of ["text", "image"]) {
      calls = 0;
      const before = store.all("usage-event").length;
      fetchMock.mock.mockImplementation(async () => {
        calls++;
        return calls === 1
          ? response(503, {
              error: {
                message:
                  "auth_unavailable: no auth available; last upstream error: server_is_overloaded",
              },
            })
          : response(
              200,
              kind === "text"
                ? {
                    choices: [{ message: { content: "{}" } }],
                    usage: { prompt_tokens: 8, completion_tokens: 2 },
                  }
                : { data: [{ b64_json: "saved-image" }] },
            );
      });
      await request(kind, "/fixture", { model: config.model });
      assert.equal(calls, 2);
      assert.equal(store.all("usage-event").length, before + 2);
    }

    const style = store.put("style", {
      id: "style",
      name: "Fixture",
      rules: "Keep the source",
      referenceImages: [],
      revision: 1,
    });
    const slides = Array.from({ length: 17 }, (_, i) =>
      newSlide(`这是第${i + 1}页原文。`, [], style.id),
    );
    store.put("project", {
      id: "project",
      title: "Fixture",
      styleId: style.id,
      slides,
      batches: [],
      revision: 1,
    });
    let round = 1,
      groupCalls = 0;
    const requested = [];
    fetchMock.mock.mockImplementation(async (url, options) => {
      const body = JSON.parse(options.body);
      if (!body.messages?.[0].content.includes("演讲内容关系分析师"))
        return response(400, {
          error: "Stop before generation in this fixture",
        });
      const { pages } = JSON.parse(body.messages[1].content[0].text);
      requested.push({ round, ids: pages.map((p) => p.id) });
      groupCalls++;
      if (round === 1 && groupCalls === 2)
        return response(500, { error: "generic temporary failure" });
      const out = {
        pages: pages.map((p) => ({
          id: p.id,
          claim: "原文观点",
          relationship: "statement",
          evidence: p.notes,
          entities: ["内容"],
          visualTask: "呈现观点",
          mustNotImply: [],
        })),
      };
      if (round === 2 && groupCalls === 2)
        out.pages[0].evidence = "不存在的内容";
      return response(200, {
        choices: [{ message: { content: JSON.stringify(out) } }],
      });
    });
    const job = enqueue("render", "project", {
      slideIds: slides.map((s) => s.id),
    });
    async function finished() {
      for (let i = 0; i < 800; i++) {
        const j = store.get("job", job.id);
        if (j.status === "failed" || j.status === "completed") {
          await delay(0);
          return j;
        }
        await delay(10);
      }
      throw new Error("Job did not settle");
    }
    let saved = await finished();
    assert.equal(saved.status, "failed");
    assert.equal(Object.keys(saved.payload.contentBriefs).length, 8);
    assert.deepEqual(
      requested[0].ids,
      slides.slice(0, 8).map((s) => s.id),
    );
    round = 2;
    groupCalls = 0;
    retry(job.id);
    saved = await finished();
    assert.equal(Object.keys(saved.payload.contentBriefs).length, 16);
    assert.deepEqual(
      requested.find((x) => x.round === 2).ids,
      slides.slice(8, 16).map((s) => s.id),
    );
    assert.equal(
      saved.payload.contentBriefs[slides[16].id],
      undefined,
      "invalid batch must not be checkpointed",
    );
    const project = store.get("project", "project");
    project.slides[0].notes = "本页原稿已经修改。";
    store.put("project", project);
    round = 3;
    groupCalls = 0;
    retry(job.id);
    saved = await finished();
    assert.deepEqual(
      requested.filter((x) => x.round === 3).map((x) => x.ids),
      [[slides[0].id, slides[16].id]],
    );
    assert.equal(Object.keys(saved.payload.contentBriefs).length, 17);
    assert.equal(
      saved.payload.contentBriefs[slides[0].id].notes,
      "本页原稿已经修改。",
    );
    assert.equal(
      store.get("project", "project").slides.every((s) => !s.image),
      true,
    );
    // A retry on an original 17-page batch scopes its counters to the two missing pages.
    const partial = store.get("project", "project");
    partial.slides.slice(0, 15).forEach((s) => {
      s.image = "saved.png";
      s.status = "ready";
    });
    store.put("project", partial);
    const existingVersions = partial.slides
      .slice(0, 15)
      .map((s) => structuredClone(s));
    round = 4;
    retry(job.id);
    saved = await finished();
    assert.equal(saved.pageProgress.total, 2);
    assert.equal(saved.pageProgress.preserved, 15);
    assert.equal(saved.pageProgress.failed.length, 2);
    assert.equal(saved.pageProgress.succeeded, 0);
    assert.equal(saved.pageProgress.current, null);
    assert.equal(saved.done, 2);
    assert.equal(saved.total, 2);
    assert.deepEqual(
      saved.pageProgress.failed.map((p) => p.page),
      [16, 17],
    );
    assert.deepEqual(
      store.get("project", "project").slides.slice(0, 15),
      existingVersions,
      "saved pages are never submitted or modified by retry",
    );
    // The live job exposes the same bounded connection wait as the request policy.
    let designCalls = 0;
    fetchMock.mock.mockImplementation(async () => {
      designCalls++;
      return designCalls === 1
        ? response(500, handshake)
        : response(400, { error: "fixture stops before image generation" });
    });
    retry(job.id);
    let waitingJob;
    for (let i = 0; i < 300; i++) {
      waitingJob = store.get("job", job.id);
      if (waitingJob.autoRetry) break;
      await delay(10);
    }
    assert.equal(waitingJob.autoRetry.attempt, 1);
    assert.equal(waitingJob.autoRetry.seconds, 2);
    assert.equal(waitingJob.pageProgress.current.page, 16);
    assert.equal(
      waitingJob.pageProgress.failed.length,
      0,
      "prior attempt failures must clear on retry",
    );
    saved = await finished();
    assert.equal(saved.autoRetry, undefined);
    assert.equal(saved.pageProgress.failed.length, 2);
    // A 503 recovery keeps the page running; no failure is exposed until recovery ends.
    designCalls = 0;
    fetchMock.mock.mockImplementation(async () => {
      designCalls++;
      return designCalls === 1
        ? response(503, {
            error: { code: "server_is_overloaded", message: "busy" },
          })
        : response(400, { error: "fixture stops before image generation" });
    });
    retry(job.id);
    for (let i = 0; i < 100; i++) {
      waitingJob = store.get("job", job.id);
      if (waitingJob.autoRetry) break;
      await delay(10);
    }
    assert.equal(waitingJob.status, "running");
    assert.equal(waitingJob.autoRetry.reason, "模型服务繁忙");
    assert.ok(
      waitingJob.autoRetry.seconds >= 5 && waitingJob.autoRetry.seconds <= 6,
    );
    assert.equal(waitingJob.pageProgress.failed.length, 0);
    assert.equal(waitingJob.pageProgress.current.page, 16);
    assert.deepEqual(
      store.get("project", "project").slides.slice(0, 15),
      existingVersions,
    );
    saved = await finished();
    assert.equal(saved.autoRetry, undefined);
    assert.equal(saved.pageProgress.failed.length, 2);
    // Restore valid analysis responses for the cancellation checkpoint below.
    fetchMock.mock.mockImplementation(async (url, options) => {
      const body = JSON.parse(options.body);
      const { pages } = JSON.parse(body.messages[1].content[0].text);
      requested.push({ round: 5, ids: pages.map((p) => p.id) });
      return response(200, {
        choices: [
          {
            message: {
              content: JSON.stringify({
                pages: pages.map((p) => ({
                  id: p.id,
                  claim: "原文观点",
                  relationship: "statement",
                  evidence: p.notes,
                  entities: ["内容"],
                  visualTask: "呈现观点",
                  mustNotImply: [],
                })),
              }),
            },
          },
        ],
      });
    });
    const controller = new AbortController();
    const before = requested.length;
    let checkpoints = 0;
    await assert.rejects(
      analyzePageContents(
        slides.slice(0, 9).map(({ id, notes }) => ({ id, notes })),
        "Fixture",
        controller.signal,
        () => {
          checkpoints++;
          controller.abort();
        },
      ),
      { name: "AbortError" },
    );
    assert.equal(checkpoints, 1);
    assert.equal(
      requested.length - before,
      1,
      "cancellation must not start another batch",
    );
  },
);
