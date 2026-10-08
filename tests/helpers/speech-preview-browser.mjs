import assert from "node:assert/strict";

export async function verifySpeechPreview(page, savedFile, screenshotDir) {
  const area = page.getByRole("region", { name: "本页试听", exact: true });
  const preview = page.getByLabel("合成口播试听", { exact: true });
  const voice = page.getByLabel("演讲声音", { exact: true });
  const originalVoice = await voice.inputValue();
  const choices = await voice
    .locator("option")
    .evaluateAll((nodes) => nodes.map((n) => n.value));
  const reset = async () => {
    const current = await voice.inputValue();
    await voice.selectOption(choices.find((v) => v !== current));
    await area
      .getByRole("button", { name: "试听本页开头", exact: true })
      .waitFor();
    assert.equal(
      await preview.isVisible(),
      false,
      "changed settings invalidate the previous sample",
    );
  };
  const playing = () =>
    page.waitForFunction(() => {
      const el = document.querySelector('audio[aria-label="合成口播试听"]');
      return el && !el.paused && el.currentTime > 0.05;
    });
  let requests = 0,
    release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  await page.route("**/api/speech/preview", async (route) => {
    requests++;
    await gate;
    await route.continue();
  });
  await area.getByRole("button", { name: "试听本页开头", exact: true }).click();
  await page
    .getByRole("dialog", { name: "确认试听本页开头", exact: true })
    .getByRole("button", { name: "确认试听本页开头", exact: true })
    .click();
  await area.getByRole("status").filter({ hasText: "正在生成试听" }).waitFor();
  assert(
    await area
      .getByRole("button", { name: "正在生成试听…", exact: true })
      .isDisabled(),
  );
  assert(
    await page
      .getByRole("button", { name: "生成整场口播 · 2 页", exact: true })
      .isDisabled(),
  );
  if (screenshotDir)
    await page.screenshot({ path: screenshotDir + "/preview-generating.png" });
  release();
  await playing();
  await area.getByRole("button", { name: "暂停试听", exact: true }).click();
  await area
    .getByText("试听已暂停，可继续播放，无需重新生成。", { exact: true })
    .waitFor();
  await area.getByRole("button", { name: "继续试听", exact: true }).click();
  await area.getByRole("button", { name: "重播试听", exact: true }).waitFor();
  await area.getByRole("button", { name: "重播试听", exact: true }).click();
  await playing();
  assert.equal(
    requests,
    1,
    "pause/resume/replay must not request synthesis again",
  );
  await page.unroute("**/api/speech/preview");

  // A real play() rejection must expose an adjacent one-click playback fallback.
  await reset();
  await page.evaluate(() => {
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      if (this.getAttribute("aria-label") === "合成口播试听") {
        HTMLMediaElement.prototype.play = play;
        return Promise.reject(
          new DOMException("blocked for test", "NotAllowedError"),
        );
      }
      return play.call(this);
    };
  });
  await page.route("**/api/speech/preview", async (route) => {
    requests++;
    await route.fulfill({ json: { file: savedFile } });
  });
  await area.getByRole("button", { name: "试听本页开头", exact: true }).click();
  await page
    .getByRole("dialog", { name: "确认试听本页开头", exact: true })
    .getByRole("button", { name: "确认试听本页开头", exact: true })
    .click();
  await area.getByText(/自动播放被拦截/).waitFor();
  if (screenshotDir)
    await page.screenshot({ path: screenshotDir + "/preview-blocked.png" });
  await area
    .getByRole("button", { name: "播放已生成试听", exact: true })
    .click();
  await playing();
  assert.equal(
    requests,
    2,
    "autoplay fallback must play the saved sample without TTS",
  );

  // Failed media reads retry the same audio URL, without another preview POST.
  await reset();
  await page.route("**/api/speech/audio/**", (route) =>
    route.fulfill({ status: 503, body: "temporarily unavailable" }),
  );
  await area.getByRole("button", { name: "试听本页开头", exact: true }).click();
  await page
    .getByRole("dialog", { name: "确认试听本页开头", exact: true })
    .getByRole("button", { name: "确认试听本页开头", exact: true })
    .click();
  await area.getByRole("alert").waitFor();
  await page.unroute("**/api/speech/audio/**");
  await area
    .getByRole("button", { name: "播放已生成试听", exact: true })
    .click();
  await playing();
  assert.equal(requests, 3, "media retry must not synthesize again");
  await page.unroute("**/api/speech/preview");

  await reset();
  await page.route("**/api/speech/preview", (route) =>
    route.fulfill({
      status: 503,
      json: { error: "语音服务暂时繁忙，请稍后重试" },
    }),
  );
  await area.getByRole("button", { name: "试听本页开头", exact: true }).click();
  await page
    .getByRole("dialog", { name: "确认试听本页开头", exact: true })
    .getByRole("button", { name: "确认试听本页开头", exact: true })
    .click();
  await area
    .getByRole("alert")
    .filter({ hasText: "语音服务暂时繁忙" })
    .waitFor();
  assert(
    await area
      .getByRole("button", { name: "试听本页开头", exact: true })
      .isEnabled(),
  );
  assert.equal(
    await preview.isVisible(),
    false,
    "a failed request must not show a stale sample",
  );
  await page.unroute("**/api/speech/preview");

  let releaseCancelled, intercepted, settled;
  const pending = new Promise((resolve) => {
    releaseCancelled = resolve;
  });
  const requestStarted = new Promise((resolve) => {
    intercepted = resolve;
  });
  const requestSettled = new Promise((resolve) => {
    settled = resolve;
  });
  await page.route("**/api/speech/preview", async (route) => {
    intercepted();
    await pending;
    try {
      await route.fulfill({ json: { file: savedFile } });
    } catch {
      /* The client has explicitly cancelled this intercepted request. */
    } finally {
      settled();
    }
  });
  await area.getByRole("button", { name: "试听本页开头", exact: true }).click();
  await page
    .getByRole("dialog", { name: "确认试听本页开头", exact: true })
    .getByRole("button", { name: "确认试听本页开头", exact: true })
    .click();
  await requestStarted;
  await area.getByRole("button", { name: "停止等待", exact: true }).click();
  await area.getByText(/已停止等待试听/).waitFor();
  releaseCancelled();
  await requestSettled;
  await page.unroute("**/api/speech/preview");
  assert.equal(
    await preview.isVisible(),
    false,
    "late cancelled results must not autoplay",
  );
  assert(
    await page
      .getByRole("button", { name: "生成整场口播 · 2 页", exact: true })
      .isEnabled(),
  );

  // Leaving the production panel must abort pending work and ignore late results.
  let releaseLeaving, leavingStarted, leavingSettled;
  const leavingGate = new Promise((resolve) => {
    releaseLeaving = resolve;
  });
  const started = new Promise((resolve) => {
    leavingStarted = resolve;
  });
  const finished = new Promise((resolve) => {
    leavingSettled = resolve;
  });
  await page.route("**/api/speech/preview", async (route) => {
    leavingStarted();
    await leavingGate;
    try {
      await route.fulfill({ json: { file: savedFile } });
    } catch {
      /* Navigating away aborts the request. */
    } finally {
      leavingSettled();
    }
  });
  await area.getByRole("button", { name: "试听本页开头", exact: true }).click();
  await page
    .getByRole("dialog", { name: "确认试听本页开头", exact: true })
    .getByRole("button", { name: "确认试听本页开头", exact: true })
    .click();
  await started;
  await page.getByRole("tab", { name: "1 · 口播文本", exact: true }).click();
  releaseLeaving();
  await finished;
  await page.unroute("**/api/speech/preview");
  assert.equal(await preview.count(), 0);

  // The same playback path also works without a performance plan.
  await page.getByRole("tab", { name: "2 · 演讲表达", exact: true }).click();
  await page
    .getByRole("button", { name: "改用普通口播 · 选择声音", exact: true })
    .click();
  await page.route("**/api/speech/preview", async (route) => {
    assert.equal(route.request().postDataJSON().performanceId, undefined);
    await route.fulfill({ json: { file: savedFile } });
  });
  await area.getByRole("button", { name: "试听本页开头", exact: true }).click();
  await page
    .getByRole("dialog", { name: "确认试听本页开头", exact: true })
    .getByRole("button", { name: "确认试听本页开头", exact: true })
    .click();
  await playing();
  await page.unroute("**/api/speech/preview");
  await page.getByRole("tab", { name: "2 · 演讲表达", exact: true }).click();
  await page
    .getByRole("button", { name: "使用方案 · 选择声音", exact: true })
    .click();
  await voice.selectOption(originalVoice);
}
