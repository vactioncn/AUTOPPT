import { requestIdentity } from "./helpers/request-identity.mjs";
import test from "node:test";
import { mockGlobalPlan } from "./helpers/performance-model.mjs";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fork } from "node:child_process";
import { once } from "node:events";
import http from "node:http";
import sharp from "sharp";
import { DatabaseSync } from "node:sqlite";
import {
  performanceFingerprint,
  readPerformanceCheckpoint,
} from "../server/speech/performance-checkpoint.mjs";

test(
  "performance resumes durable page and sentence checkpoints after failure, stop and restart",
  { timeout: 90000 },
  async (t) => {
    const dir = mkdtempSync(path.join(tmpdir(), "autoppt-performance-resume-"));
    mkdirSync(path.join(dir, "assets"));
    await sharp({
      create: { width: 1280, height: 720, channels: 3, background: "#e7eddf" },
    })
      .png()
      .toFile(path.join(dir, "assets/sample.png"));
    const db = new DatabaseSync(path.join(dir, "autoppt.sqlite"));
    db.exec(
      "PRAGMA journal_mode=WAL; CREATE TABLE records(kind TEXT,id TEXT,data TEXT,PRIMARY KEY(kind,id))",
    );
    const project = {
      id: "resume",
      title: "续编验收",
      draft: "",
      revision: 1,
      styleId: "restrained-minimal",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      batches: [],
      slides: [
        "第一段。",
        Array.from({ length: 69 }, (_, i) => `第${i + 1}句。`).join(""),
        "最后一段。",
        "",
      ].map((notes, i) => ({
        id: `p${i}`,
        notes,
        manuscriptVersion: 1,
        plan: { title: `标题${i}` },
        status: "ready",
        image: "sample.png",
        versions: [],
        batchIds: [],
      })),
    };
    const put = (kind, value) =>
      db
        .prepare("INSERT OR REPLACE INTO records VALUES (?,?,?)")
        .run(kind, value.id, JSON.stringify(value));
    const stored = () =>
      JSON.parse(
        db
          .prepare(
            "SELECT data FROM records WHERE kind='speech-script' AND id='resume'",
          )
          .get().data,
      );
    put("project", project);
    const requests = [];
    let mode = "fail",
      release;
    const provider = http.createServer(async (req, res) => {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw),
        input = JSON.parse(body.messages[1].content[0].text);
      requests.push(input);
      res.setHeader("content-type", "application/json");
      if (
        input.stage === "delivery" &&
        input.pageStart === 2 &&
        input.units[0].id === "2:65"
      ) {
        if (mode === "hold")
          await new Promise((r) => {
            release = r;
          });
        if (mode === "fail" || mode === "overload") {
          res.statusCode = 503;
          const message =
            mode === "overload"
              ? "auth_unavailable: no auth available; last upstream error: server_is_overloaded"
              : "test outage";
          if (mode === "overload") mode = "ok";
          return res.end(JSON.stringify({ error: { message } }));
        }
      }
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify(
                  mockGlobalPlan(input) || {
                    units: input.units.map((u) => ({
                      id: u.id,
                      emotion: "calm",
                      pace: 1,
                      pauseAfter: 0.4,
                      emphasis: true,
                      sound: "chuckle",
                      reason: "连贯表达",
                    })),
                  },
                ),
              },
            },
          ],
        }),
      );
    });
    provider.listen(0, "127.0.0.1");
    await once(provider, "listening");
    const config = {
      baseUrl: `http://127.0.0.1:${provider.address().port}/v1`,
      model: "director-mock",
      apiKey: "test",
    };
    writeFileSync(
      path.join(dir, "settings.json"),
      JSON.stringify({ text: config }),
    );
    let proc, base;
    writeFileSync(
      path.join(dir, "speech-settings.json"),
      JSON.stringify({ ...config, model: "speech-2.8-hd" }),
    );
    async function start() {
      proc = fork(
        path.resolve(
          process.env.PERFORMANCE_SERVER_ROOT || ".",
          "server/index.mjs",
        ),
        [],
        {
          silent: true,
          env: {
            ...process.env,
            AUTOPPT_DATA_DIR: dir,
            PORT: "0",
            NODE_ENV: "production",
            AUTOPPT_WORKER_TOKEN: "",
            AUTOPPT_DESKTOP_TOKEN: "",
          },
        },
      );
      proc.stdout.on("data", () => {});
      proc.stderr.on("data", () => {});
      const [ready] = await once(proc, "message");
      base = `http://127.0.0.1:${ready.port}`;
    }
    async function stop() {
      if (!proc || proc.exitCode !== null || proc.signalCode !== null) return;
      const exited = once(proc, "exit");
      proc.kill();
      await exited;
    }
    t.after(async () => {
      release?.();
      await stop();
      provider.closeAllConnections();
      await new Promise((r) => provider.close(r));
      db.close();
      rmSync(dir, { recursive: true, force: true });
    });
    await start();
    async function api(route, body, expected = 200, method = "POST") {
      const response = await fetch(
        base + "/api" + route,
        body
          ? {
              method,
              headers: {
                "content-type": "application/json",
                ...requestIdentity(body),
              },
              body: JSON.stringify(body),
            }
          : {},
      );
      const value = await response.json();
      assert.equal(response.status, expected, JSON.stringify(value));
      return value;
    }
    async function waitFor(check) {
      for (let i = 0; i < 1000; i++) {
        const value = await check();
        if (value) return value;
        await new Promise((r) => setTimeout(r, 20));
      }
      throw new Error("resume test timed out");
    }
    const script = () => api("/projects/resume/speech-script");
    const payload = {
      revision: 1,
      settings: { style: "vivid", sounds: true },
      pageTexts: Object.fromEntries(project.slides.map((p) => [p.id, p.notes])),
    };
    const arrange = (resume = false, overrides = {}, expected = 202) =>
      api(
        "/projects/resume/speech-performance",
        { ...payload, resume, ...overrides },
        expected,
      );
    await arrange();
    const failed = await waitFor(async () => {
      const s = await script();
      return s.performanceTask.status === "failed" && s;
    });
    assert.equal(
      failed.performance,
      null,
      "partial work is never a usable plan",
    );
    assert.equal(failed.performanceTask.completed, 1);
    assert.equal(failed.performanceTask.savedUnits, 65);
    assert.equal(failed.performanceTask.canResume, true);
    assert(!("performanceCheckpoint" in failed), "checkpoint stays private");
    assert.equal(requests.length, 4);
    const checkpoint = stored().performanceCheckpoint;
    assert.equal(checkpoint.entries[1].units.length, 64);

    // Changed input must fail before updating the saved draft or discarding progress.
    const before = stored();
    await arrange(
      true,
      { pageTexts: { ...payload.pageTexts, p0: "更改的正文。" } },
      409,
    );
    await arrange(true, { settings: { style: "restrained" } }, 409);
    assert.deepEqual(stored(), before);
    await api("/settings", { text: { model: "another-model" } }, 200, "PUT");
    assert.equal((await script()).performanceTask.canResume, false);
    await arrange(true, {}, 409);
    await api("/settings", { text: { model: config.model } }, 200, "PUT");

    // Detect every context change, not just the spoken text.
    const pages = before.pages.map((p, i) => ({
      ...p,
      title: project.slides[i].plan.title,
    }));
    for (const altered of [
      pages.toReversed(),
      pages.map((p, i) => (i ? p : { ...p, notes: "不同原稿" })),
      pages.map((p, i) => (i ? p : { ...p, title: "不同标题" })),
    ]) {
      assert.equal(
        readPerformanceCheckpoint(
          checkpoint,
          performanceFingerprint(altered, payload.settings, config),
          altered,
          payload.settings,
        ),
        null,
      );
    }
    const broken = structuredClone(checkpoint);
    broken.entries[1].units[0].text = "伪造正文";
    assert.equal(
      readPerformanceCheckpoint(
        broken,
        checkpoint.fingerprint,
        pages,
        payload.settings,
      ),
      null,
    );

    // Stop while the failed batch is in flight; completed work remains reusable.
    mode = "hold";
    await arrange(true);
    await waitFor(() => release);
    assert.equal(requests.at(-1).units[0].id, "2:65");
    assert.deepEqual(
      requests.at(-1).previousDelivery,
      requests[3].previousDelivery,
    );
    await api("/projects/resume/speech-performance/cancel", {});
    await waitFor(
      async () => (await script()).performanceTask.status === "cancelled",
    );
    release();
    release = null;
    assert.deepEqual(stored().performanceCheckpoint, checkpoint);

    // Simulate closing the app during a request, then verify startup sends nothing.
    await arrange(true);
    await waitFor(() => release);
    await stop();
    release();
    release = null;
    const callsBeforeRestart = requests.length;
    await start();
    const interrupted = await script();
    assert.equal(interrupted.performanceTask.status, "interrupted");
    assert.equal(interrupted.performanceTask.canResume, true);
    assert.equal(requests.length, callsBeforeRestart);

    if (process.env.PERFORMANCE_BROWSER_TEST === "1") {
      const { chromium } = await import("playwright-core");
      const browser = await chromium.launch({
        headless: true,
        executablePath:
          process.env.CHROMIUM_EXECUTABLE ||
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      });
      try {
        const page = await browser.newPage({
          viewport: { width: 1280, height: 900 },
        });
        const errors = [];
        page.on("pageerror", (e) => errors.push(e.message));
        await page.goto(base + "/#project/resume/rehearsal");
        await page
          .getByRole("button", { name: "制作 AI 口播", exact: true })
          .waitFor({ timeout: 5000 })
          .catch(async (error) => {
            writeFileSync(
              "/tmp/autoppt-resume-ui-failure.txt",
              (await page.locator("body").innerText()) +
                "\n" +
                errors.join("\n"),
            );
            throw error;
          });
        await page
          .getByRole("button", { name: "制作 AI 口播", exact: true })
          .click();
        await page
          .getByRole("tab", { name: "2 · 演讲表达", exact: true })
          .click();
        const button = page.getByRole("button", {
          name: "继续编排 · 从中断处继续",
          exact: true,
        });
        await button.waitFor();
        assert.equal(
          await page.getByLabel("演讲表达风格").inputValue(),
          "vivid",
        );
        await page.getByLabel("演讲表达风格").selectOption("restrained");
        assert.equal(await button.count(), 0);
        await page.getByLabel("演讲表达风格").selectOption("vivid");
        await button.waitFor();
        const out = process.env.PERFORMANCE_SCREENSHOT_DIR;
        if (out) {
          mkdirSync(out, { recursive: true });
          await page.screenshot({
            path: path.join(out, "resume-desktop.png"),
            fullPage: true,
          });
        }
        await page.setViewportSize({ width: 390, height: 844 });
        await button.scrollIntoViewIfNeeded();
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth,
          ),
          false,
        );
        if (out)
          await page.screenshot({
            path: path.join(out, "resume-mobile.png"),
            fullPage: true,
          });
        mode = "hold";
        await button.click();
        await page
          .getByRole("dialog", { name: "确认继续编排演讲", exact: true })
          .getByRole("button", { name: "确认继续编排演讲", exact: true })
          .click();
        await waitFor(() => release);
        await page.getByText(/正在批量编排剩余内容 · 第 1\/1 批/).waitFor();
        assert.match(
          await page.locator("body").innerText(),
          /第 2–3\/4 页 · 本批 6 句/,
        );
        if (out)
          await page.screenshot({
            path: path.join(out, "batch-mobile.png"),
            fullPage: true,
          });
        await page.setViewportSize({ width: 1280, height: 900 });
        if (out)
          await page.screenshot({
            path: path.join(out, "batch-desktop.png"),
            fullPage: true,
          });
        release();
        release = null;
        await page
          .getByText("演绎编排已完成，请逐页检查后生成口播", { exact: true })
          .waitFor();
        await page.getByText("全场表达思路", { exact: true }).click();
        await page
          .getByText("先讲故事，再推进论点，最后平稳收束。", { exact: true })
          .waitFor();
        assert.equal(errors.length, 0, errors.join("\n"));
      } finally {
        await browser.close();
      }
    } else {
      mode = "overload";
      await arrange(true);
      await waitFor(async () =>
        (await script()).performanceTask.progress.includes("自动重试（1/3）"),
      );
    }
    const ready = await waitFor(async () => {
      const s = await script();
      return s.performanceTask.status === "ready" && s;
    });
    const later = requests.slice(callsBeforeRestart);
    assert(later.every((r) => r.stage === "delivery" && r.pageStart >= 2));
    assert(
      later
        .filter((r) => r.pageStart === 2)
        .every((r) => r.units[0].id === "2:65"),
    );
    assert.equal(ready.performance.pages[1].units.length, 69);
    assert.equal(
      ready.performance.pages[1].units.filter((u) => u.emphasis).length,
      1,
    );
    assert.equal(
      ready.performance.pages[1].units.filter((u) => u.sound).length,
      1,
    );
    assert.equal(ready.performance.pages[3].units.length, 0);
    assert.equal(stored().performanceCheckpoint, null);
    assert.equal(ready.performanceTask.canResume, false);
    assert.deepEqual(
      (await api("/projects/resume")).slides.map((p) => p.notes),
      project.slides.map((p) => p.notes),
    );

    // A fresh run remains available, while its failure preserves the completed plan.
    mode = "fail";
    const restartIndex = requests.length;
    await arrange(false);
    await waitFor(
      async () => (await script()).performanceTask.status === "failed",
    );
    assert.equal(requests[restartIndex].stage, "planning");
    assert.deepEqual((await script()).performance, ready.performance);
  },
);
