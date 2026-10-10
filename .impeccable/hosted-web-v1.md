# Hosted Web V1

Mode: Operate. Existing-world extension of `DESIGN.md`'s Quiet Personal Speech Studio. The approved warm paper, terracotta and olive identity continues; no identity replacement or new visual-world workshop is required.

THESIS: Join with an invitation, make presentation images in an independent workspace, then manually present or take the project away.

OWN-WORLD: AutoPPT's warm, restrained working studio. Content, complete page images and written readiness lead; controls reuse the incumbent type, paper surfaces, terracotta actions, olive navigation and fine borders.

TYPE: The locally bundled DM Sans stack and Chinese system fallbacks continue. The player has a scoped 18px/500 project title and 20px current-page heading. These are observed component values, not additions to the global type scale.

MATERIAL: Warm canvas, white working surfaces, fine olive-gray borders and gently rounded controls. Login uses the existing account surface treatment, including its pale warm canvas, white form and diffuse shadow. Ordinary hosted views retain the shared shell. The player uses incumbent ink `#242824` as a picture stage, with canvas-colored controls and a pale sidebar-colored manuscript panel; this is a local media surface.

GROUND: The working surface identifies an independent server workspace. Variable manuscripts, styles, pages and saved history belong to that workspace. Account/password/available and reserved image quota belong to account settings. Model endpoints and keys belong to administrator deployment configuration; ordinary accounts have no key-entry flow. The stage remains the ground for the complete page image; saved output colors stay within the image.

STORY: Invitation → register or sign in → choose or create a style → try a small manuscript → create and refine project pages → enter the rehearsal center's ordinary manual player → export PPTX/Markdown delivery or a project source package. Account settings expose password, quota and usage; administrators additionally manage invitations, users, quota and uncertain generation records.

FIRST VIEWPORT: Desktop login pairs a concise product statement with the labeled account form. Mobile stacks the statement and form. After login, the preparation panel reports administrator model readiness and available styles before the project action. The shell identifies saved content as the user's independent workspace and labels settings “账号设置”. This preparation state does not ask a hosted user to configure local model keys.

FORM: Existing sidebar/main-column layout for project, style and account views. Account tables scroll horizontally when needed; the account view narrows and row actions wrap below its local 800px breakpoint. Login also becomes a single column at 800px. The player is a native full-viewport dialog (`100dvh`), with visible header actions and footer page controls. At 700px and below its header and controls wrap, optional notes stack below the complete image, and the keyboard-only hint is hidden while controls remain visible.

## Hosted scope and boundaries

- V1 provides invitation registration, separate account workspaces, styles, image production and editing, ordinary manual presentation, page-image download, PPTX/Markdown delivery and project source-package import/export.
- The ordinary account uses administrator-configured text/image models. Account settings show password, image quota and usage. The administrator panel shows current limits and model readiness; deployment configuration remains the source of model endpoints and keys.
- Successful generated images, including retries and style trials, use image quota. Text analysis uses model budget and request limits without consuming an image count. Editing, ordinary playback, export and history restoration do not consume image quota. Uncertain results remain visibly reserved until administrator review.
- Web V1 offers no new AI narration, dynamic presentation or digital-person production, and hides static/dynamic HTML delivery controls. The complete App retains its existing paths. Imported existing narration/dynamic materials are retained for source-package migration; preserved materials do not imply a new hosted creation or playback feature. Digital-person configuration and complete digital-person videos are outside the current project package.
- A project package is an explicit independent-copy import, not automatic upload of the local App workspace. Ordinary hosted help documents this boundary in `shared/hosted-help.mjs`.

## Ordinary manual player

`src/StandardPresentation.tsx` reads the loaded project and its saved image/scene assets. It does not generate media or dispatch text/image/voice/presenter/motion provider requests. Missing pictures retain a readable manuscript path and a message to return to production.

Previous/next buttons, a named page selector, arrow keys, Page Up/Down and Home/End provide manual navigation. First/last buttons disable at their bounds. “查看讲稿” / “收起讲稿” exposes the current page's saved text with a pressed state; long text preserves whitespace, wraps and scrolls within the pale panel. Optional fullscreen uses the browser API and reports a recoverable status if it fails. A visible “退出放映” action and native dialog Escape handling close playback; the previous focus is restored on unmount. Playback inherits the shared visible focus outline.

The local stage retains complete image proportions through `object-fit: contain`; historical scene viewing remains a fallback. The player title's 18px size and warm error text `#f4c1ae` were detector advisories, not material defects in the finish review. Neither is promoted into a global design rule.

## Evidence and review

Recorded 2026-10-10. All six required captures were inspected and match the TYPE, MATERIAL, GROUND, manual-player and hosted-scope contract:

| Capture | Evidence |
| --- | --- |
| `.impeccable/review/hosted-v1/login-desktop.png` | Desktop statement/form hierarchy and incumbent warm surfaces. |
| `.impeccable/review/hosted-v1/login-mobile.png` | Single-column login with readable labels and form actions. |
| `.impeccable/review/hosted-v1/workspace-desktop.png` | Independent-workspace label, administrator readiness and account-settings navigation. |
| `.impeccable/review/hosted-v1/admin-desktop.png` | Quota, invitation and user management within the incumbent shell. |
| `.impeccable/review/hosted-v1/player-desktop.png` | Complete image on ink stage, pale manuscript panel, exit and page controls. |
| `.impeccable/review/hosted-v1/player-mobile.png` | Wrapped controls, stacked manuscript, complete image and visible focus. |

The independent finish reviewer returned **ship**, with no material fixes. This disposition covers the hosted interface and listed captures. It is not production deployment acceptance or a guarantee of generated image quality.

The captures come from the isolated fixture in `tests/hosted.test.mjs`, using desktop 1440×960 and mobile 390×844 viewports; full-page account captures can be taller than the viewport. The fixture's 100 signup image credits and model concurrency 1 are illustrative. Current code defaults are 20 signup image credits and concurrency 2, both configurable through administrator deployment settings (`server/hosted/{accounts,index}.mjs`). Screenshot values must not become product defaults or public quota promises.

The browser test's assertions cover no horizontal overflow for mobile login/player, missing-picture manuscript navigation, ArrowRight/Home/Escape, hidden hosted HTML delivery controls, no speech/presenter/motion API requests, unchanged provider-call count during playback and no page errors. Screenshots establish rendered interface evidence; provider output quality and a real hosted deployment require their own acceptance.

Sources: `src/Account.tsx`, `src/account.css`, `src/App.tsx`, `src/Workspace.tsx`, `src/ProjectJourney.tsx`, `src/RehearsalCenter.tsx`, `src/OnboardingUI.tsx`, `src/Help.tsx`, `shared/hosted-help.mjs`, `src/StandardPresentation.tsx`, `src/standard-presentation.css`, shared focus/disabled rules in `src/styles.css`, and `tests/hosted.test.mjs`. The additive hosted record in `DESIGN.md` and `.impeccable/design.json` preserves the incumbent identity, global primitives and unrelated historical artifacts.
