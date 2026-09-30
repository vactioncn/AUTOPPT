import { load } from "cheerio";
import sharp from "sharp";
import path from "node:path";
import { mkdir, rm, copyFile } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { publicFetch, publicUrl } from "./public-fetch.mjs";

const blockedMessage =
  "这个网站需要登录或访问验证，暂时无法自动获取。请在原网页保存参考图片，再用「上传图片」导入。";
const maxCandidates = 36;
const ttl = 30 * 60 * 1000;
export function extractPage(html, base) {
  const $ = load(html);
  const zcool = /(^|\.)zcool\.com\.cn$/.test(new URL(base).hostname);
  const title = (
    $("h1").first().text().trim() ||
    $('meta[property="og:title"]').attr("content") ||
    $("title").text() ||
    new URL(base).hostname
  )
    .trim()
    .slice(0, 200);
  let nodes = zcool
    ? $("img.photoImage, .work-content img, .workShowBox img")
    : $("main img, article img, [role=main] img");
  if (!nodes.length && !zcool) nodes = $("img");
  const candidates = [];
  const seen = new Set();
  const add = (raw, alt = "") => {
    try {
      const url = publicUrl(new URL(raw, base).href).href;
      if (seen.has(url)) return;
      seen.add(url);
      candidates.push({ url, alt: alt.slice(0, 160) });
    } catch {
      /* Non-network images are not fetched. */
    }
  };
  nodes.each((_, element) => {
    const img = $(element);
    if (
      img.parents(
        "nav, header, footer, aside, [class*=recommend], [class*=avatar], [class*=comment]",
      ).length
    )
      return;
    if (
      /avatar|logo|icon|qrcode|二维码|头像/i.test(
        [img.attr("class"), img.attr("alt"), img.attr("src")].join(" "),
      )
    )
      return;
    const picture = img.closest("picture").find("source").first();
    const srcset =
      img.attr("data-srcset") ||
      img.attr("srcset") ||
      picture.attr("data-srcset") ||
      picture.attr("srcset") ||
      "";
    const largest = [
      ...srcset.matchAll(/(\S+)\s+(\d+(?:\.\d+)?)[wx](?=\s*(?:,|$))/g),
    ].sort((a, b) => Number(b[2]) - Number(a[2]))[0]?.[1];
    const raw =
      img.attr("data-original") ||
      largest ||
      img.attr("data-src") ||
      img.attr("data-lazy-src") ||
      img.attr("src");
    if (raw) add(raw, img.attr("alt") || "");
  });
  if (!candidates.length && !zcool) {
    $('meta[property="og:image"], meta[name="twitter:image"]').each((_, e) =>
      add($(e).attr("content")),
    );
  }
  const gated =
    /aliyun_waf_aa|captcha|访问验证|人机验证|verify you are human/i.test(html);
  return {
    title,
    candidates: candidates.slice(0, maxCandidates),
    truncated: candidates.length > maxCandidates,
    gated,
  };
}

// Ordinary browser rendering handles public pages that require JavaScript. It
// uses a fresh profile and never solves challenges or borrows login cookies.
async function renderPublicPage(url, signal) {
  const { chromium } = await import("playwright-core");
  let browser;
  try {
    browser = await chromium.launch({
      channel: "chrome",
      headless: true,
      timeout: 10000,
    });
  } catch {
    throw new Error(
      "此网页需要浏览器加载。请安装 Google Chrome 后重试，或上传参考图片。",
    );
  }
  const stop = () => {
    void browser.close();
  };
  signal.addEventListener("abort", stop, { once: true });
  try {
    signal.throwIfAborted();
    const context = await browser.newContext({ serviceWorkers: "block" });
    let requests = 0,
      bytes = 0;
    await context.route("**/*", async (route) => {
      const req = route.request();
      if (
        signal.aborted ||
        ++requests > 100 ||
        bytes > 30 * 1024 * 1024 ||
        req.method() !== "GET" ||
        ["image", "media", "font"].includes(req.resourceType())
      )
        return route.abort().catch(() => {});
      try {
        const h = await req.allHeaders();
        const response = await publicFetch(req.url(), {
          signal,
          followRedirects: false,
          maxBytes: 6 * 1024 * 1024,
          headers: {
            Accept: h.accept || "*/*",
            "User-Agent": h["user-agent"],
            ...(h.cookie ? { Cookie: h.cookie } : {}),
          },
        });
        bytes += response.body.length;
        const safeHeaders = Object.fromEntries(
          Object.entries(response.headers)
            .filter(
              ([key]) =>
                ![
                  "content-encoding",
                  "content-length",
                  "transfer-encoding",
                  "connection",
                ].includes(key),
            )
            .map(([key, value]) => [
              key,
              Array.isArray(value) ? value.join("\n") : String(value),
            ]),
        );
        await route.fulfill({
          status: response.status,
          headers: safeHeaders,
          body: response.body,
        });
      } catch {
        await route.abort().catch(() => {});
      }
    });
    await context.routeWebSocket("**/*", (socket) => socket.close());
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 22000 });
    // Allow normal JavaScript navigation to settle; do not interact with gates.
    await page
      .locator("img.photoImage")
      .first()
      .waitFor({ state: "attached", timeout: 12000 })
      .catch(() => {});
    if (
      await page
        .locator("#WAF_NC_WRAPPER")
        .isVisible()
        .catch(() => false)
    )
      throw new Error(blockedMessage);
    return { html: await page.content(), url: page.url() };
  } finally {
    signal.removeEventListener("abort", stop);
    await browser.close();
  }
}

