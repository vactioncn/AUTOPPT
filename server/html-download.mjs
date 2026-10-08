import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// Finish and validate the complete export before sending HTTP headers. A
// missing late-page asset must return a readable error, not a broken download.
export async function sendHtmlDownload(res, filename, download, write) {
  const directory = await mkdtemp(path.join(tmpdir(), "autoppt-html-"));
  const file = path.join(directory, "presentation.html");
  const controller = new AbortController();
  const closed = () => controller.abort();
  res.once("close", closed);
  try {
    if (res.destroyed) return;
    await write(file, controller.signal);
    controller.signal.throwIfAborted();
    if (download) res.attachment(filename);
    res.type("html");
    await new Promise((resolve, reject) => {
      res.sendFile(file, (error) => (error ? reject(error) : resolve()));
    });
  } catch (error) {
    if (!res.destroyed && !res.headersSent) throw error;
    if (!res.destroyed) res.destroy(error);
  } finally {
    res.off("close", closed);
    await rm(directory, { recursive: true, force: true });
  }
}
