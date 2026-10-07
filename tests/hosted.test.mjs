import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  writeFileSync,
  rmSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fork } from "node:child_process";
import { once } from "node:events";
import http from "node:http";
import sharp from "sharp";
import { Accounts } from "../server/hosted/accounts.mjs";
import { copyFixture, reviewFixture } from "./fixtures/screen-copy.mjs";

const pass = "Test-password-12345";
test("hosted accounts: one-use invitations, private sessions, atomic credits and reconciliation", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "autoppt-accounts-"));
  const a = new Accounts(dir);
  try {
    await a.bootstrap("admin", pass);
    const admin = await a.login("admin", pass);
    await assert.rejects(a.login("admin", "wrong"));
    await assert.rejects(a.register("member", pass, "wrong"));
    const invite = a.invite(admin.id);
    const outcomes = await Promise.allSettled([
      a.register("member1", pass, invite.code),
      a.register("member2", pass, invite.code),
    ]);
    assert.equal(outcomes.filter((o) => o.status === "fulfilled").length, 1);
    const u = outcomes.find((o) => o.status === "fulfilled").value;
    assert.equal(u.available, 100);
    const cookie = a.session(u.id);
    assert.equal(a.authenticate(cookie).id, u.id);
    assert.equal(a.authenticate("wrong"), null);
    const leases = Array.from({ length: 100 }, () => randomUUID());
    for (const id of leases) a.reserve(u.id, id);
    assert.equal(a.user(u.id).available, 0);
    assert.throws(() => a.reserve(u.id, randomUUID()), /额度不足/);
    a.reserve(u.id, leases[0]);
    assert.equal(a.user(u.id).held, 100);
    a.dispatch(u.id, leases[0]);
    assert.throws(() => a.dispatch(u.id, leases[0]), /重复/);
    const filename = randomUUID() + ".png";
    a.finish(u.id, leases[0], "complete", filename);
    a.finish(u.id, leases[0], "complete", filename);
    assert.equal(a.user(u.id).balance, 99);
    a.finish(u.id, leases[1], "failed");
    assert.equal(a.user(u.id).available, 1);
    a.dispatch(u.id, leases[2]);
    a.finish(u.id, leases[2], "uncertain");
    a.finish(u.id, leases[2], "failed");
    assert.equal(a.user(u.id).available, 1);
    a.finish(u.id, leases[2], "failed", null, true);
    assert.equal(a.user(u.id).available, 2);
    assert.throws(
      () => a.finish(admin.id, leases[3], "complete", filename),
      /不存在/,
    );
    const key = randomUUID();
    a.topup(admin.id, u.id, 50, key);
    a.topup(admin.id, u.id, 50, key);
    assert.equal(a.user(u.id).balance, 149);
    assert.throws(() => a.topup(admin.id, u.id, 51, key), /冲突/);
    a.disable(admin.id, u.id, true);
    assert.equal(a.authenticate(cookie), null);
    assert.throws(() => a.reserve(u.id, randomUUID()), /停用/);
    a.disable(admin.id, u.id, false);
    assert.equal(a.authenticate(cookie), null);
    const fresh = a.session(u.id);
    await a.resetPassword(admin.id, u.id, "Different-password-1234");
    assert.equal(a.authenticate(fresh), null);
    await assert.rejects(a.login(u.name, pass));
    assert.equal((await a.login(u.name, "Different-password-1234")).id, u.id);
    a.limit("login", 1, 1000);
    assert.throws(() => a.limit("login", 1, 1000), /频繁/);
    const stored = readFileSync(path.join(dir, "accounts.sqlite")).toString();
    assert(!stored.includes(pass));
    assert(a.overview().users.every((u) => !("password" in u)));
    assert(!JSON.stringify(a.overview()).includes("Different-password-1234"));
  } finally {
    a.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test(
  "hosted HTTP: auth, data isolation, built-in style, actual metered workflow and failure recovery",
  { timeout: 120000 },
  async (t) => {
    const dir = mkdtempSync(path.join(tmpdir(), "autoppt-hosted-"));
    const png = await sharp({
      create: { width: 160, height: 90, channels: 3, background: "#f3f3ed" },
    })
      .png()
      .toBuffer();
    let failStatus = 0,
      imageCount = 0,
      textCount = 0,
      failText = false,
      hold = false;
    const gates = [];
    const provider = http.createServer(async (req, res) => {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      assert.equal(req.headers.authorization, "Bearer test-provider-secret");
      const body = JSON.parse(Buffer.concat(chunks));
      res.setHeader("Content-Type", "application/json");
      if (req.url.includes("/images/")) {
        imageCount++;
        if (hold) await new Promise((resolve) => gates.push(resolve));
        if (failStatus) {
          res.statusCode = failStatus;
          res.end(
            JSON.stringify({
              error: { message: "test-provider-secret should never leak" },
            }),
          );
          return;
        }
        res.end(
          JSON.stringify({ data: [{ b64_json: png.toString("base64") }] }),
        );
        return;
      }
      textCount++;
      if (failText) {
        res.statusCode = 503;
        res.end(JSON.stringify({ error: { message: "isolated text failure" } }));
        return;
      }
      const system = body.messages[0].content;
      const content = JSON.parse(body.messages[1].content[0].text);
      let out;
      if (system.includes("演讲上屏文案复核编辑")) out = reviewFixture(content);
      else if (system.includes("演讲上屏文案编辑"))
        out = copyFixture(content, ["保留原文的重点"]);
      else if (system.includes("演讲内容关系分析师"))
        out = {
          pages: content.pages.map((p) => ({
            id: p.id,
            claim: "保留原意",
            relationship: "statement",
            literalSpatial: false,
            evidence: p.notes,
            entities: ["原文"],
            visualTask: "表达原文",
            mustNotImply: [],
          })),
        };
      else throw new Error("Unexpected mock request: " + system.slice(0, 50));
      res.end(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(out) } }],
        }),
      );
    });
    provider.listen(0, "127.0.0.1");
    await once(provider, "listening");
    const socket = http.createServer();
    socket.listen(0, "127.0.0.1");
    await once(socket, "listening");
    const port = socket.address().port;
    await new Promise((r) => socket.close(r));
    const origin = `http://127.0.0.1:${port}`;
    writeFileSync(path.join(dir, "admin-password"), pass, { mode: 0o600 });
    let child;
    const start = async (configured = true) => {
      child = fork("server/hosted/index.mjs", [], {
        env: {
          ...process.env,
          PORT: String(port),
          HOST: "127.0.0.1",
          AUTOPPT_MODEL_CONCURRENCY: "1",
          AUTOPPT_PUBLIC_URL: origin,
          AUTOPPT_HOSTED_DATA_DIR: dir,
          AUTOPPT_ADMIN_PASSWORD_FILE: path.join(dir, "admin-password"),
          AUTOPPT_TEXT_BASE_URL: `http://127.0.0.1:${provider.address().port}/v1`,
          AUTOPPT_IMAGE_BASE_URL: `http://127.0.0.1:${provider.address().port}/v1`,
          AUTOPPT_TEXT_API_KEY: configured ? "test-provider-secret" : "",
          AUTOPPT_IMAGE_API_KEY: configured ? "test-provider-secret" : "",
        },
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      });
      let log = "";
      child.stderr.on("data", (c) => (log += c));
      child.stdout.on("data", (c) => (log += c));
      await Promise.race([
        once(child, "message"),
        once(child, "exit").then(() => {
          throw new Error(log);
        }),
        new Promise((_, rej) => {
          const timer = setTimeout(
            () => rej(new Error("Startup timeout " + log)),
            15000,
          );
          timer.unref();
        }),
      ]);
    };
    const stop = async () => {
      if (child?.exitCode === null) {
        const exited = once(child, "exit");
        child.kill();
        await exited;
      }
    };
    const request = async (url, body, cookie = "", expected = 200, method, headers = {}) => {
      const r = await fetch(origin + url, {
        method: method || (body === undefined ? "GET" : "POST"),
        headers: {
          Origin: origin,
          "Content-Type": "application/json",
          Cookie: cookie,
          ...headers,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const contentType = r.headers.get("content-type") || "";
      const data = contentType.includes("json")
        ? await r.json()
        : await r.text();
      assert.equal(r.status, expected, `${url}: ${JSON.stringify(data)}`);
      return {
        data,
        cookie: r.headers.get("set-cookie")?.split(";")[0],
        response: r,
      };
    };
    try {
      await start(false);
      assert.equal((await request("/api/account")).data.hosted, true);
      await request("/api/bootstrap", undefined, "", 401);
      await request("/assets/private.png", undefined, "", 401);
      const admin = (
        await request("/api/account/login", { name: "admin", password: pass })
      ).cookie;
      const inv = (await request("/api/admin/invites", {}, admin)).data;
      await request(
        "/api/account/register",
        { name: "first", password: pass, invite: "invalid" },
        "",
        400,
      );
      const first = (
        await request("/api/account/register", {
          name: "first",
          password: pass,
          invite: inv.code,
        })
      ).cookie;
      await request(
        "/api/account/register",
        { name: "second", password: pass, invite: inv.code },
        "",
        400,
      );
      const inv2 = (await request("/api/admin/invites", {}, admin)).data;
      const second = (
        await request("/api/account/register", {
          name: "second",
          password: pass,
          invite: inv2.code,
        })
      ).cookie;
      await request("/api/admin", undefined, first, 403);
      const csrf = await fetch(origin + "/api/admin/invites", {
        method: "POST",
        headers: {
          Cookie: admin,
          "Content-Type": "application/json",
          Origin: "https://evil.example",
        },
        body: "{}",
      });
      assert.equal(csrf.status, 403);
      const boot = (await request("/api/bootstrap", undefined, first)).data;
      assert.equal(boot.buildInfo.runtimeMode, "hosted");
      assert.equal(boot.dataRootLabel, "hosted 账号工作区");
      assert.equal(boot.capabilities.localModelSettings.enabled, false);
      assert.match(
        boot.capabilities.aiNarration.reason,
        /托管服务未开放.*管理员/,
      );
      assert(!JSON.stringify(boot).includes(dir));
      const style = boot.styles.find((s) => s.name === "克制儿童摄影杂志风");
      assert(style);
      assert(style.rules);
      assert(!JSON.stringify(boot).includes("test-provider-secret"));
      const p = (
        await request(
          "/api/projects",
          { title: "第一人的私有项目" },
          first,
          201,
        )
      ).data;
      await request("/api/projects/" + p.id, undefined, second, 404);
      assert.equal((await request("/api/account", undefined, first)).data.modelReady, false);
      await t.test("unconfigured hosted batches reject case, slash, query and forged readiness variants without creating work", async () => {
        for (const url of [
          `/api/projects/${p.id}/batches`,
          `/API/PROJECTS/${p.id}/BATCHES`,
          `/aPi/PrOjEcTs/${p.id}/bAtChEs/`,
          `/api/projects/${p.id}/batches?source=retry`,
          `/API/projects/${p.id}/Batches/?source=retry`,
        ]) {
          for (const requestId of [randomUUID(), undefined]) {
            const blocked = await request(
              url,
              { text: "配置未就绪时不可创建付费任务。", requestId },
              first,
              503,
              "POST",
              { "X-AutoPPT-Model-Ready": "1", "x-autoppt-worker": "untrusted" },
            );
            assert.match(blocked.data.error, /模型尚未就绪/);
            assert.equal((await request(`/api/projects/${p.id}`, undefined, first)).data.batches.length, 0);
            assert.equal((await request("/api/jobs", undefined, first)).data.length, 0);
            assert.equal(textCount + imageCount, 0);
          }
        }
      });
      await stop();
      await start();
      assert.equal((await request("/api/account", undefined, first)).data.modelReady, true);
      assert.equal(
        (await request("/api/bootstrap", undefined, second)).data.projects
          .length,
        0,
      );
      await request(
        "/api/settings",
        { text: { baseUrl: "https://evil.example", apiKey: "x", model: "x" } },
        first,
        403,
        "PUT",
      );
      await request(
        "/API/SETTINGS?source=mixed-case",
        { text: { baseUrl: "https://evil.example", apiKey: "x", model: "x" } },
        first,
        403,
        "PUT",
      );
      await request("/internal/reserve", { id: randomUUID() }, first, 403);
      const trial = async () =>
        (
          await request(
            `/api/styles/${style.id}/trials`,
            { notes: "我们专注做好这一件事。", rules: style.rules },
            first,
            202,
          )
        ).data;
      const poll = async (id) => {
        for (let i = 0; i < 150; i++) {
          const jobs = (await request("/api/jobs", undefined, first)).data;
          const j = jobs.find((j) => j.id === id);
          if (j && !["queued", "running"].includes(j.status)) return j;
          await new Promise((r) => setTimeout(r, 80));
        }
        throw new Error("job timeout");
      };
      let tr = await trial();
      let job = await poll(tr.jobId);
      assert.equal(job.status, "completed", job.error);
      let trials = (
        await request(`/api/styles/${style.id}/trials`, undefined, first)
      ).data.trials;
      const image = trials.find((x) => x.id === tr.id).image;
      assert(image);
      const ownImage = await fetch(origin + "/assets/" + image, {
        headers: { Cookie: first },
      });
      assert.equal(ownImage.status, 200);
      assert.equal(ownImage.headers.get("cache-control"), "private, no-store");
      await request("/assets/" + image, undefined, second, 404);
      let account = (await request("/api/account", undefined, first)).data.user;
      assert.equal(account.balance, 99);
      assert.equal(account.held, 0);
      assert.equal(imageCount, 1);
      assert(textCount > 0);
      await request(`/api/styles/${style.id}/trials/${tr.id}/apply`, {}, first);
      assert.equal(
        (await request("/api/account", undefined, first)).data.user.balance,
        99,
        "restoring/applying does not charge",
      );
      failStatus = 400;
      tr = await trial();
      job = await poll(tr.jobId);
      assert.equal(job.status, "failed");
      assert(!job.error.includes("test-provider-secret"));
      account = (await request("/api/account", undefined, first)).data.user;
      assert.equal(account.balance, 99);
      assert.equal(account.held, 0);
      failStatus = 503;
      tr = await trial();
      job = await poll(tr.jobId);
      assert.equal(job.status, "failed");
      account = (await request("/api/account", undefined, first)).data.user;
      assert.equal(account.balance, 99);
      assert.equal(account.held, 1);
      const overview = (await request("/api/admin", undefined, admin)).data;
      assert.equal(overview.pending.length, 1);
      await request(
        `/api/admin/usage/${overview.pending[0].id}/release`,
        {},
        admin,
      );
      assert.equal(
        (await request("/api/account", undefined, first)).data.user.held,
        0,
      );
      failStatus = 0;
      const id = account.id,
        key = randomUUID();
      await request(
        `/api/admin/users/${id}/credits`,
        { amount: 50, key },
        admin,
      );
      await request(
        `/api/admin/users/${id}/credits`,
        { amount: 50, key },
        admin,
      );
      assert.equal(
        (await request("/api/account", undefined, first)).data.user.balance,
        149,
      );
      // A saturated global model slot queues another user's request instead of failing it.
      hold = true;
      const before = imageCount;
      const one = await trial();
      const two = (
        await request(
          `/api/styles/${style.id}/trials`,
          { notes: "我们专注做好这一件事。", rules: style.rules },
          second,
          202,
        )
      ).data;
      for (let i = 0; i < 100 && !gates.length; i++)
        await new Promise((r) => setTimeout(r, 30));
      assert.equal(imageCount, before + 1);
      assert.equal(gates.length, 1);
      hold = false;
      gates.shift()();
      assert.equal((await poll(one.jobId)).status, "completed");
      for (let i = 0; i < 100; i++) {
        const j = (await request("/api/jobs", undefined, second)).data.find(
          (j) => j.id === two.jobId,
        );
        if (j?.status === "completed") break;
        if (i === 99) assert.fail("second user did not complete");
        await new Promise((r) => setTimeout(r, 30));
      }
      assert.equal(
        (await request("/api/account", undefined, first)).data.user.balance,
        148,
      );
      assert.equal(
        (await request("/api/account", undefined, second)).data.user.balance,
        99,
      );
      if (process.env.HOSTED_BROWSER_TEST === "1") {
        const { chromium } = await import("playwright-core");
        const browser = await chromium.launch({
          executablePath:
            process.env.CHROMIUM_EXECUTABLE ||
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          headless: true,
        });
        const out = path.resolve(".local/verification/hosted");
        mkdirSync(out, { recursive: true });
        try {
          const page = await browser.newPage({
            viewport: { width: 1440, height: 960 },
          });
          const errors = [];
          page.on("pageerror", (e) => errors.push(e.message));
          await page.goto(origin);
          await page.getByRole("heading", { name: "欢迎回来" }).waitFor();
          await page.screenshot({
            path: path.join(out, "login-desktop.png"),
            fullPage: true,
          });
          await page.getByLabel("账号", { exact: true }).fill("admin");
          await page.getByLabel("密码", { exact: true }).fill(pass);
          await page.getByRole("button", { name: "登录", exact: true }).click();
          await page.locator(".account-footer").waitFor();
          await page.locator(".account-footer").click();
          await page.getByRole("heading", { name: "内部使用管理" }).waitFor();
          await page.getByRole("button", { name: "创建一次性邀请码" }).click();
          const invitation = await page.getByLabel("新邀请码").inputValue();
          await page.screenshot({
            path: path.join(out, "admin-desktop.png"),
            fullPage: true,
          });
          await page
            .getByRole("button", { name: "退出登录", exact: true })
            .click();
          await page.getByRole("heading", { name: "欢迎回来" }).waitFor();
          await page
            .getByRole("button", { name: "有邀请码？创建账号" })
            .click();
          await page.getByLabel("账号", { exact: true }).fill("browser-member");
          await page.getByLabel("密码", { exact: true }).fill(pass);
          await page.getByLabel("邀请码", { exact: true }).fill(invitation);
          await page.getByRole("button", { name: "注册并开始制作" }).click();
          await page.locator(".account-footer").waitFor();
          assert.match(
            await page.locator(".account-footer").innerText(),
            /100/,
          );
          assert.equal(
            await page
              .getByRole("button", { name: "模型设置", exact: true })
              .count(),
            0,
          );
          await page
            .getByRole("button", { name: "模型与服务", exact: true })
            .click();
          await page
            .getByText("托管版的模型由管理员统一配置。", { exact: true })
            .waitFor();
          assert.equal(
            await page.getByLabel("API Key", { exact: true }).count(),
            0,
          );
          await page
            .getByRole("navigation", { name: "主导航" })
            .getByRole("button", { name: "项目", exact: true })
            .click();
          await page.screenshot({
            path: path.join(out, "workspace-desktop.png"),
            fullPage: true,
          });
          const phone = await browser.newPage({
            viewport: { width: 390, height: 844 },
          });
          await phone.goto(origin);
          await phone.getByRole("heading", { name: "欢迎回来" }).waitFor();
          assert(
            await phone.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
          );
          await phone.screenshot({
            path: path.join(out, "login-mobile.png"),
            fullPage: true,
          });
          assert.deepEqual(errors, []);
        } finally {
          await browser.close();
        }
      }
      const inserted = (
        await request(
          `/api/projects/${p.id}/slides`,
          {
            afterSlideId: null,
            requestId: randomUUID(),
            notes: "我们专注做好这一件事。",
            generate: false,
          },
          first,
          201,
        )
      ).data;
      const manuscript = await request(
        `/api/projects/${p.id}/manuscript?download=1&revision=${inserted.project.revision}`,
        undefined,
        first,
      );
      assert.match(manuscript.data, /我们专注做好这一件事/);
      const renderJob = (
        await request(
          `/api/projects/${p.id}/render`,
          { slideIds: [inserted.slideId] },
          first,
          202,
        )
      ).data;
      const rendered = await poll(renderJob.id);
      assert.equal(rendered.status, "completed", rendered.error);
      const presentation = await fetch(
        `${origin}/api/projects/${p.id}/export`,
        { headers: { Cookie: first } },
      );
      assert.equal(presentation.status, 200);
      assert.match(
        presentation.headers.get("content-disposition"),
        /attachment/,
      );
      assert.equal(
        Buffer.from(await presentation.arrayBuffer())
          .subarray(0, 2)
          .toString(),
        "PK",
      );
      assert.equal(
        (await request("/api/account", undefined, first)).data.user.balance,
        147,
      );
      await request(`/api/projects/${p.id}/export`, undefined, second, 404);
      // Simulate all three crash boundaries: not sent, sent/unknown, PNG saved but no acknowledgement.
      await stop();
      const recovery = new Accounts(dir);
      const pending = randomUUID(),
        unknown = randomUUID(),
        saved = randomUUID();
      recovery.reserve(id, pending);
      recovery.reserve(id, unknown);
      recovery.dispatch(id, unknown);
      recovery.reserve(id, saved);
      recovery.dispatch(id, saved);
      const savedFile = randomUUID() + ".png";
      writeFileSync(path.join(dir, "users", id, "assets", savedFile), png);
      writeFileSync(
        path.join(dir, "users", id, `receipt-${saved}.json`),
        JSON.stringify({ id: saved, filename: savedFile }),
      );
      recovery.db.close();
      await start();
      const restoredAccount = (await request("/api/account", undefined, first))
        .data.user;
      assert.equal(restoredAccount.held, 1);
      assert.equal(restoredAccount.balance, 146);
      const recoveredUsage = (
        await request("/api/account/usage", undefined, first)
      ).data;
      assert.equal(
        recoveredUsage.find((r) => r.id === pending).status,
        "failed",
      );
      assert.equal(
        recoveredUsage.find((r) => r.id === saved).status,
        "complete",
      );
      assert.equal(
        recoveredUsage.find((r) => r.id === unknown).status,
        "uncertain",
      );
      await request(`/api/admin/usage/${unknown}/release`, {}, admin);
      // A second restart must not debit the receipt twice.
      await stop();
      await start();
      assert.equal(
        (await request("/api/account", undefined, first)).data.user.balance,
        146,
      );
      assert.equal(
        (await request("/api/projects/" + p.id, undefined, first)).data.title,
        p.title,
      );
      await t.test("lost accepted response replays the persisted batch after an unconfigured hosted restart without model calls", async () => {
        const project = (await request("/api/projects", { title: "幂等恢复隔离项目" }, first, 201)).data;
        const body = { text: "已经接受的讲稿可以找回。", requestId: randomUUID() };
        const jobsBefore = (await request("/api/jobs", undefined, first)).data.length;
        const callsBefore = { text: textCount, image: imageCount };
        // Accept real work with configured models, then drop the response body
        // before the caller learns either identity. A mock failure ends the job.
        failText = true;
        const lost = await fetch(`${origin}/API/PROJECTS/${project.id}/BATCHES/?source=first`, {
          method: "POST",
          headers: {
            Origin: origin,
            Cookie: first,
            "Content-Type": "application/json",
            "x-autoppt-model-ready": "0",
          },
          body: JSON.stringify(body),
        });
        assert.equal(lost.status, 202, "the Express case/slash/query variant really reaches the batch route; external readiness cannot override the gateway");
        await lost.body.cancel();
        const accepted = (await request(`/api/projects/${project.id}`, undefined, first)).data.batches[0];
        assert.equal(accepted.requestId, body.requestId);
        assert.equal((await poll(accepted.jobId)).status, "failed");
        assert.equal(textCount, callsBefore.text + 1);
        assert.equal(imageCount, callsBefore.image);
        failText = false;
        await stop();
        await start(false);
        assert.equal((await request("/api/account", undefined, first)).data.modelReady, false);
        for (const url of [
          `/api/projects/${project.id}/batches`,
          `/API/PROJECTS/${project.id}/BATCHES/?source=retry`,
        ]) {
          const replay = (await request(url, body, first, 202)).data;
          assert.equal(replay.accepted, true);
          assert.equal(replay.id, accepted.jobId);
          assert.equal(replay.batchId, accepted.id);
          assert.equal(replay.status, "failed");
          await request(url, { ...body, text: "不能偷换已经接受的讲稿。" }, first, 409);
          await request(url, { ...body, requestId: randomUUID() }, first, 503);
          await request(url, { text: body.text }, first, 503);
        }
        const restored = (await request(`/api/projects/${project.id}`, undefined, first)).data;
        assert.deepEqual(restored.batches, [accepted]);
        assert.equal((await request("/api/jobs", undefined, first)).data.length, jobsBefore + 1);
        assert.equal(textCount, callsBefore.text + 1, "replays make zero duplicate text calls");
        assert.equal(imageCount, callsBefore.image, "replays make zero image calls");
      });
      await request(`/api/admin/users/${id}/status`, { disabled: true }, admin);
      await request("/api/bootstrap", undefined, first, 401);
      await request("/api/account/logout", {}, second);
      await request("/api/bootstrap", undefined, second, 401);
      assert(existsSync(path.join(dir, "users", id, "autoppt.sqlite")));
    } finally {
      for (const gate of gates) gate();
      await stop();
      provider.closeAllConnections();
      await new Promise((r) => provider.close(r));
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test("hosted worker requires authentication and explicit readiness before accepting new batches", async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "autoppt-worker-readiness-"));
  const token = "isolated-worker-token";
  const child = fork("server/index.mjs", [], {
    env: {
      PATH: process.env.PATH,
      HOME: dir,
      NODE_ENV: "production",
      PORT: "0",
      AUTOPPT_DATA_DIR: dir,
      AUTOPPT_WORKER_TOKEN: token,
      AUTOPPT_GATEWAY: "http://127.0.0.1:1",
    },
    stdio: ["ignore", "ignore", "ignore", "ipc"],
  });
  t.after(async () => {
    if (child.exitCode === null) {
      const exited = once(child, "exit");
      child.kill();
      await exited;
    }
    rmSync(dir, { recursive: true, force: true });
  });
  const [ready] = await once(child, "message", { signal: AbortSignal.timeout(15000) });
  const request = (url, body, headers = {}) => fetch(`http://127.0.0.1:${ready.port}${url}`, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json", "x-autoppt-worker": token, ...headers },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const created = await request("/api/projects", { title: "可信 readiness 边界" });
  assert.equal(created.status, 201);
  const project = await created.json();
  const url = `/API/PROJECTS/${project.id}/BATCHES/?test=internal`;
  const body = { text: "不可绕过内部边界。", requestId: randomUUID() };
  assert.equal((await request(url, body, { "x-autoppt-worker": "forged", "x-autoppt-model-ready": "1" })).status, 403);
  for (const headers of [{}, ...["0", "true", "1, 0"].map((value) => ({ "x-autoppt-model-ready": value }))]) {
    const response = await request(url, body, headers);
    assert.equal(response.status, 503);
    assert.match((await response.json()).error, /模型尚未就绪/);
  }
  assert.equal((await (await request(`/api/projects/${project.id}`)).json()).batches.length, 0);
  assert.deepEqual(await (await request("/api/jobs")).json(), []);
});

test("hosted process lock detects duplicate startup and recycled container PIDs", async () => {
  const { acquireLock, isLocked } =
    await import("../server/hosted/process-lock.mjs");
  const dir = mkdtempSync(path.join(tmpdir(), "autoppt-lock-"));
  const file = path.join(dir, "hosted.lock");
  try {
    writeFileSync(
      file,
      JSON.stringify({ pid: process.pid, started: "old-container-process" }),
    );
    assert.equal(isLocked(file), false);
    acquireLock(file);
    assert.equal(isLocked(file), true);
    assert.throws(() => acquireLock(file), /重复启动/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