export async function collectImages(
  url,
  {
    signal = AbortSignal.timeout(75000),
    fetchPage = publicFetch,
    render = renderPublicPage,
    saveImage,
  } = {},
) {
  url = publicUrl(url).href;
  let response = await fetchPage(url, { signal, maxBytes: 12 * 1024 * 1024 });
  const directImage = /^image\/(png|jpeg|webp|avif)(;|$)/i.test(
    response.headers?.["content-type"] || "",
  );
  let page = directImage
    ? {
        title: "图片参考 · " + new URL(response.url).hostname,
        candidates: [{ url: response.url }],
        truncated: false,
        gated: false,
      }
    : extractPage(response.body.toString("utf8"), response.url);
  if (
    !page.candidates.length &&
    /(^|\.)zcool\.com\.cn$/.test(new URL(url).hostname)
  ) {
    const rendered = await render(url, signal);
    response = { ...response, url: rendered.url, status: 200 };
    page = extractPage(rendered.html, rendered.url);
  }
  if (!page.candidates.length)
    throw new Error(
      page.gated || [401, 403, 429].includes(response.status)
        ? blockedMessage
        : "没有找到可用的作品图片。请换成具体作品页，或上传参考图片。",
    );
  if (response.status !== 200)
    throw new Error("网页暂时无法访问，请稍后重试或上传参考图片。");
  const results = new Array(page.candidates.length);
  let next = 0,
    skipped = 0;
  const hashes = new Set();
  await Promise.allSettled(
    Array.from({ length: 4 }, async () => {
      while (next < page.candidates.length) {
        const index = next++,
          candidate = page.candidates[index];
        signal?.throwIfAborted();
        try {
          const r = directImage
            ? response
            : await fetchPage(candidate.url, {
                signal,
                maxBytes: 12 * 1024 * 1024,
                headers: { Referer: response.url },
              });
          if (r.status !== 200) throw new Error("image unavailable");
          const image = sharp(r.body, {
            limitInputPixels: 40000000,
            animated: false,
          });
          const metadata = await image.metadata();
          if (
            !["png", "jpeg", "webp", "avif"].includes(metadata.format) ||
            metadata.width < 480 ||
            metadata.height < 240
          )
            throw new Error("not a work image");
          const { data, info } = await image
            .rotate()
            .resize({
              width: 1600,
              height: 1600,
              fit: "inside",
              withoutEnlargement: true,
            })
            .png()
            .toBuffer({ resolveWithObject: true });
          const hash = createHash("sha256").update(data).digest("hex");
          if (hashes.has(hash)) {
            skipped++;
            continue;
          }
          hashes.add(hash);
          const id = randomUUID();
          signal?.throwIfAborted();
          await saveImage(id, data);
          results[index] = {
            id,
            width: info.width,
            height: info.height,
            originalWidth: metadata.width,
            originalHeight: metadata.height,
            sourceUrl: candidate.url,
          };
        } catch (e) {
          signal?.throwIfAborted();
          skipped++;
        }
      }
    }),
  );
  signal?.throwIfAborted();
  const images = results.filter(Boolean);
  if (!images.length)
    throw new Error(
      "找到的图片无法下载，或尺寸太小。请在原网页保存参考图片后上传。",
    );
  return {
    url: response.url,
    title: page.title,
    images,
    skipped,
    truncated: page.truncated,
  };
}

