import test from "node:test";
import assert from "node:assert/strict";
import { publicPage, workspaceTarget } from "../shared/web-routes.mjs";
import {
  supportConfig,
  renderWebsiteShell,
  websiteSitemap,
} from "../server/hosted/site.mjs";
test("public entry and safe workspace returns keep invitation and account journeys separate", () => {
  assert.equal(publicPage("/", ""), "website");
  assert.equal(publicPage("/", "#intro"), "website");
  assert.equal(publicPage("/", "#web-content"), "website");
  for (const path of [
    "login",
    "register",
    "support",
    "privacy",
    "terms",
    "website",
  ])
    assert.equal(publicPage("/" + path + "/"), path);
  assert.equal(publicPage("/", "#project/123/studio"), null);
  assert.equal(publicPage("/", "#help"), null);
  assert.equal(publicPage("/missing"), "notfound");
  const target = "project/3d122529-38d4-4584-a4bc-29b1ce652fdc/studio";
  assert.equal(workspaceTarget("#" + target), target);
  for (const value of [
    "https://example.com",
    "//example.com",
    "javascript:alert(1)",
    "/login",
    "register?invite=secret",
    "project/../../assets",
    "#intro",
    null,
  ])
    assert.equal(workspaceTarget(value), "projects");
});
test("support configuration rejects script links and header injection", () => {
  assert.deepEqual(supportConfig({}), { supportEmail: "", supportUrl: "" });
  assert.deepEqual(
    supportConfig({
      AUTOPPT_SUPPORT_EMAIL: " support@example.com ",
      AUTOPPT_SUPPORT_URL: "https://example.com/help",
    }),
    {
      supportEmail: "support@example.com",
      supportUrl: "https://example.com/help",
    },
  );
  assert.throws(() =>
    supportConfig({
      AUTOPPT_SUPPORT_EMAIL: "support@example.com\r\nBcc: a@b.com",
    }),
  );
  for (const url of [
    "javascript:alert(1)",
    "http://example.com",
    "https://user:pass@example.com",
  ])
    assert.throws(() => supportConfig({ AUTOPPT_SUPPORT_URL: url }));
});
test("public metadata uses configured domain, excludes invitations and has no private data", () => {
  const shell =
    '<html><head><title>old</title></head><body><div id="root"></div></body></html>';
  const home = renderWebsiteShell(shell, "/", "https://ppt.example.com");
  assert(home.includes('href="https://ppt.example.com/website"'));
  assert(home.includes('content="index,follow"'));
  assert(home.includes("<noscript>"));
  const register = renderWebsiteShell(
    shell,
    "/register",
    "https://ppt.example.com",
  );
  assert(register.includes('content="noindex,nofollow"'));
  const sitemap = websiteSitemap("https://ppt.example.com");
  assert(sitemap.includes("https://ppt.example.com/support"));
  assert(!sitemap.includes("register"));
  assert(!sitemap.includes("login"));
  assert(!sitemap.includes("api"));
});
