import { requestIdentity } from "./helpers/request-identity.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  readFileSync,
} from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import http from "node:http";
import { once } from "node:events";
import { fork } from "node:child_process";
import { silenceMp3 } from "./helpers/speech-audio.mjs";
import { SPEECH_DEFAULTS } from "../shared/speech.mjs";

test(
  "local AI ledger records actual attempts, prices, attribution and budget without charging or exposing content",
  { timeout: 120000 },
  async (t) => {
    const dir = mkdtempSync(path.join(tmpdir(), "autoppt-usage-"));
    process.env.AUTOPPT_DATA_DIR = dir;
    let mode = "normal",
      calls = 0;
    const provider = http.createServer(async (req, res) => {
      let raw = "";
      for await (const b of req) raw += b;
      const body = raw.startsWith("{") ? JSON.parse(raw) : {};
      calls++;
      res.setHeader("content-type", "application/json");
      if (mode === "limited") {
        res.statusCode = 429;
        return res.end(JSON.stringify({ error: "private-provider-detail" }));
      }
      if (mode === "disconnect") return req.socket.destroy();
      if (req.url.endsWith("/t2a_v2"))
        return res.end(
          JSON.stringify({
            base_resp: { status_code: 0 },
            trace_id: "speech-request",
            data: { status: 2, audio: silenceMp3.toString("hex") },
            extra_info: { usage_characters: 42, audio_length: 2100 },
          }),
        );
      if (req.url.endsWith("/files/upload"))
        return res.end(
          JSON.stringify({
            base_resp: { status_code: 0 },
            file: { file_id: "123456789012345678" },
          }),
        );
      if (req.url.endsWith("/voice_clone"))
        return res.end(
          JSON.stringify({
            base_resp: { status_code: 0 },
            trace_id: "clone-request",
          }),
        );
      if (req.url.includes("/images/"))
        return res.end(
          JSON.stringify({
            data: [{ b64_json: "test-image-content" }],
            usage: { input_tokens: 20, output_tokens: 30, total_tokens: 50 },
          }),
        );
      if (body.messages?.[0]?.content.includes("分析演讲段落"))
        return res.end(
          JSON.stringify({
            id: "split-request",
            choices: [{ message: { content: '{"ends":[1,2]}' } }],
            usage: {
              prompt_tokens: 1000,
              completion_tokens: 100,
              total_tokens: 1100,
              prompt_tokens_details: { cached_tokens: 400 },
            },
          }),
        );
      return res.end(
        JSON.stringify({
          id: "text-request",
          choices: [{ message: { content: "{}" } }],
          usage:
            mode === "missing"
              ? undefined
              : {
                  prompt_tokens: 1000,
                  completion_tokens: 100,
                  total_tokens: 1100,
                  prompt_tokens_details: { cached_tokens: 400 },
                  completion_tokens_details: { reasoning_tokens: 20 },
                },
        }),
      );
    });
    provider.listen(0, "127.0.0.1");
    await once(provider, "listening");
    const baseUrl = `http://127.0.0.1:${provider.address().port}/v1`,
      config = { baseUrl, apiKey: "sk-private-fixture", model: "ledger-text" };
    writeFileSync(
      path.join(dir, "settings.json"),
      JSON.stringify({
        text: config,
        image: { ...config, model: "ledger-image" },
      }),
    );
    writeFileSync(
      path.join(dir, "speech-settings.json"),
      JSON.stringify({ ...config, model: "speech-2.8-hd" }),
    );
    const store = await import("../server/store.mjs");
    const {
      withUsage,
      trackUsage,
      saveRate,
      addBudget,
      usageReport,
      usageSettings,
      rateKey,
      providerIdentity,
      recoverUsage,
      recordCache,
      usageCsv,
    } = await import("../server/usage/index.mjs");
    const { jsonModel, request } = await import("../server/models.mjs");
    const { synthesize, cloneVoice } =
      await import("../server/speech/provider.mjs");
    t.after(() => {
      provider.closeAllConnections();
      provider.close();
      store.db.close();
      rmSync(dir, { recursive: true, force: true });
    });
    store.put("project", {
      id: "p1",
      title: "=Project One",
      updatedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      revision: 1,
      slides: [
        {
          id: "slide-1",
          notes: "大家好。今天讲一个故事。",
          status: "ready",
          versions: [],
          batchIds: [],
        },
      ],
      batches: [],
    });
    store.put("project", {
      id: "p2",
      title: "Project Two",
      updatedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      revision: 1,
      slides: [],
      batches: [],
    });
    const identity = providerIdentity(config),
      rate = {
        ...identity,
        model: config.model,
        kind: "text",
        size: "",
        quality: "",
        unit: "tokens",
        input: 10,
        output: 20,
        cached: 2,
        note: "fixture pricing",
      };
    const rows = () =>
      store.db
        .prepare(
          "SELECT data FROM records WHERE kind = 'usage-event' ORDER BY rowid DESC",
        )
        .all()
        .map((r) => JSON.parse(r.data));
    const scope = {
      projectId: "p1",
      pageId: "slide-1",
      taskId: "task1",
      feature: "演讲制作",
    };
    await t.test(
      "response usage is retained, cache input is not double-counted, and price snapshots are immutable",
      async () => {
        recoverUsage();
        saveRate(rate);
        await withUsage(scope, () =>
          jsonModel("fixture", "private manuscript"),
        );
        const row = rows()[0];
        assert.equal(row.costMicro, 8800); // 600 * 10 + 400 * 2 + 100 * 20, yuan / million
        assert.equal(row.usage.totalTokens, 1100);
        assert.equal(row.projectId, "p1");
        assert.equal(row.pageId, "slide-1");
        saveRate({ ...rate, input: 100 });
        assert.equal(rows().find((r) => r.id === row.id).rate.input, 10);
        assert.equal(rows().find((r) => r.id === row.id).costMicro, 8800);
        const text = JSON.stringify(rows());
        assert(!text.includes("private manuscript"));
        assert(!text.includes(config.apiKey));
      },
    );
    await t.test(
      "missing price, missing usage, rejection and uncertain dispatch remain explicit unknown costs",
      async () => {
        mode = "missing";
        await jsonModel("fixture", "hidden");
        assert.equal(rows()[0].costMicro, null);
        mode = "limited";
        await assert.rejects(jsonModel("fixture", "hidden"));
        assert.equal(rows()[0].status, "rejected");
        assert.equal(rows()[0].costMicro, null);
        mode = "disconnect";
        await assert.rejects(jsonModel("fixture", "hidden"));
        assert.equal(rows()[0].status, "uncertain");
        assert.equal(rows()[0].costMicro, null);
        mode = "normal";
        await request("image", "/images/generations", {
          model: "ledger-image",
          size: "2560x1440",
          quality: "high",
        });
        assert.equal(rows()[0].usage.images, 1);
        assert.equal(rows()[0].costMicro, null);
        const image = rows()[0];
        saveRate({ ...image, unit: "image", price: 0.25 });
        const form = new FormData();
        form.set("model", "ledger-image");
        form.set("size", "2560x1440");
        form.set("quality", "high");
        await request("image", "/images/edits", form, undefined, true);
        assert.equal(rows()[0].costMicro, 250000);
        assert.equal(rows().find((r) => r.id === image.id).costMicro, null);
      },
    );
    await t.test(
      "speech uses provider characters, cached audio is free, and clone upload is not double-billed",
      async () => {
        const speechConfig = { ...config, model: "speech-2.8-hd" };
        saveRate({
          ...identity,
          model: speechConfig.model,
          kind: "speech",
          unit: "characters",
          price: 3,
        });
        await withUsage({ ...scope, feature: "口播试听" }, () =>
          synthesize(
            speechConfig,
            "this string is not 42 characters",
            SPEECH_DEFAULTS,
          ),
        );
        assert.equal(rows()[0].costMicro, 12600);
        assert.equal(rows()[0].usage.characters, 42);
        assert.equal(rows()[0].usage.characterSource, "provider");
        assert.equal(rows()[0].usage.audioSeconds, 2.1);
        const before = calls;
        recordCache(speechConfig, 2.1);
        assert.equal(calls, before);
        assert.equal(rows()[0].costMicro, 0);
        assert.equal(rows()[0].status, "cached");
        const n = rows().length;
        saveRate({
          ...identity,
          model: "voice-clone",
          kind: "clone",
          unit: "call",
          price: 9.99,
        });
        const b = Buffer.alloc(44 + 32000 * 12);
        b.write("RIFF");
        b.writeUInt32LE(b.length - 8, 4);
        b.write("WAVEfmt ", 8);
        b.writeUInt32LE(16, 16);
        b.writeUInt16LE(1, 20);
        b.writeUInt16LE(1, 22);
        b.writeUInt32LE(16000, 24);
        b.writeUInt32LE(32000, 28);
        b.writeUInt16LE(2, 32);
        b.writeUInt16LE(16, 34);
        b.write("data", 36);
        b.writeUInt32LE(b.length - 44, 40);
        await cloneVoice(speechConfig, { buffer: b }, "fixture-voice");
        assert.equal(rows().length, n + 1);
        assert.equal(rows()[0].kind, "clone");
        assert.equal(rows()[0].costMicro, 9990000);
      },
    );
    await t.test(
      "concurrent task attribution cannot leak and interrupted calls are recovered",
      async () => {
        await Promise.all(
          ["p1", "p2"].map((projectId, i) =>
            withUsage(
              { projectId, pageId: `page-${i}`, taskId: `task-${i}` },
              async () => {
                await new Promise((r) => setTimeout(r, i * 10));
                await jsonModel("fixture", "hidden");
              },
            ),
          ),
        );
        for (const [i, projectId] of ["p1", "p2"].entries())
          assert(
            rows().some(
              (r) =>
                r.projectId === projectId &&
                r.pageId === `page-${i}` &&
                r.taskId === `task-${i}`,
            ),
          );
        store.put("usage-event", {
          ...rows()[0],
          id: "interrupted-request",
          status: "pending",
          costMicro: null,
        });
        recoverUsage();
        assert.equal(
          rows().find((r) => r.id === "interrupted-request").status,
          "uncertain",
        );
        assert(usageSettings().startedAt);
      },
    );
    await t.test(
      "budget topups are idempotent, filters are consistent, CSV is safe and read-only activity never bills",
      () => {
        const budget = {
          id: "fixture-topup-12345",
          amount: "0.01",
          note: "test budget",
        };
        addBudget(budget);
        addBudget(budget);
        assert.equal(usageReport().budgets.length, 1);
        assert.throws(() => addBudget({ ...budget, amount: "2" }));
        assert.throws(() =>
          addBudget({ ...budget, id: "another-topup-12345", amount: "-1" }),
        );
        assert.throws(() => saveRate({ ...rate, input: "" }));
        assert(usageReport().remainingMicro < 0);
        const p1 = usageReport({ projectId: "p1" });
        assert(p1.rows.every((r) => r.projectId === "p1"));
        assert.equal(p1.summary.requests, p1.rows.length);
        const n = rows().length,
          csv = usageCsv({ projectId: "p1" });
        assert(csv.includes("'=Project One"));
        assert(!csv.includes("private-fixture"));
        assert.equal(rows().length, n);
        assert.throws(() => usageReport({ from: "bad date" }));
      },
    );
    await t.test(
      "real API and browser support prices, budget, project filters, detail and CSV without provider calls",
      async () => {
        const server = fork("server/index.mjs", [], {
          env: {
            ...process.env,
            AUTOPPT_DATA_DIR: dir,
            PORT: "0",
            NODE_ENV: "production",
          },
          stdio: ["ignore", "pipe", "pipe", "ipc"],
        });
        let errors = "";
        server.stderr.on("data", (b) => (errors += b));
        t.after(() => server.kill("SIGTERM"));
        const ready = await Promise.race([
          once(server, "message"),
          once(server, "exit").then(() => {
            throw new Error(errors);
          }),
        ]);
        const base = `http://127.0.0.1:${ready[0].port}`;
        const call = async (route, body) => {
          const r = await fetch(
            base + "/api" + route,
            body
              ? {
                  method: "POST",
                  headers: {
                    "content-type": "application/json",
                    ...requestIdentity(body),
                  },
                  body: JSON.stringify(body),
                }
              : {},
          );
          const d = await r.json();
          assert(r.ok, JSON.stringify(d));
          return d;
        };
        let report = await call("/usage");
        assert(report.total > 8);
        assert.equal(
          (await fetch(base + "/api/usage")).headers.get("cache-control"),
          "no-store",
        );
        const csrf = await fetch(base + "/api/usage/budget", {
          method: "POST",
          headers: {
            origin: "https://evil.example",
            "content-type": "application/json",
          },
          body: JSON.stringify({ id: "bad-topup-123456", amount: "10" }),
        });
        assert.equal(csrf.status, 403);
        const splitRequest = {
          slideId: "slide-1",
          requestId: "usage-split-request-0001",
        };
        const splitResult = await call(
          "/projects/p1/suggest-split",
          splitRequest,
        );
        const afterSplit = calls;
        assert.deepEqual(
          await call("/projects/p1/suggest-split", splitRequest),
          splitResult,
        );
        assert.equal(
          calls,
          afterSplit,
          "replaying a split request must not add model usage",
        );
        report = await call("/usage?projectId=p1");
        assert(
          report.rows.some(
            (r) => r.feature === "段落拆分建议" && r.pageId === "slide-1",
          ),
        );
        const previewBody = {
          projectId: "p1",
          pageId: "slide-1",
          text: "试听这一段。",
          options: SPEECH_DEFAULTS,
        };
        const beforePreview = calls;
        const firstPreview = await call("/speech/preview", previewBody);
        const cachedPreview = await call("/speech/preview", previewBody);
        assert.equal(firstPreview.file, cachedPreview.file);
        assert.equal(calls, beforePreview + 1);
        const speechRows = (await call("/usage?kind=speech&projectId=p1")).rows;
        assert(
          speechRows.some(
            (r) =>
              r.status === "cached" &&
              r.costMicro === 0 &&
              r.pageId === "slide-1",
          ),
        );
        assert(
          speechRows.some(
            (r) =>
              r.status === "success" &&
              r.costMicro === 12600 &&
              r.pageId === "slide-1",
          ),
        );
        const n = calls;
        const { chromium } = await import("playwright-core");
        const browser = await chromium.launch({
          executablePath:
            process.env.CHROMIUM_EXECUTABLE ||
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          headless: true,
        });
        try {
          const page = await browser.newPage({
            viewport: { width: 1440, height: 1000 },
          });
          const pageErrors = [];
          page.on("pageerror", (e) => pageErrors.push(e.message));
          await page.goto(base + "/#usage");
          await page
            .getByRole("heading", { name: "用量与账单", exact: true })
            .waitFor();
          await page.getByRole("button", { name: "全部", exact: true }).click();
          await page
            .getByText("已计入的费用达到预算", { exact: false })
            .waitFor();
          await page
            .getByRole("button", { name: "补充预算", exact: true })
            .click();
          await page
            .getByLabel("金额（人民币元）", { exact: true })
            .fill("100");
          await page.getByLabel("备注", { exact: true }).fill("UI test budget");
          await page
            .getByRole("button", { name: "确认记账", exact: true })
            .click();
          await page
            .getByText("预算已补充。这是本机记账，没有发起支付。", {
              exact: true,
            })
            .waitFor();
          assert.equal((await call("/usage")).budgets.length, 2);
          await page
            .getByRole("button", { name: "模型单价", exact: true })
            .click();
          const model = (await call("/usage")).models.find(
            (m) => m.kind === "text",
          );
          await page
            .getByLabel("服务与模型", { exact: true })
            .selectOption(rateKey(model));
          await page
            .getByLabel("输入价格（元 / 百万 Token）", { exact: true })
            .fill("12");
          await page
            .getByRole("button", { name: "保存单价", exact: true })
            .click();
          await page
            .getByText("已保存，对下一次请求生效。历史费用保留原单价。", {
              exact: true,
            })
            .waitFor();
          await page.keyboard.press("Escape");
          const filteredResponse = page.waitForResponse(
            (r) =>
              r.url().includes("/api/usage?") &&
              r.url().includes("projectId=p1"),
          );
          await page.getByLabel("项目", { exact: true }).selectOption("p1");
          await filteredResponse;
          await page
            .getByRole("button", { name: /查看 .*调用详情/ })
            .first()
            .click();
          await page
            .getByRole("heading", { name: "调用详情", exact: true })
            .waitFor();
          await page.keyboard.press("Escape");
          await page.getByLabel("以积分显示", { exact: false }).check();
          const downloadPromise = page.waitForEvent("download");
          await page
            .getByRole("button", { name: "导出筛选账单 CSV", exact: true })
            .click();
          const download = await downloadPromise;
          assert(
            (await readFileSync(await download.path(), "utf8")).includes(
              "'=Project One",
            ),
          );
          mkdirSync("/tmp/autoppt-usage-review", { recursive: true });
          await page.screenshot({
            path: "/tmp/autoppt-usage-review/ledger.png",
            fullPage: true,
          });
          await page
            .getByRole("button", { name: "模型单价", exact: true })
            .click();
          await page.screenshot({
            path: "/tmp/autoppt-usage-review/rates.png",
            fullPage: true,
          });
          assert.equal(
            calls,
            n,
            "reading/configuring/exporting the ledger must never call AI",
          );
          assert.deepEqual(pageErrors, []);
        } finally {
          await browser.close();
        }
        server.kill("SIGTERM");
        await once(server, "exit");
      },
    );
  },
);
