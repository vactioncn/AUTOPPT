import { createScaleMedia, scalePresentation } from "./helpers/scale-media.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fork } from "node:child_process";
import { once } from "node:events";
import { randomUUID, createHash } from "node:crypto";
import sharp from "sharp";
import { expect } from "@playwright/test";
import { launchBrowser } from "./helpers/browser.mjs";
import { silenceMp3 } from "./helpers/speech-audio.mjs";

test(
  "digital human browser acceptance with real local media and isolated data",
  { skip: process.env.PRESENTER_BROWSER_TEST !== "1", timeout: 300000 },
  async (t) => {
    const dir = mkdtempSync(path.join(tmpdir(), "autoppt-avatar-browser-"));
    const evidence = path.resolve("test-results/avatar-presenter");
    mkdirSync(evidence, { recursive: true });
    process.env.AUTOPPT_DATA_DIR = dir;
    const store = await import("../server/store.mjs");
    const { createPresenter, runPresenter, presenterForExport } =
      await import("../server/presenter/index.mjs");
    const { mockProvider } = await import("../server/presenter/mock.mjs");
    const { writeStaticHtml } = await import("../server/html-export.mjs");
    const { writeMotionHtml } = await import("../server/motion/render.mjs");
    const image = await sharp(
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="1280" height="720" fill="#e9eee7"/><text x="100" y="250" font-size="70" fill="#244b3a" font-family="sans-serif">AutoPPT</text><text x="100" y="360" font-size="36" fill="#50695c" font-family="sans-serif">Digital presenter · offline playback</text></svg>',
      ),
    )
      .png()
      .toBuffer();
    writeFileSync(store.assetPath("fixture.png"), image);
    mkdirSync(path.join(dir, "speech-audio"), { recursive: true });
    const audioFile = randomUUID() + ".mp3";
    writeFileSync(path.join(dir, "speech-audio", audioFile), silenceMp3);
    const now = new Date().toISOString();
    const project = {
      id: "presenter-fixture",
      title: "候选 · 最终整合数字人验收",
      revision: 1,
      draft: "",
      styleId: "restrained-minimal",
      createdAt: now,
      updatedAt: now,
      proposal: null,
      undo: null,
      batches: [],
      slides: [1, 2, 3].map((i) => ({
        id: "page-" + i,
        title: "第 " + i + " 页",
        plan: { title: "第 " + i + " 页" },
        notes: "本地隔离验收讲稿 " + i,
        manuscriptVersion: 1,
        image: "fixture.png",
        scene: null,
        status: "ready",
        stale: false,
        versions: [],
        batchIds: [],
        styleId: "restrained-minimal",
      })),
    };
    const narration = {
      id: "narration-fixture",
      projectId: project.id,
      title: project.title,
      sourceRevision: 1,
      voiceName: "测试口播",
      status: "ready",
      progress: "已完成",
      createdAt: now,
      options: { voiceId: "test", speed: 1, emotion: "auto" },
      pages: project.slides.map((s, i) => ({
        ...s,
        number: i + 1,
        spokenText: s.notes,
        clips: i === 2 ? [] : [{ file: audioFile, duration: 2, text: s.notes }],
        silentDuration: 0.2,
      })),
    };
    const motion = {
      id: "motion-fixture",
      projectId: project.id,
      title: project.title,
      sourceRevision: 1,
      status: "ready",
      createdAt: now,
      pages: project.slides.map((s, i) => ({
        id: s.id,
        title: s.title,
        number: i + 1,
        status: "ready",
        reviewed: true,
        width: 1280,
        height: 720,
        background: s.image,
        layers: [],
        source: { image: s.image, notes: s.notes },
      })),
    };
    store.put("project", project);
    store.put("narration", narration);
    store.put("motion", motion);
    let child, browser;
    async function start(mock) {
      child = fork("server/index.mjs", [], {
        silent: true,
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          TMPDIR: process.env.TMPDIR,
          NODE_ENV: "test",
          PORT: "0",
          AUTOPPT_DATA_DIR: dir,
          AUTOPPT_PRESENTER_TEST: mock ? "1" : "0",
        },
      });
      let errors = "";
      child.stderr.on("data", (c) => {
        errors += c;
      });
      const [message] = await Promise.race([
        once(child, "message", { signal: AbortSignal.timeout(20000) }),
        once(child, "exit").then(() => {
          throw new Error("Fixture server failed: " + errors);
        }),
      ]);
      return "http://127.0.0.1:" + message.port;
    }
    async function stopServer() {
      if (child?.exitCode === null) {
        const exit = once(child, "exit");
        child.kill();
        await exit;
      }
    }
    t.after(async () => {
      await browser?.close();
      await stopServer();
      store.db.close();
      rmSync(dir, { recursive: true, force: true });
    });
    const base = await start(true);
    browser = await launchBrowser(t);
    if (!browser) return;
    const page = await browser.newPage({
      viewport: { width: 1280, height: 900 },
    });
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    let avatarId, presenterId;
    const geometryEvidence = [];
    async function safeArea(player, insets) {
      await player.evaluate((values) => {
        for (const [side, value] of Object.entries(values))
          document.documentElement.style.setProperty(
            "--player-safe-" + side,
            value + "px",
          );
        window.dispatchEvent(new Event("resize"));
      }, insets);
    }
    async function assertPlayerGeometry(player, insets, label) {
      let measured;
      await expect
        .poll(
          async () => {
            measured = await player.evaluate(() => {
              const rect = (el) => {
                const r = el.getBoundingClientRect();
                return {
                  x: r.x,
                  y: r.y,
                  right: r.right,
                  bottom: r.bottom,
                  width: r.width,
                  height: r.height,
                };
              };
              return {
                width: innerWidth,
                height: innerHeight,
                video: rect(document.getElementById("presenter-video")),
                status: rect(document.getElementById("speech-status")),
                toolbar: rect(document.getElementById("toolbar")),
                stage: rect(document.getElementById("stage")),
                controls: [
                  ...document.querySelectorAll(
                    "#toolbar button, #toolbar select",
                  ),
                ]
                  .filter((el) => el.getClientRects().length)
                  .map(rect),
              };
            });
            const { width, height, video, status, toolbar, stage, controls } =
              measured;
            const overlap = (a, b) =>
              a.x < b.right - 0.5 &&
              a.right > b.x + 0.5 &&
              a.y < b.bottom - 0.5 &&
              a.bottom > b.y + 0.5;
            const errors = [];
            for (const [name, box] of [
              ["video", video],
              ["status", status],
              ["stage", stage],
            ]) {
              if (box.y < insets.top + 15.5)
                errors.push(name + " top safe area");
              if (
                box.x < insets.left + 15.5 ||
                box.right > width - insets.right - 15.5
              )
                errors.push(name + " side safe area");
              if (box.bottom > toolbar.y - 15.5)
                errors.push(name + " toolbar clearance");
            }
            if (toolbar.bottom > height - insets.bottom - 15.5)
              errors.push("bottom safe area");
            if (
              controls.some(
                (r) =>
                  r.width < 44 ||
                  r.height < 44 ||
                  r.bottom > height - insets.bottom - 16,
              )
            )
              errors.push("44px targets");
            if (
              overlap(video, status) ||
              overlap(video, stage) ||
              overlap(status, stage)
            )
              errors.push("overlapping content");
            if (width === 1280 && stage.width < 950)
              errors.push("desktop slide unnecessarily small");
            return errors;
          },
          { message: label, timeout: 5000 },
        )
        .toEqual([]);
      geometryEvidence.push({ label, insets, ...measured });
      writeFileSync(
        path.join(evidence, "round2-player-geometry.json"),
        JSON.stringify(geometryEvidence, null, 2),
      );
    }
    await t.test(
      "rehearsal setup, risk cancellation, local preview, 44px targets and 34px safe area",
      async () => {
        await page.goto(base + "/#project/" + project.id + "/rehearsal");
        const section = page.getByRole("region", {
          name: "数字人讲解员",
          exact: true,
        });
        await expect(section).toBeVisible();
        await section.locator("summary").click();
        await page.getByLabel("新头像名称", { exact: true }).fill("验收头像");
        await page
          .getByLabel("头像图片", { exact: true })
          .setInputFiles("tests/fixtures/presenter/avatar.png");
        await page
          .getByRole("button", { name: "保存头像", exact: true })
          .click();
        await expect(
          page.getByLabel("数字人头像", { exact: true }),
        ).not.toHaveValue("");
        avatarId = await page
          .getByLabel("数字人头像", { exact: true })
          .inputValue();
        await page
          .getByLabel("数字人口播版本", { exact: true })
          .selectOption(narration.id);
        await section.locator("summary").click();
        await page
          .getByLabel("数字人位置", { exact: true })
          .selectOption("top-right");
        for (const width of [1280, 390]) {
          await page.setViewportSize({ width, height: 900 });
          await section.scrollIntoViewIfNeeded();
          await page.screenshot({
            path: path.join(evidence, "rehearsal-setup-" + width + ".png"),
            fullPage: true,
          });
          if (width === 390) {
            const safe = await page.context().newCDPSession(page);
            await safe.send("Emulation.setSafeAreaInsetsOverride", {
              insets: { top: 47, bottom: 34 },
            });
            const nav = page.getByRole("navigation", { name: "项目区域" });
            for (const name of ["概览", "制作台", "演练中心", "交付中心"])
              await expect(
                nav.getByRole("button", { name, exact: true }),
              ).toBeVisible();
            await expect(
              nav.getByRole("button", { name: "演练中心", exact: true }),
            ).toHaveAttribute("aria-current", "page");
            await safe.detach();
            await page.locator("#avatar-presenter").scrollIntoViewIfNeeded();
            await page.screenshot({
              path: path.join(evidence, "candidate-settings-390.png"),
            });
          }
          assert.ok(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth + 1,
            ),
          );
          const bad = await section
            .locator("button,select,input,summary")
            .evaluateAll((nodes) =>
              nodes
                .filter((el) => {
                  const r = el.getBoundingClientRect();
                  return (
                    r.width > 0 &&
                    r.height > 0 &&
                    (r.height < 44 || r.width < 44)
                  );
                })
                .map((el) => el.outerHTML.slice(0, 80)),
            );
          assert.deepEqual(bad, []);
        }
        await page
          .getByRole("button", { name: "生成数字人", exact: true })
          .click();
        await page.getByRole("button", { name: "取消", exact: true }).click();
        assert.equal(store.all("presenter").length, 0);
        await expect(
          page.getByLabel("数字人头像", { exact: true }),
        ).toHaveValue(avatarId);
        await page
          .getByRole("button", { name: "生成数字人", exact: true })
          .click();
        await page
          .getByRole("button", { name: "确认并生成", exact: true })
          .click();
        await expect(
          section.getByText("第 1 页 · 视频已完成", { exact: true }),
        ).toBeVisible();
        presenterId = store.all("presenter")[0].id;
        const preview = page.getByLabel("数字人本地视频预览");
        await expect(preview).toBeVisible();
        await preview.evaluate(async (el) => {
          await el.play();
        });
        await page.waitForFunction(
          () => document.querySelector(".presenter-preview").currentTime > 0.1,
        );
        await preview.evaluate((el) => el.pause());
        for (const width of [1280, 390]) {
          await page.setViewportSize({ width, height: 900 });
          await preview.scrollIntoViewIfNeeded();
          await page.screenshot({
            path: path.join(evidence, "rehearsal-complete-" + width + ".png"),
          });
        }
        const cdp = await page.context().newCDPSession(page);
        await cdp.send("Emulation.setSafeAreaInsetsOverride", {
          insets: { top: 47, bottom: 34 },
        });
        await page.evaluate(() =>
          window.scrollTo(0, document.body.scrollHeight),
        );
        assert.equal(
          await page
            .locator(".project-area-nav")
            .evaluate((el) => el.getBoundingClientRect().height),
          96,
        );
        assert.equal(
          await page
            .locator(".workspace")
            .evaluate((el) => parseFloat(getComputedStyle(el).paddingBottom)),
          124,
        );
        await page.screenshot({
          path: path.join(evidence, "rehearsal-390-safe-area-end.png"),
        });
        await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: {} });
        await cdp.detach();
        await page
          .getByRole("navigation", { name: "项目区域" })
          .getByRole("button", { name: "交付中心", exact: true })
          .click();
        await expect(
          page
            .getByRole("navigation", { name: "项目区域" })
            .getByRole("button", { name: "交付中心", exact: true }),
        ).toHaveAttribute("aria-current", "page");
      },
    );
    await t.test(
      "delivery selection downloads real static and motion presenter HTML and blocks stale export",
      async () => {
        const cdp = await page.context().newCDPSession(page);
        for (const width of [1280, 390]) {
          await page.setViewportSize({ width, height: 900 });
          await cdp.send("Emulation.setSafeAreaInsetsOverride", {
            insets: width === 390 ? { top: 47, bottom: 34 } : {},
          });
          await page.goto(base + "/#project/" + project.id + "/delivery");
          await page
            .getByRole("button", { name: "导出静态 HTML", exact: true })
            .click();
          await page
            .getByRole("dialog")
            .getByLabel("HTML 口播版本", { exact: true })
            .selectOption(narration.id);
          await page
            .getByRole("dialog")
            .getByLabel("包含数字人讲解员", { exact: true })
            .check();
          await expect(
            page
              .getByRole("dialog")
              .getByLabel("HTML 数字人版本", { exact: true }),
          ).toHaveValue(presenterId);
          const exportTargets = await page
            .getByRole("dialog")
            .locator(".motion-check, select, button")
            .evaluateAll((nodes) =>
              nodes.map((el) => el.getBoundingClientRect().height),
            );
          assert.ok(exportTargets.every((height) => height >= 44));
          const download = await page
            .getByRole("button", { name: "下载静态 HTML", exact: true })
            .boundingBox();
          assert.ok(
            download.y + download.height <= 900 - (width === 390 ? 34 : 0),
          );
          await page.screenshot({
            path: path.join(evidence, "delivery-" + width + ".png"),
          });
          if (width === 390) {
            const downloadEvent = page.waitForEvent("download");
            await page
              .getByRole("button", { name: "下载静态 HTML", exact: true })
              .click();
            const file = await downloadEvent;
            await file.saveAs(path.join(evidence, "ui-static.html"));
            await expect(page.locator(".toast")).toContainText(
              file.suggestedFilename(),
            );
          } else
            await page
              .getByRole("button", { name: "关闭", exact: true })
              .click();
        }
        await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: {} });
        await cdp.detach();
        const dynamic = page.locator("article").filter({
          has: page.getByRole("heading", { name: "动态 HTML", exact: true }),
        });
        await dynamic
          .getByLabel("HTML 口播版本", { exact: true })
          .selectOption(narration.id);
        await dynamic.getByLabel("包含数字人讲解员", { exact: true }).check();
        await expect(
          dynamic.getByLabel("HTML 数字人版本", { exact: true }),
        ).toHaveValue(presenterId);
        await dynamic
          .getByLabel("HTML 口播版本", { exact: true })
          .selectOption("");
        await expect(
          dynamic.getByRole("button", { name: "下载动态 HTML", exact: true }),
        ).toBeDisabled();
        await expect(
          dynamic.locator('[data-feedback="blocking"]'),
        ).toBeVisible();
        await dynamic.getByLabel("包含数字人讲解员", { exact: true }).uncheck();
        await expect(
          dynamic.getByRole("button", { name: "下载动态 HTML", exact: true }),
        ).toBeEnabled();
        await dynamic
          .getByLabel("HTML 口播版本", { exact: true })
          .selectOption(narration.id);
        await dynamic.getByLabel("包含数字人讲解员", { exact: true }).check();
        const downloadEvent = page.waitForEvent("download");
        await dynamic
          .getByRole("button", { name: "下载动态 HTML", exact: true })
          .click();
        const downloaded = await downloadEvent;
        await downloaded.saveAs(path.join(evidence, "ui-motion.html"));
        await expect(page.locator(".toast")).toContainText(
          downloaded.suggestedFilename(),
        );
        for (const kind of ["static", "motion"]) {
          const url =
            kind === "static"
              ? "/api/projects/" + project.id + "/html?revision=1"
              : "/api/motion/" + motion.id + "/html?";
          const res = await fetch(
            base +
              url +
              "&narration=" +
              narration.id +
              "&presenter=" +
              presenterId,
          );
          assert.equal(res.status, 200);
          writeFileSync(
            path.join(evidence, "delivery-" + kind + ".html"),
            await res.text(),
          );
        }
        project.slides[0].notes += " 修改";
        project.revision++;
        store.put("project", project);
        const blocked = await fetch(
          base +
            "/api/projects/" +
            project.id +
            "/html?revision=2&narration=" +
            narration.id +
            "&presenter=" +
            presenterId,
        );
        assert.equal(blocked.status, 409);
        await page.goto(base + "/#project/" + project.id + "/delivery");
        await expect(page.locator(".workspace")).toContainText("母版 r2");
        await page
          .getByRole("button", { name: "导出静态 HTML", exact: true })
          .click();
        await page
          .getByRole("dialog")
          .getByLabel("HTML 口播版本", { exact: true })
          .selectOption(narration.id);
        await page
          .getByRole("dialog")
          .getByLabel("包含数字人讲解员", { exact: true })
          .check();
        await expect(
          page.getByRole("button", { name: "下载静态 HTML", exact: true }),
        ).toBeDisabled();
        await page
          .getByRole("dialog")
          .getByRole("button", { name: "前往演练中心更新数字人", exact: true })
          .click();
        await expect(
          page.getByRole("region", { name: "数字人讲解员", exact: true }),
        ).toBeVisible();
        project.slides[0].notes = narration.pages[0].notes;
        store.put("project", project);
      },
    );
    await t.test(
      "offline player start gate, four placements, navigation, pause/replay, fullscreen, autoplay and lazy URL release",
      async () => {
        project.slides[0].notes = narration.pages[0].notes;
        store.put("project", project);
        for (const mode of ["static", "motion"])
          for (const placement of [
            "top-left",
            "top-right",
            "bottom-left",
            "bottom-right",
          ]) {
            const v = await createPresenter(
              project.id,
              {
                avatarId,
                narrationId: narration.id,
                placement,
                size: "small",
                requestId: randomUUID(),
                confirmed: true,
              },
              mockProvider,
            );
            await runPresenter(v.id, mockProvider);
            const presenter = await presenterForExport(
              v.id,
              project.id,
              narration.id,
            );
            const file = path.join(evidence, mode + "-" + placement + ".html");
            rmSync(file, { force: true });
            if (mode === "static")
              await writeStaticHtml(project, { narration, presenter }, file);
            else await writeMotionHtml(motion, { narration, presenter }, file);
            for (const width of [1280, 390]) {
              const player = await browser.newPage({
                viewport: { width, height: 800 },
              });
              const outgoing = [];
              player.on("request", (r) => {
                if (/^https?:/.test(r.url())) outgoing.push(r.url());
              });
              await player.addInitScript(() => {
                const create = URL.createObjectURL.bind(URL),
                  revoke = URL.revokeObjectURL.bind(URL);
                window.__videoUrls = new Set();
                window.__revoked = [];
                URL.createObjectURL = (b) => {
                  const u = create(b);
                  if (b.type === "video/mp4") window.__videoUrls.add(u);
                  return u;
                };
                URL.revokeObjectURL = (u) => {
                  window.__videoUrls.delete(u);
                  window.__revoked.push(u);
                  revoke(u);
                };
              });
              await player.goto(pathToFileURL(file).href);
              await player.waitForFunction(() => window.__motionReady);
              const insets = {
                top: width === 390 ? 47 : 0,
                bottom: width === 390 ? 34 : 0,
                left: 0,
                right: 0,
              };
              await safeArea(player, insets);
              const video = player.locator("#presenter-video"),
                audio = player.locator("#speech-audio");
              await expect(player.locator("#speech-gate")).toBeVisible();
              assert.equal(await video.evaluate((el) => el.paused), true);
              assert.equal(
                await player.evaluate(() => window.__videoUrls.size),
                1,
              );
              await player.locator("#speech-start").click();
              await player.waitForFunction(
                () =>
                  document.querySelector("#presenter-video").currentTime > 0.1,
              );
              assert.equal(
                await audio.evaluate(
                  (el) => el.paused && !el.getAttribute("src"),
                ),
                true,
              );
              await player.locator("#autoplay").click();
              await assertPlayerGeometry(
                player,
                insets,
                `${mode}/${placement}/${width}/portrait-or-desktop`,
              );
              const box = await video.boundingBox();
              assert.equal(
                await video.evaluate((el) => getComputedStyle(el).borderRadius),
                "50%",
              );
              assert(
                placement.endsWith("right")
                  ? box.x > width / 2
                  : box.x < width / 2,
              );
              assert(placement.startsWith("top") ? box.y < 220 : box.y > 400);
              if (["top-right", "bottom-left"].includes(placement))
                await player.screenshot({
                  path: path.join(
                    evidence,
                    "playback-" + mode + "-" + placement + "-" + width + ".png",
                  ),
                });
              if (width === 390) {
                await player.setViewportSize({ width: 844, height: 390 });
                const landscape = { top: 0, bottom: 21, left: 47, right: 47 };
                await safeArea(player, landscape);
                await assertPlayerGeometry(
                  player,
                  landscape,
                  `${mode}/${placement}/landscape`,
                );
                await player.setViewportSize({ width, height: 800 });
                await safeArea(player, insets);
                await assertPlayerGeometry(
                  player,
                  insets,
                  `${mode}/${placement}/portrait-return`,
                );
              }
              await player.locator("#fullscreen").click();
              await player.waitForFunction(() => !!document.fullscreenElement);
              await assertPlayerGeometry(
                player,
                insets,
                `${mode}/${placement}/${width}/fullscreen`,
              );
              await player.locator("#fullscreen").click();
              await player.waitForFunction(() => !document.fullscreenElement);
              await assertPlayerGeometry(
                player,
                insets,
                `${mode}/${placement}/${width}/fullscreen-return`,
              );
              const pausedAt = await video.evaluate((el) => el.currentTime);
              await player.waitForTimeout(100);
              assert.equal(
                await video.evaluate((el) => el.currentTime),
                pausedAt,
              );
              await player.locator("#show-presenter").click();
              await expect(video).toBeHidden();
              await player.locator("#show-presenter").click();
              await expect(video).toBeVisible();
              await player.locator("#next").click();
              await expect(player.locator("#counter")).toHaveText("2 / 3");
              assert.equal(await video.evaluate((el) => el.currentTime), 0);
              assert.equal(
                await player.evaluate(() => window.__videoUrls.size),
                1,
              );
              assert.ok(
                (await player.evaluate(() => window.__revoked.length)) > 0,
              );
              await player.locator("#previous").click();
              await expect(player.locator("#counter")).toHaveText("1 / 3");
              await player.locator("#autoplay").click();
              await player.waitForFunction(
                () =>
                  document.querySelector("#presenter-video").currentTime > 0.2,
              );
              await player.locator("#replay").click();
              assert.ok((await video.evaluate((el) => el.currentTime)) < 0.3);
              await player.locator("#fullscreen").click();
              await player.waitForFunction(() => !!document.fullscreenElement);
              await player.locator("#fullscreen").click();
              await expect(player.locator("#counter")).toHaveText("3 / 3", {
                timeout: 10000,
              });
              await expect(video).toBeHidden();
              await expect(player.locator("#speech-status")).toContainText(
                "演讲已结束",
              );
              assert.deepEqual(outgoing, []);
              await player.close();
            }
          }
        assert.deepEqual(errors, []);
        const media = await createScaleMedia(dir);
        for (const [kind, count] of [
          ["images", 133],
          ["audio", 759],
          ["videos", 133],
        ]) {
          assert.equal(new Set(media[kind].map((m) => m.file)).size, count);
          assert.equal(new Set(media[kind].map((m) => m.hash)).size, count);
        }
        const {
          project: manyProject,
          narration: manyNarration,
          presenter: manyPresenter,
        } = scalePresentation(media, 128, {
          manyClips: false,
          presenter: true,
        });
        const manyFile = path.join(evidence, "lazy-128-pages.html");
        rmSync(manyFile, { force: true });
        await writeStaticHtml(
          manyProject,
          { narration: manyNarration, presenter: manyPresenter },
          manyFile,
        );
        const lazy = await browser.newPage();
        await lazy.addInitScript(() => {
          const create = URL.createObjectURL.bind(URL),
            revoke = URL.revokeObjectURL.bind(URL);
          window.__videos = new Set();
          URL.createObjectURL = (b) => {
            const u = create(b);
            if (b.type === "video/mp4") window.__videos.add(u);
            return u;
          };
          URL.revokeObjectURL = (u) => {
            window.__videos.delete(u);
            revoke(u);
          };
        });
        await lazy.goto(pathToFileURL(manyFile).href);
        await lazy.waitForFunction(() => window.__motionReady);
        assert.equal(await lazy.evaluate(() => window.__videos.size), 1);
        const firstVideo = await lazy
          .locator("#presenter-video")
          .getAttribute("src");
        await lazy.locator("#speech-start").click();
        await lazy.keyboard.press("End");
        await expect(lazy.locator("#counter")).toHaveText("128 / 128");
        assert.notEqual(
          await lazy.locator("#presenter-video").getAttribute("src"),
          firstVideo,
        );
        assert.equal(await lazy.evaluate(() => window.__videos.size), 1);
        const lazyAssets = await lazy
          .locator('script[type="application/octet-stream"]')
          .allTextContents();
        assert.equal(
          lazyAssets.filter((x) => x.startsWith("data:video/mp4")).length,
          128,
        );
        assert.equal(
          new Set(lazyAssets.filter((x) => x.startsWith("data:video/mp4")))
            .size,
          128,
        );
        await lazy.close();
        // Preserve the mainline's long-talk scale without reading private data.
        const { project: longProject, narration: longNarration } =
          scalePresentation(media);
        assert.equal(
          longNarration.pages.reduce((sum, p) => sum + p.clips.length, 0),
          759,
        );
        const longFile = path.join(evidence, "jpeg-133-pages-759-clips.html");
        rmSync(longFile, { force: true });
        await writeStaticHtml(
          longProject,
          { narration: longNarration },
          longFile,
        );
        assert.match(
          readFileSync(longFile, "utf8"),
          /data:image\/jpeg;base64,/,
        );
        const longPlayer = await browser.newPage();
        const external = [];
        await longPlayer.route(/^https?:/, (route) => {
          external.push(route.request().url());
          return route.abort();
        });
        await longPlayer.goto(pathToFileURL(longFile).href);
        await longPlayer.waitForFunction(() => window.__motionReady);
        const independentAssets = [
          ...readFileSync(longFile, "utf8").matchAll(
            /<script type="application\/octet-stream"[^>]*>([^<]*)<\/script>/g,
          ),
        ].map((m) => m[1]);
        assert.equal(
          new Set(
            independentAssets.filter((x) => x.startsWith("data:image/jpeg")),
          ).size,
          133,
        );
        assert.equal(
          new Set(
            independentAssets.filter((x) => x.startsWith("data:audio/mpeg")),
          ).size,
          759,
        );
        const firstImage = await longPlayer
          .locator("#stage img")
          .first()
          .getAttribute("src");
        for (let i = 0; i < 66; i++)
          await longPlayer.keyboard.press("ArrowRight");
        await expect(longPlayer.locator("#counter")).toHaveText("67 / 133");
        await longPlayer.waitForFunction(
          () => !!document.querySelector("#stage img")?.naturalWidth,
        );
        assert.notEqual(
          await longPlayer.locator("#stage img").first().getAttribute("src"),
          firstImage,
        );
        await longPlayer.keyboard.press("Home");
        await longPlayer.locator("#speech-start").click();
        await longPlayer.waitForFunction(
          () => document.querySelector("#speech-audio").currentTime > 0.05,
        );
        await longPlayer.keyboard.press("End");
        await expect(longPlayer.locator("#counter")).toHaveText("133 / 133");
        await longPlayer.waitForFunction(
          () => !!document.querySelector("#stage img")?.naturalWidth,
        );
        await longPlayer.screenshot({
          path: path.join(evidence, "jpeg-133-last-page.png"),
        });
        await longPlayer.keyboard.press("Home");
        await expect(longPlayer.locator("#counter")).toHaveText("1 / 133");
        assert.deepEqual(external, []);
        await longPlayer.close();
      },
    );
    await t.test(
      "static and motion HTML recover offline from Blob, decode and play failures; permission retains the gate",
      async (t) => {
        const presenter = await presenterForExport(
          presenterId,
          project.id,
          narration.id,
        );
        const fallbackNarration = structuredClone(narration);
        fallbackNarration.pages[0].clips = [0, 1].map(() => ({
          ...narration.pages[0].clips[0],
          duration: 0.75,
          pauseAfter: 0.25,
        }));
        for (const mode of ["static", "motion"]) {
          const file = path.join(evidence, mode + "-fallback.html");
          rmSync(file, { force: true });
          if (mode === "static")
            await writeStaticHtml(
              project,
              { narration: fallbackNarration, presenter },
              file,
            );
          else
            await writeMotionHtml(
              motion,
              { narration: fallbackNarration, presenter },
              file,
            );
          for (const failure of ["blob", "decode", "play", "permission"])
            await t.test(mode + ": " + failure, async () => {
              const player = await browser.newPage();
              const outgoing = [],
                errors = [];
              player.on("request", (r) => {
                if (/^https?:/.test(r.url())) outgoing.push(r.url());
              });
              player.on("pageerror", (e) => errors.push(e.message));
              await player.addInitScript((failure) => {
                const create = URL.createObjectURL.bind(URL),
                  revoke = URL.revokeObjectURL.bind(URL),
                  play = HTMLMediaElement.prototype.play;
                window.__videos = new Set();
                window.__revoked = [];
                window.__audioPlays = [];
                window.__audioEnds = [];
                window.__doubleAudio = false;
                let injected = false;
                URL.createObjectURL = (blob) => {
                  if (
                    blob.type === "video/mp4" &&
                    failure === "blob" &&
                    !injected
                  ) {
                    injected = true;
                    throw new Error("synthetic Blob read failure");
                  }
                  const url = create(blob);
                  if (blob.type === "video/mp4") window.__videos.add(url);
                  return url;
                };
                URL.revokeObjectURL = (url) => {
                  window.__videos.delete(url);
                  window.__revoked.push(url);
                  revoke(url);
                };
                HTMLMediaElement.prototype.play = function () {
                  if (
                    this.tagName === "VIDEO" &&
                    !injected &&
                    ["play", "permission"].includes(failure)
                  ) {
                    injected = true;
                    return Promise.reject(
                      new DOMException(
                        "synthetic playback failure",
                        failure === "permission"
                          ? "NotAllowedError"
                          : "NotSupportedError",
                      ),
                    );
                  }
                  return play.call(this);
                };
                document.addEventListener(
                  "playing",
                  (event) => {
                    if (event.target.tagName === "AUDIO")
                      window.__audioPlays.push(performance.now());
                    const audio = document.getElementById("speech-audio"),
                      video = document.getElementById("presenter-video");
                    if (audio && video && !audio.paused && !video.paused)
                      window.__doubleAudio = true;
                  },
                  true,
                );
                document.addEventListener(
                  "ended",
                  (event) => {
                    if (event.target.tagName === "AUDIO")
                      window.__audioEnds.push(performance.now());
                  },
                  true,
                );
              }, failure);
              try {
                await player.goto(pathToFileURL(file).href);
                await player.waitForFunction(() => window.__motionReady);
                await player.locator("#speech-start").click();
                if (failure === "permission") {
                  await expect(player.locator("#speech-gate")).toBeVisible();
                  assert.equal(
                    await player
                      .locator("#speech-audio")
                      .evaluate((el) => el.paused && !el.getAttribute("src")),
                    true,
                  );
                  assert.equal(
                    await player.evaluate(() => window.__videos.size),
                    1,
                  );
                  await player.locator("#speech-start").click();
                  await player.waitForFunction(
                    () =>
                      document.getElementById("presenter-video").currentTime >
                      0.1,
                  );
                  assert.equal(
                    await player.evaluate(() => window.__audioPlays.length),
                    0,
                  );
                } else {
                  if (failure === "decode") {
                    await player.waitForFunction(
                      () =>
                        document.getElementById("presenter-video").currentTime >
                        0.1,
                    );
                    await player
                      .locator("#presenter-video")
                      .evaluate((video) => {
                        video.src = "data:video/mp4;base64,AAAA";
                        video.load(); // Real Chromium media error, not a dispatched test event.
                      });
                  }
                  await player.waitForFunction(
                    () =>
                      document.getElementById("speech-audio").currentTime > 0.1,
                  );
                  assert.equal(
                    await player
                      .locator("#presenter-video")
                      .evaluate((el) => el.paused && !el.getAttribute("src")),
                    true,
                  );
                  assert.equal(
                    await player.evaluate(() => window.__videos.size),
                    0,
                  );
                  await expect(player.locator("#speech-gate")).toBeHidden();
                  await expect(player.locator("#counter")).toHaveText("2 / 3", {
                    timeout: 10000,
                  });
                  const timing = await player.evaluate(() => ({
                    plays: window.__audioPlays,
                    ends: window.__audioEnds,
                  }));
                  assert.equal(timing.plays.length, 2);
                  assert.equal(timing.ends.length, 2);
                  assert.ok(timing.plays[1] - timing.ends[0] >= 200);
                  assert.equal(
                    await player
                      .locator("#speech-audio")
                      .evaluate((el) => el.paused),
                    true,
                  );
                }
                const previousUrl = await player
                  .locator("#presenter-video")
                  .getAttribute("src");
                await player.keyboard.press("End");
                await expect(player.locator("#counter")).toHaveText("3 / 3");
                assert.equal(
                  await player.evaluate(() => window.__videos.size),
                  0,
                );
                assert.ok(
                  (await player.evaluate(() => window.__revoked)).includes(
                    previousUrl,
                  ),
                );
                assert.equal(
                  await player.evaluate(() => window.__doubleAudio),
                  false,
                );
                assert.deepEqual(outgoing, []);
                assert.deepEqual(errors, []);
              } finally {
                await player.close();
              }
            });
        }
      },
    );
    await t.test(
      "unconfigured provider retains selections and blocks generation without a fake production success",
      async () => {
        await stopServer();
        // A production-like project has selections but no test-generated versions.
        const pendingProject = { ...project, id: "presenter-unconfigured" };
        const pendingNarration = {
          ...narration,
          id: "narration-unconfigured",
          projectId: pendingProject.id,
        };
        store.put("project", pendingProject);
        store.put("narration", pendingNarration);
        const unconfigured = await start(false);
        await page.goto(
          unconfigured + "/#project/" + pendingProject.id + "/rehearsal",
        );
        await page
          .getByLabel("数字人头像", { exact: true })
          .selectOption(avatarId);
        await page
          .getByLabel("数字人口播版本", { exact: true })
          .selectOption(pendingNarration.id);
        await page.setViewportSize({ width: 390, height: 844 });
        await page
          .getByLabel("数字人位置", { exact: true })
          .selectOption("bottom-left");
        await page.reload();
        const region = page.getByRole("region", {
          name: "数字人讲解员",
          exact: true,
        });
        const unavailable = region
          .locator('[data-feedback="blocking"]')
          .filter({ hasText: "数字人服务尚未接入" });
        await expect(unavailable).toContainText(
          "暂不能生成，但可以先预配置",
        );
        await expect(unavailable).toContainText(
          "已选头像、口播版本和位置会保留",
        );
        await expect(unavailable).toContainText(
          "服务接入并就绪后即可生成",
        );
        const generate = region.getByRole("button", {
          name: "生成数字人",
          exact: true,
        });
        await expect(generate).toBeDisabled();
        await expect(generate).toHaveAccessibleDescription(
          /服务接入并就绪后即可生成/,
        );
        await expect(
          region.getByLabel("数字人头像", { exact: true }),
        ).toHaveValue(avatarId);
        await expect(
          region.getByLabel("数字人口播版本", { exact: true }),
        ).toHaveValue(pendingNarration.id);
        await expect(
          region.getByLabel("数字人位置", { exact: true }),
        ).toHaveValue("bottom-left");
        await expect(region).not.toContainText(/mock|测试模式|测试样本|去配置/);
        await expect(
          region.getByRole("button", { name: /配置|设置/ }),
        ).toHaveCount(0);
        await expect(
          region.getByRole("link", { name: /配置|设置/ }),
        ).toHaveCount(0);
        const mobileSafe = await page.context().newCDPSession(page);
        await mobileSafe.send("Emulation.setSafeAreaInsetsOverride", {
          insets: { top: 47, bottom: 34 },
        });
        await region.evaluate((el) => el.scrollIntoView({ block: "start" }));
        await expect(
          page
            .getByRole("navigation", { name: "项目区域" })
            .getByRole("button", { name: "演练中心", exact: true }),
        ).toHaveAttribute("aria-current", "page");
        await expect(generate).toBeInViewport();
        await page.screenshot({
          path: path.join(evidence, "provider-unconfigured-390.png"),
        });
        const response = await fetch(
          unconfigured + "/api/projects/" + pendingProject.id + "/presenter",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              avatarId,
              narrationId: pendingNarration.id,
              placement: "top-right",
              size: "small",
              requestId: randomUUID(),
              confirmed: true,
            }),
          },
        );
        assert.equal(response.status, 409);
      },
    );
    await t.test(
      "review screenshots have exact mobile/desktop dimensions and all safe-area geometry evidence",
      async () => {
        assert.equal(geometryEvidence.length, 64);
        const screenshots = [];
        for (const mode of ["static", "motion"])
          for (const placement of ["top-right", "bottom-left"])
            for (const width of [390, 1280])
              screenshots.push({
                file: `playback-${mode}-${placement}-${width}.png`,
                width,
                height: 800,
              });
        screenshots.push({
          file: "provider-unconfigured-390.png",
          width: 390,
          height: 844,
        });
        for (const entry of screenshots) {
          const bytes = readFileSync(path.join(evidence, entry.file));
          const info = await sharp(bytes).metadata();
          assert.equal(info.width, entry.width, entry.file);
          assert.equal(info.height, entry.height, entry.file);
          entry.sha256 = createHash("sha256").update(bytes).digest("hex");
        }
        writeFileSync(
          path.join(evidence, "round2-screenshots.json"),
          JSON.stringify(screenshots, null, 2),
        );
      },
    );
  },
);
