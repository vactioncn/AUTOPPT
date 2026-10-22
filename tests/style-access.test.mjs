import test from "node:test";
import { backupHosted, restoreHosted } from "../scripts/hosted-backup.mjs";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { chromium } from "playwright-core";
import sharp from "sharp";
import {
  offeredStyles,
  defaultStyleId,
  projectStyles,
} from "../shared/styles.mjs";
import { styleLibraryEntries } from "../shared/style-library.mjs";
import {
  STYLE_SAMPLE_PAGES,
  STYLE_SAMPLE_VERSION,
} from "../shared/style-sample-suite.mjs";
import { styleStamp } from "../server/core.mjs";

test(
  "hosted style permissions, deliberate publication, customer gallery and project continuity",
  { timeout: 90000 },
  async (t) => {
    const dir = mkdtempSync(path.join(tmpdir(), "autoppt-style-access-"));
    const socket = createServer().listen(0, "127.0.0.1");
    await once(socket, "listening");
    const port = socket.address().port;
    await new Promise((resolve) => socket.close(resolve));
    const publicOrigin = `http://127.0.0.1:${port}`;
    const child = fork("server/hosted/index.mjs", [], {
      silent: true,
      env: {
        ...process.env,
        PORT: String(port),
        HOST: "127.0.0.1",
        AUTOPPT_HOSTED_DATA_DIR: dir,
        AUTOPPT_PUBLIC_URL: publicOrigin,
        AUTOPPT_ADMIN_PASSWORD: "test-pass-123",
        AUTOPPT_ADMIN_PASSWORD_FILE: "",
        AUTOPPT_ADMIN_USER: "admin",
        AUTOPPT_TEXT_API_KEY: "",
        AUTOPPT_IMAGE_API_KEY: "",
        AUTOPPT_SPEECH_API_KEY: "",
        AUTOPPT_TEXT_API_KEY_FILE: "",
        AUTOPPT_IMAGE_API_KEY_FILE: "",
        AUTOPPT_SPEECH_API_KEY_FILE: "",
        AUTOPPT_WORKER_TOKEN: "",
        AUTOPPT_DESKTOP_TOKEN: "",
      },
    });
    let log = "",
      browser;
    child.stderr.on("data", (chunk) => (log += chunk));
    t.after(async () => {
      await browser?.close();
      if (child.exitCode === null) {
        const done = once(child, "exit");
        child.kill();
        await done;
      }
      rmSync(dir, { recursive: true, force: true });
    });
    const [ready] = await Promise.race([
      once(child, "message"),
      once(child, "exit").then(() => {
        throw new Error(log);
      }),
    ]);
    const base = `http://127.0.0.1:${ready.port}`;
    const request = async (
      url,
      { cookie = "", method = "GET", body, headers = {}, status = 200 } = {},
    ) => {
      const response = await fetch(base + "/api" + url, {
        method,
        headers: {
          Cookie: cookie,
          Origin: publicOrigin,
          "Content-Type": "application/json",
          ...headers,
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      assert.equal(
        response.status,
        status,
        `${method} ${url}: ${await response.clone().text()}`,
      );
      return response;
    };
    const login = await request("/account/login", {
      method: "POST",
      body: { name: "admin", password: "test-pass-123" },
    });
    const admin = login.headers.get("set-cookie").split(";")[0];
    const adminUser = (await login.json()).user;
    const invite = await (
      await request("/admin/invites", {
        cookie: admin,
        method: "POST",
        body: {},
      })
    ).json();
    const registration = await request("/account/register", {
      method: "POST",
      body: { name: "member", password: "test-pass-123", invite: invite.code },
    });
    const member = registration.headers.get("set-cookie").split(";")[0];
    const memberUser = (await registration.json()).user;
    const bootstrap = async (cookie) =>
      (await request("/bootstrap", { cookie })).json();
    const initial = await bootstrap(member);
    assert.equal(initial.styles.length, 4);
    assert(
      initial.styles.every(
        (s) => s.rules === "" && !s.styleAnalysis && !s.history && s.canUse,
      ),
    );
    assert(defaultStyleId(initial.styles));
    const styleId = initial.styles[0].id;
    for (const [url, method] of [
      ["/styles", "POST"],
      ["/StYlEs/", "POST"],
      [`/styles/${styleId}`, "PATCH"],
      [`/styles/${styleId}`, "DELETE"],
      [`/styles/${styleId}/analyze`, "POST"],
      [`/styles/${styleId}/sample-batch`, "POST"],
      [`/styles/${styleId}/sample-batch/pause`, "POST"],
      [`/styles/${styleId}/references`, "POST"],
      ["/style-imports", "POST"],
      ["/styles/from-url", "POST"],
      [`/styles/${styleId}/trials`, "POST"],
      [`/styles/${styleId}/trials`, "GET"],
      [`/styles/${styleId}/samples/cover`, "PATCH"],
      [`/styles/${styleId}/versions`, "GET"],
      [`/styles/${styleId}/versions/old/restore`, "POST"],
      [`/styles/${styleId}/publish`, "POST"],
      [`/styles/${styleId}/publish`, "DELETE"],
    ]) {
      await request(url, {
        cookie: member,
        method,
        ...(method !== "GET" ? { body: {} } : {}),
        status: 403,
        headers: { "x-autoppt-role": "admin" },
      });
    }
    const secret = "PRIVATE_ADMIN_STYLE_RULES";
    const created = await (
      await request("/styles", {
        cookie: admin,
        method: "POST",
        body: { name: "管理员示例风格", rules: secret },
        status: 201,
      })
    ).json();
    const draftId = created.style.id;
    for (const cookie of [admin, member])
      await request("/projects", {
        cookie,
        method: "POST",
        status: 400,
        body: { title: "未发布不能新建", styleId: draftId },
      });
    assert(
      !(await bootstrap(member)).styles.some(
        (s) => s.name === "管理员示例风格",
      ),
    );
    // Only synthetic fixture content is made public; no live model is called.
    const fixture = await sharp({
      create: { width: 960, height: 540, channels: 3, background: "#d4e0ce" },
    })
      .png()
      .toBuffer();
    writeFileSync(
      path.join(dir, "users", adminUser.id, "assets", "public-example.png"),
      fixture,
    );
    const db = new DatabaseSync(
      path.join(dir, "users", adminUser.id, "autoppt.sqlite"),
    );
    const trialIds = STYLE_SAMPLE_PAGES.map((page) => `example-${page.id}`);
    for (const [index, page] of STYLE_SAMPLE_PAGES.entries()) {
      db.prepare("INSERT INTO records VALUES (?,?,?)").run(
        "trial",
        trialIds[index],
        JSON.stringify({
          id: trialIds[index],
          styleId: draftId,
          image: "public-example.png",
          jobId: "fixture-job",
          status: "completed",
          purpose: "standard-sample",
          samplePageId: page.id,
          sampleVersion: STYLE_SAMPLE_VERSION,
          baseFingerprint: styleStamp(created.style).fingerprint,
          plan: { title: "公开的页面效果" },
          createdAt: new Date().toISOString(),
        }),
      );
      if (index === 6) {
        const ownDraft = (await bootstrap(admin)).styles.find(
          (s) => s.id === draftId,
        );
        assert.equal(ownDraft.sampleExamples.length, 7);
        assert.deepEqual(
          ownDraft.sampleExamples.map((e) => e.pageId),
          STYLE_SAMPLE_PAGES.slice(0, 7).map((p) => p.id),
        );
        assert(!ownDraft.examples?.length);
        const customerBeforePublish = await bootstrap(member);
        assert(
          !customerBeforePublish.styles.some(
            (s) => s.id === draftId || s.catalogSourceId === draftId,
          ),
        );
        assert(
          customerBeforePublish.styles.every((s) => !("sampleExamples" in s)),
        );
      }
    }
    const oldPoint = JSON.parse(
      db
        .prepare("SELECT data FROM records WHERE kind='trial' AND id=?")
        .get(trialIds[1]).data,
    );
    const newerPoint = {
      ...oldPoint,
      id: "newer-point",
      createdAt: "2099-01-01T00:00:00Z",
    };
    db.prepare("INSERT INTO records VALUES (?,?,?)").run(
      "trial",
      newerPoint.id,
      JSON.stringify(newerPoint),
    );
    db.close();
    const sampleUrl = `/styles/${draftId}/samples/point`;
    const pick = {
      fingerprint: styleStamp(created.style).fingerprint,
      expectedTrialId: newerPoint.id,
      trialId: oldPoint.id,
    };
    await request(sampleUrl, {
      cookie: admin,
      method: "PATCH",
      body: { ...pick, fingerprint: "stale" },
      status: 409,
    });
    await request(sampleUrl, {
      cookie: admin,
      method: "PATCH",
      body: { ...pick, trialId: trialIds[0] },
      status: 400,
    });
    await request(sampleUrl, { cookie: admin, method: "PATCH", body: pick });
    await request(sampleUrl, {
      cookie: admin,
      method: "PATCH",
      body: { ...pick, trialId: newerPoint.id },
      status: 409,
    });
    const savedChoice = (await bootstrap(admin)).styles.find(
      (s) => s.id === draftId,
    );
    assert.equal(savedChoice.sampleExamples[1].id, oldPoint.id);
    assert.equal(savedChoice.rules, created.style.rules);
    assert.equal(styleStamp(savedChoice).fingerprint, pick.fingerprint);
    const reread = await (
      await request(`/styles/${draftId}/trials`, { cookie: admin })
    ).json();
    assert.deepEqual(reread.preferredIds, [oldPoint.id]);
    const jobsBeforeReuse = (await bootstrap(admin)).jobs;
    const reused = await (
      await request(`/styles/${draftId}/trials`, {
        cookie: admin,
        method: "POST",
        body: {
          samplePageId: "cover",
          sampleFingerprint: pick.fingerprint,
          reuseExisting: true,
        },
      })
    ).json();
    assert.equal(reused.id, trialIds[0]);
    assert.deepEqual(
      (await bootstrap(admin)).jobs,
      jobsBeforeReuse,
      "Retrying fill must not queue another paid image",
    );
    for (const invalid of [
      [trialIds[0]],
      [...trialIds].reverse(),
      [...trialIds.slice(1), trialIds[1]],
    ]) {
      await request(`/styles/${draftId}/publish`, {
        cookie: admin,
        method: "POST",
        body: { trialIds: invalid },
        status: 400,
      });
    }
    await request(`/styles/${draftId}/publish`, {
      cookie: admin,
      method: "POST",
      body: { trialIds },
    });
    const after = await bootstrap(member);
    const published = after.styles.find((s) => s.catalogSourceId === draftId);
    assert(published?.canUse);
    assert(!JSON.stringify(after).includes(secret));
    assert.equal(published.examples.length, 8);
    const adminEntries = styleLibraryEntries((await bootstrap(admin)).styles, {
      canManage: true,
      hosted: true,
    });
    const approvedEntry = adminEntries.find(
      (entry) => entry.manageStyle?.id === draftId,
    );
    assert.equal(approvedEntry.style.samplePreview, undefined);
    assert.deepEqual(
      approvedEntry.style.examples.map((e) => e.id),
      trialIds,
    );
    assert(
      after.styles.every((s) => !("sampleChoices" in s)),
      "Private selection metadata stays with the administrator",
    );
    assert.deepEqual(
      published.examples.map((page) => page.pageId),
      STYLE_SAMPLE_PAGES.map((page) => page.id),
    );
    assert.equal(
      (
        await fetch(base + "/assets/public-example.png", {
          headers: { Cookie: member },
        })
      ).status,
      200,
    );
    const project = await (
      await request("/projects", {
        cookie: member,
        method: "POST",
        body: { title: "客户使用风格", styleId: published.id },
        status: 201,
      })
    ).json();
    assert.equal(project.styleId, published.id);
    const adminInput = {
      title: "管理员也使用已发布版本",
      styleId: published.id,
      requestId: "published-style-project-retry",
    };
    const adminProject = await (
      await request("/projects", {
        cookie: admin,
        method: "POST",
        status: 201,
        body: adminInput,
      })
    ).json();
    const otherAdminProject = await (
      await request("/projects", {
        cookie: admin,
        method: "POST",
        status: 201,
        body: { title: "切换风格校验", styleId },
      })
    ).json();
    await request("/projects", {
      cookie: admin,
      method: "POST",
      status: 400,
      body: { title: "不能用原稿绕过发布", styleId: draftId },
    });
    await request(`/styles/${draftId}`, {
      cookie: admin,
      method: "PATCH",
      body: { rules: "changed-private-rules" },
    });
    assert.equal(
      projectStyles((await bootstrap(admin)).styles, true).find(
        (s) => s.id === published.id,
      ).rules,
      secret,
      "New projects must not use the administrator's unpublished edits",
    );
    await request(`/styles/${draftId}/publish`, {
      cookie: admin,
      method: "POST",
      body: { trialIds },
      status: 400,
    });
    // Simulate fresh completed standard trials for the updated style, without model calls.
    const updatedStyle = (await bootstrap(admin)).styles.find(
      (style) => style.id === draftId,
    );
    const fixtureDb = new DatabaseSync(
      path.join(dir, "users", adminUser.id, "autoppt.sqlite"),
    );
    for (const id of trialIds) {
      const trial = JSON.parse(
        fixtureDb
          .prepare("SELECT data FROM records WHERE kind='trial' AND id=?")
          .get(id).data,
      );
      trial.baseFingerprint = styleStamp(updatedStyle).fingerprint;
      fixtureDb
        .prepare("UPDATE records SET data=? WHERE kind='trial' AND id=?")
        .run(JSON.stringify(trial), id);
    }
    fixtureDb.close();
    const memberDb = new DatabaseSync(
      path.join(dir, "users", memberUser.id, "autoppt.sqlite"),
    );
    assert.equal(
      JSON.parse(
        memberDb
          .prepare("SELECT data FROM records WHERE kind='style' AND id=?")
          .get(published.id).data,
      ).rules,
      secret,
    );
    memberDb.prepare("INSERT INTO records VALUES (?,?,?)").run(
      "job",
      "legacy-style",
      JSON.stringify({
        id: "legacy-style",
        type: "style",
        status: "failed",
        payload: { styleId },
        createdAt: new Date().toISOString(),
      }),
    );
    await request("/jobs/legacy-style/retry", {
      cookie: member,
      method: "POST",
      body: {},
      status: 403,
    });
    memberDb.close();

    await t.test(
      "real browser: customer gallery and admin tools at desktop and mobile widths",
      { skip: !process.env.BROWSER_TEST },
      async () => {
        browser = await chromium.launch({
          headless: true,
          executablePath:
            process.env.CHROMIUM_EXECUTABLE ||
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        });
        const context = await browser.newContext();
        await context.addCookies([
          { name: "autoppt_session", value: member.split("=")[1], url: base },
        ]);
        const page = await context.newPage();
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        const screenshots =
          process.env.STYLE_ACCESS_SCREENSHOTS ||
          "/tmp/autoppt-style-access-screenshots";
        mkdirSync(screenshots, { recursive: true });
        for (const [name, width, height] of [
          ["reference", 1487, 1058],
          ["desktop", 1440, 1000],
          ["mobile", 390, 844],
        ]) {
          await page.setViewportSize({ width, height });
          await page.goto(base + "/#styles");
          await page
            .getByRole("heading", { name: "选一种喜欢的风格。" })
            .waitFor();
          assert.equal(
            await page
              .getByRole("button", { name: "创建风格", exact: true })
              .count(),
            0,
          );
          assert.equal(await page.locator(".card-delete").count(), 0);
          assert.equal(
            await page.getByText("精品风格", { exact: true }).count(),
            0,
          );
          await page.screenshot({
            path: path.join(screenshots, `${name}-library.png`),
            fullPage: true,
          });
          await page.locator(".style-cover-button").first().click();
          const gallery = page.locator(".style-gallery-page");
          await gallery.waitFor();
          await gallery
            .locator(".style-gallery-stage img")
            .evaluate((img) => img.decode());
          await page.screenshot({
            path: path.join(screenshots, `${name}-cover.png`),
          });
          assert.equal(await gallery.locator("textarea").count(), 0);
          assert.equal(
            await gallery.getByText("高级设置", { exact: true }).count(),
            0,
          );
          assert.equal(
            await gallery.locator(".style-gallery-thumbnails button").count(),
            8,
          );
          assert.equal(await page.locator("dialog[open]").count(), 0);
          assert.equal(
            await page
              .getByRole("heading", { name: "选一种喜欢的风格。" })
              .isVisible(),
            false,
          );
          const thumbnails = gallery.locator(
            ".style-gallery-thumbnails button",
          );
          const boxes = await thumbnails.evaluateAll((buttons) =>
            buttons.map((button) => {
              const rect = button.getBoundingClientRect();
              return { top: rect.top, width: rect.width };
            }),
          );
          assert(
            boxes.every((box) => Math.abs(box.top - boxes[0].top) < 1),
            "samples stay in a single row",
          );
          assert(
            boxes.every((box) => box.width <= 112),
            "samples remain small navigation previews",
          );
          await gallery.getByRole("button", { name: "上一个示例" }).click();
          assert.equal(
            await thumbnails.nth(7).getAttribute("aria-pressed"),
            "true",
          );
          const visibleLast = await thumbnails.nth(7).evaluate((button) => {
            const item = button.getBoundingClientRect();
            const strip = button.parentElement.getBoundingClientRect();
            return item.left >= strip.left - 1 && item.right <= strip.right + 1;
          });
          assert(
            visibleLast,
            "changing pages brings the selected small preview into view",
          );
          await gallery
            .getByRole("button", { name: "下一个示例" })
            .press("ArrowRight");
          assert.equal(
            await thumbnails.nth(0).getAttribute("aria-pressed"),
            "true",
          );
          await gallery.locator(".style-gallery-manuscript summary").click();
          assert.match(
            await gallery.locator(".style-gallery-manuscript p").innerText(),
            /准备一场演讲/,
          );
          await gallery.getByRole("button", { name: "下一个示例" }).click();
          assert.equal(
            await gallery
              .locator(".style-gallery-manuscript")
              .getAttribute("open"),
            null,
          );

          assert.equal(
            await gallery
              .locator(".style-gallery-thumbnails button")
              .nth(1)
              .getAttribute("aria-pressed"),
            "true",
          );
          await gallery
            .locator(".style-gallery-thumbnails button")
            .nth(2)
            .click();
          await gallery
            .locator(".style-gallery-stage img")
            .evaluate((img) => img.decode());
          assert.equal(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= window.innerWidth,
            ),
            true,
          );
          await page.screenshot({
            path: path.join(screenshots, `${name}-gallery.png`),
          });
          await gallery.getByRole("button", { name: "返回风格库" }).click();
          await page
            .getByRole("heading", { name: "选一种喜欢的风格。" })
            .waitFor();
          const lastCard = page.locator(".style-cover-button").last();
          await lastCard.scrollIntoViewIfNeeded();
          const libraryScroll = await page.evaluate(() => window.scrollY);
          await lastCard.click();
          await gallery.waitFor();
          await gallery.getByRole("button", { name: "返回风格库" }).click();
          await page.waitForFunction(
            (top) => Math.abs(window.scrollY - top) < 2,
            libraryScroll,
          );
          assert(
            await lastCard.evaluate(
              (button) => document.activeElement === button,
            ),
          );
          await page.locator(".style-card-examples button").nth(2).click();
          await gallery.waitFor();
          assert.equal(
            await gallery
              .locator(".style-gallery-thumbnails button")
              .nth(2)
              .getAttribute("aria-pressed"),
            "true",
          );
          await gallery.getByRole("button", { name: "使用这个风格" }).click();
          await page.getByLabel("演讲主题").waitFor();
        }
        await context.clearCookies();
        await context.addCookies([
          { name: "autoppt_session", value: admin.split("=")[1], url: base },
        ]);
        await page.goto(base + "/#styles");
        await page
          .getByRole("button", { name: "创建风格", exact: true })
          .waitFor();
        await page
          .locator(".style-card")
          .filter({ hasText: "管理员示例风格" })
          .getByRole("button", { name: "查看风格", exact: true })
          .click();
        await page
          .getByRole("button", { name: "高级设置", exact: true })
          .click();
        const publishing = page.getByRole("region", { name: "样例与发布" });
        await publishing.getByText("已发布", { exact: true }).waitFor();
        await publishing
          .getByText("查看八页样例与版本", { exact: true })
          .click();
        assert.equal(
          await page
            .getByRole("combobox", { name: "选择封面页样例" })
            .inputValue(),
          trialIds[0],
        );
        await page.getByRole("button", { name: "一键更新发布" }).click();
        await publishing
          .getByText("风格与八页样例已发布，客户刷新风格库即可看到。", {
            exact: true,
          })
          .waitFor();
        await page.getByRole("button", { name: "从客户风格库下架" }).click();
        await publishing
          .getByText("已从客户风格库下架，已有项目仍可继续使用。", {
            exact: true,
          })
          .waitFor();
        assert.equal(errors.length, 0, errors.join("\n"));
      },
    );
    await request(`/styles/${draftId}/publish`, {
      cookie: admin,
      method: "DELETE",
    });
    const withdrawn = (await bootstrap(member)).styles;
    const adminAfterWithdrawal = (await bootstrap(admin)).styles;
    assert(
      !projectStyles(adminAfterWithdrawal, true).some((s) =>
        [draftId, published.id].includes(s.id),
      ),
    );
    assert(
      styleLibraryEntries(adminAfterWithdrawal, {
        hosted: true,
        canManage: true,
      }).some((e) => e.manageStyle?.id === draftId),
    );
    for (const styleId of [draftId, published.id]) {
      await request("/projects", {
        cookie: admin,
        method: "POST",
        status: 400,
        body: { title: "管理员下架后不能新建", styleId },
      });
      await request(`/projects/${otherAdminProject.id}`, {
        cookie: admin,
        method: "PATCH",
        status: 400,
        body: { styleId },
      });
    }
    const replay = await (
      await request("/projects", {
        cookie: admin,
        method: "POST",
        body: adminInput,
      })
    ).json();
    assert.equal(
      replay.id,
      adminProject.id,
      "An accepted request stays idempotent after withdrawal",
    );
    await request(`/projects/${adminProject.id}`, {
      cookie: admin,
      method: "PATCH",
      body: { styleId: published.id, draft: "原项目继续编辑" },
    });
    assert.equal(
      (
        await (
          await request(`/projects/${adminProject.id}`, { cookie: admin })
        ).json()
      ).draft,
      "原项目继续编辑",
    );
    assert(!offeredStyles(withdrawn, true).some((s) => s.id === published.id));
    assert(
      offeredStyles(withdrawn, true, published.id).some(
        (s) => s.id === published.id,
      ),
    );
    const unchanged = await (
      await request(`/projects/${project.id}`, { cookie: member })
    ).json();
    assert.equal(unchanged.styleId, published.id);
    await request("/projects", {
      cookie: member,
      method: "POST",
      body: { title: "下架后不能新建", styleId: published.id },
      status: 400,
    });
    await request(`/styles/${draftId}/publish`, {
      cookie: admin,
      method: "POST",
      body: { trialIds },
    });
    await request(`/styles/${draftId}`, { cookie: admin, method: "DELETE" });
    assert(
      !offeredStyles((await bootstrap(member)).styles, true).some(
        (s) => s.id === published.id,
      ),
    );
    const stopped = once(child, "exit");
    child.kill();
    await stopped;
    const archive = dir + "-backup.tar.gz";
    const restored = dir + "-restored";
    mkdirSync(restored);
    try {
      const backup = await backupHosted(dir, archive);
      assert.equal(
        backup.databases,
        4,
        "accounts, two workspaces and the shared style catalog",
      );
      await restoreHosted(restored, archive);
      const restoredCatalog = new DatabaseSync(
        path.join(restored, "style-catalog", "catalog.sqlite"),
        { readOnly: true },
      );
      assert.equal(
        JSON.parse(
          restoredCatalog
            .prepare("SELECT data FROM styles WHERE id=?")
            .get(published.id).data,
        ).catalogHidden,
        true,
      );
      restoredCatalog.close();
    } finally {
      rmSync(archive, { force: true });
      rmSync(archive + ".json", { force: true });
      rmSync(restored, { recursive: true, force: true });
    }
  },
);
