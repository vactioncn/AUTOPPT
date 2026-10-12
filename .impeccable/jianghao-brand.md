# 讲好 public brand surface

Established: 2026-10-12. Scope: public marketing, invitation/login, support reading pages and the standalone Mac introduction. Confirmed identity: **讲好 / AI 演讲工作台 / 从一份讲稿，到一次从容的表达。** This is a code-led public identity expansion. The App and authenticated creative workspace retain the Quiet Personal Speech Studio system; their unprefixed DESIGN.md tokens and earlier briefs remain authoritative in that scope.

## Direction contract

- **THESIS:** A manuscript becomes a considered visual speech and a confident delivery.
- **OWN-WORLD:** Warm paper, ink and vermilion; locally hosted Noto Serif SC display type, existing sans body, fine rules and real work. The publishing-studio identity establishes calm through preparation.
- **STORY:** Understand the promise, inspect generated work, prepare a first page and join by invitation. The four actions connect writing, work, narration and delivery.
- **FIRST VIEWPORT:** Hosted marketing places the confirmed two-line promise beside the existing presentation film. The static Mac introduction places it above actual generated covers and the local start action.
- **FORM:** Publishing studio, grounded direction 7, seed `81573e3e`; code-led brand expansion. The emitted contract is in `index.html` and `site/intro/index.template.html`.
- **FINISH:** Scoped source documentation and independent review; review acceptance and asset provenance do not establish production deployment or generated-output quality.

## Implemented visual system

Primitives and public type/component roles live under `public-*` in root `DESIGN.md`; these intentional palette, type-size and corner additions do not change the App defaults. `src/brand.css` follows `src/website.css` and applies the public override within `.web-site`.

The paper ground, light form surface, ink text, vermilion action, muted text, fine rules and reading ground match `docs/讲好-品牌规范.md`. The dark closing section reverses paper and ink. `src/BrandLockup.tsx` uses the square quotation-mark SVG with a real text wordmark and optional separated descriptor. Artwork keeps its saved visual grammar and complete 16:9 proportions.

Headings use `Jianghao Serif`, the local alias for Noto Serif SC: display and section weight 550, wordmark weight 650. The hosted hero is `clamp(36px, 4.25vw, 63px)` with line-height 1.48; the mobile hero is `clamp(30px, 8.4vw, 44px)`/1.55. Lead copy is 17px/1.95 and becomes 15px/1.9 on mobile. Hosted body inherits existing locally bundled DM Sans and Chinese system sans; static intro body uses its existing system sans stack. The standalone serif hero is `clamp(38px, 5.2vw, 72px)`/1.5, then `clamp(29px, 8.4vw, 46px)`/1.55 below 759px.

Hosted principal content has a 1480px maximum width with 5.5% gutters. The hero uses 1:1.03 columns and stacks below 1100px. At 640px gutters become 20px; the four-action row becomes two columns and delivery becomes one. The twelve-page gallery retains four collections with one lead and two companion expressions each; collections stack at 1000px. Accounts and reading pages keep their established layouts and field semantics. The static intro retains its cover hero, local install/source links and independent breakpoints.

Public image corners are 3px, play control 4px and primary action/video stage 5px; account forms keep their existing 16px corners. Fine rules and spacing provide depth; the video action has no shadow. The static page retains its established cover-stack depth. These are deliberate surface choices, not an App-wide radius change.

Hosted links, buttons and summaries show a 2px vermilion focus outline at a 5px offset; inputs show a 2px outline at a 2px offset and matching caret. The hosted skip link is clipped when unfocused and revealed on focus. Hosted primary buttons retain a 44px minimum target; static buttons retain 48px and a 3px focus outline at a 5px offset. Named mobile menus, account-format hints, password visibility, errors, disabled service states, captions and full-image links retain their existing semantics. The hosted branded motion is an 800ms ink-to-vermilion hero phrase; content is visible by default and reduced-motion preferences suppress it. Static reduced-motion behavior remains in its own stylesheet.

## Content, assets and boundaries

Source authority: `src/brand.css`, `src/BrandLockup.tsx`, `src/WebSite.tsx`, `src/website.css`, `public/brand/type.css`, `public/brand/mark.svg`, `site/intro/intro.css` and `docs/讲好-品牌规范.md`.

The original geometric SVG mark uses two quotation shapes. Eight existing variable Noto Serif SC WOFF2 subsets (approximately 600KB) were copied from installed Fontsource v5.3.0 with the SIL OFL 1.1 license in `public/brand/FONT-LICENSE.txt`; they use `font-display: swap`. The existing locally bundled DM Sans remains the hosted body font. No raster artwork or paid generation was added in this brand pass.

The gallery and film reuse checked-in `public/style-showcase/`, `public/showcase/` and `public/product-demo/` material. The film and downloadable PPT keep their actual AutoPPT names and are explicitly identified as real demonstrations made before the rename. Public delivery explains complete-image PPTX pages plus speaker notes, Markdown manuscript and narration-enabled offline HTML; it retains the fact that individual text and graphics in the PPTX are not editable. Digital presenters remain labelled as laboratory work, with hosted availability stated accurately.

There is no confirmed public website address. This delivery is local source and an independently publishable introduction page. Stable repository/package/API identifiers, `/Applications/AutoPPT.app`, its Application Support directory, `.local/`, hosted user workspaces and existing assets remain AutoPPT. Brand documentation does not authorize data migration, application replacement or changes to generation/storage behavior.

## Evidence and review boundary

Visual evidence is under `.impeccable/review/jianghao/`: four viewport sizes plus gallery, delivery, account and static-intro captures. The independent final narrow verdict is **ship**: all three listed findings are resolved—input-focus contrast, a static contract matching its cover hero, and the mobile gallery capture. The unfocused hosted skip-link screenshot artifact was also corrected with clipping while preserving keyboard focus. This verdict is limited to those findings; no whole-static-page craft-floor pass is claimed, and legacy small static captions remain.

Website-specific unit and browser checks passed 11/11. The full suite reported 243 passed, 4 failed and 13 skipped. The same four failures were reproduced on clean HEAD `c12c770` in an isolated baseline checkout: existing presenter, project-area and onboarding selectors. This evidence supports the public brand change within its scope; it does not certify every App workflow, deployment or paid-model output.
