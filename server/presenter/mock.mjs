import { readFile } from "node:fs/promises";

// Test adapter only. This is a deterministic audiovisual fixture, not lip sync.
// Real adapters must provide server-side idempotency using request.requestId,
// combine request.audio.clips (including pauses) and download validated bytes.
// Credentials and temporary provider URLs stay inside an adapter, never records.
export const mockProvider = Object.freeze({
  id: "mock",
  idempotent: true,
  async generate(_request) {
    return {
      status: 200,
      contentType: "video/mp4",
      duration: 2,
      bytes: await readFile(
        new URL(
          "../../tests/fixtures/presenter/presenter.mp4",
          import.meta.url,
        ),
      ),
    };
  },
});
export async function configuredProvider() {
  // No production switch or UI option can enable a fake successful generation.
  return process.env.NODE_ENV === "test" &&
    process.env.AUTOPPT_PRESENTER_TEST === "1"
    ? mockProvider
    : null;
}