export function registerStyleImports(
  app,
  { dataDir, assetPath, put, id, now, enqueue, collect = collectImages },
) {
  const imports = new Map();
  const root = path.join(dataDir, "style-imports");
  let running = false;
  const clean = async () => {
    for (const [key, value] of imports)
      if (!value.saving && Date.now() > value.expiresAt) {
        imports.delete(key);
        await rm(path.join(root, key), { recursive: true, force: true });
      }
  };
  // Drafts have no durable references. Clear leftovers from the previous process.
  const ready = rm(root, { recursive: true, force: true }).then(() =>
    mkdir(root, { recursive: true }),
  );
  const timer = setInterval(() => {
    void ready.then(clean).catch(() => {});
  }, 60000);
  timer.unref();
  const draft = (key) => {
    const value = imports.get(key);
    if (!value || value.expiresAt < Date.now())
      throw new Error("图片预览已过期，请重新获取网址。");
    return value;
  };
  app.post("/api/style-imports", async (req, res) => {
    if (running) throw new Error("正在获取网页图片，请稍候再试。");
    const url = publicUrl(req.body.url).href;
    running = true;
    const key = id(),
      dir = path.join(root, key);
    const controller = new AbortController();
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(75000),
    ]);
    const disconnect = () => {
      if (!res.writableEnded) controller.abort();
    };
    res.on("close", disconnect);
    try {
      await ready;
      await clean();
      await mkdir(dir, { recursive: true });
      const result = await collect(url, {
        signal,
        saveImage: (key, bytes) =>
          sharp(bytes).toFile(path.join(dir, key + ".png")),
      });
      signal.throwIfAborted();
      const value = { ...result, id: key, expiresAt: Date.now() + ttl };
      imports.set(key, value);
      res.json({
        ...value,
        images: value.images.map((image) => ({
          ...image,
          preview: `/api/style-imports/${key}/images/${image.id}`,
        })),
      });
    } catch (e) {
      await rm(dir, { recursive: true, force: true });
      if (signal.aborted)
        throw new Error("获取已取消或超时，请重试，也可以直接上传参考图片。");
      throw e;
    } finally {
      running = false;
      res.off("close", disconnect);
    }
  });
  app.get("/api/style-imports/:id/images/:imageId", (req, res) => {
    const value = draft(req.params.id);
    if (!value.images.some((image) => image.id === req.params.imageId))
      return res.sendStatus(404);
    res.sendFile(req.params.imageId + ".png", {
      root: path.join(root, value.id),
    });
  });
  app.post("/api/styles/from-url", async (req, res) => {
    const name = String(req.body.name || "").trim();
    if (!name || name.length > 60)
      throw new Error("请输入 1–60 字的风格名称。");
    const value = draft(req.body.importId);
    const keys = req.body.imageIds;
    if (
      !Array.isArray(keys) ||
      keys.length < 1 ||
      keys.length > 12 ||
      new Set(keys).size !== keys.length ||
      keys.some((key) => !value.images.some((image) => image.id === key))
    )
      throw new Error("请从获取到的图片中选择 1–12 张参考图。");
    if (value.saving || value.saved)
      throw new Error("这组参考图已经提交，请在风格库查看。");
    value.saving = true;
    const selected = value.images.filter((image) => keys.includes(image.id));
    const refs = [];
    try {
      for (const image of selected) {
        const filename = id() + ".png";
        await copyFile(
          path.join(root, value.id, image.id + ".png"),
          assetPath(filename),
        );
        refs.push(filename);
      }
      const style = put("style", {
        id: id(),
        name,
        refs,
        source: {
          url: value.url,
          title: value.title,
          importedAt: now(),
          images: selected.map((image, i) => ({
            ref: refs[i],
            url: image.sourceUrl,
          })),
        },
        colors: [],
        rules: "",
        description: "等待提炼参考图",
        status: "pending",
        builtin: false,
        createdAt: now(),
        updatedAt: now(),
      });
      value.saved = true;
      const job = enqueue("style", null, { styleId: style.id });
      res.status(201).json({ style, job });
    } finally {
      value.saving = false;
    }
  });
}
