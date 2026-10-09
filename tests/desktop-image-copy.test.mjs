import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { _electron as electron } from "@playwright/test";
import sharp from "sharp";

test(
  "Mac image context action copies bitmap pixels and restores the user's clipboard",
  { skip: process.platform !== "darwin", timeout: 45000 },
  async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "autoppt-clipboard-test-"));
    mkdirSync(path.join(dir, "profile"));
    const fixture = await sharp({
      create: { width: 40, height: 30, channels: 3, background: "#bb5522" },
    })
      .png()
      .toBuffer();
    const require = createRequire(import.meta.url);
    const helper = path.resolve("desktop/context-menu.cjs");
    writeFileSync(
      path.join(dir, "main.cjs"),
      `
    const {app,BrowserWindow,clipboard,ClipboardItem} = require('electron');
    app.setPath('userData', ${JSON.stringify(path.join(dir, "profile"))});
    app.whenReady().then(async () => {
      global.w = new BrowserWindow({show:true,webPreferences:{sandbox:true}});
      w.webContents.on('context-menu',(_e,p) => {
        const {imageContextMenu} = require(${JSON.stringify(helper)});
        global.params = p;
        const items = imageContextMenu(w.webContents,p,url => url.startsWith('data:text/html'));
        if(items[0]?.label === '复制图片') items[0].click();
      });
      w.loadURL('data:text/html,<img style="width:40px;height:30px" src="data:image/png;base64,${fixture.toString("base64")}">');
    }).catch(e=>{global.failure=String(e);});
  `,
    );
    let app;
    try {
      const env = { ...process.env };
      delete env.ELECTRON_RUN_AS_NODE;
      app = await electron.launch({
        executablePath: require("electron"),
        args: [path.join(dir, "main.cjs")],
        env,
        timeout: 12000,
      });
      const win = await app.firstWindow({ timeout: 12000 });
      await win.locator("img").waitFor();
      await app.evaluate(async ({ clipboard, ClipboardItem }) => {
        global.saved = await Promise.all(
          (await clipboard.read()).map(
            async (item) =>
              new ClipboardItem(
                Object.fromEntries(
                  await Promise.all(
                    item.types.map(async (type) => [
                      type,
                      await item.getType(type),
                    ]),
                  ),
                ),
              ),
          ),
        );
      });
      await win.locator("img").click({ button: "right" });
      const deadline = Date.now() + 5000;
      let size;
      do {
        size = await app.evaluate(async ({ clipboard, nativeImage }) => {
          const item = (await clipboard.read()).find((i) =>
            i.types.includes("image/png"),
          );
          if (!item) return { width: 0, height: 0 };
          return nativeImage
            .createFromBuffer(
              Buffer.from(
                await (await item.getType("image/png")).arrayBuffer(),
              ),
            )
            .getSize();
        });
        if (size.width === 40 && size.height === 30) break;
        await new Promise((r) => setTimeout(r, 100));
      } while (Date.now() < deadline);
      assert.deepEqual(size, { width: 40, height: 30 });
      const pixels = await app.evaluate(async ({ clipboard, nativeImage }) => {
        const item = (await clipboard.read()).find((i) =>
          i.types.includes("image/png"),
        );
        return [
          ...nativeImage
            .createFromBuffer(
              Buffer.from(
                await (await item.getType("image/png")).arrayBuffer(),
              ),
            )
            .toBitmap()
            .subarray(0, 4),
        ];
      });
      assert.deepEqual(pixels, [34, 85, 187, 255]);
      const { imageContextMenu } = require(helper);
      assert.deepEqual(
        imageContextMenu(
          {},
          {
            frameURL: "https://untrusted.invalid",
            mediaType: "image",
            hasImageContents: true,
          },
          () => false,
        ),
        [],
      );
    } finally {
      if (app) {
        await app.evaluate(async ({ clipboard }) => {
          if (global.saved) await clipboard.write(global.saved);
        });
        await app.close();
      }
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
