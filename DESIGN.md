---
name: AutoPPT
description: A quiet personal speech studio with generated images first and design rules on demand.
colors:
  accent: "#c94e36"
  accent-hover: "#b7422d"
  navigation-active: "#dfe4d6"
  navigation-ink: "#334731"
  good-surface: "#e9efdf"
  good-ink: "#4c673d"
  warm-surface: "#f9ebd9"
  warm-ink: "#986023"
  canvas: "#f6f5f1"
  paper: "#ffffff"
  sidebar: "#eeeee7"
  ink: "#242824"
  muted: "#696f65"
  supporting-text: "#64705b"
  line: "#e1e3db"
  public-canvas: "#faf7f0"
  public-paper: "#fffdf8"
  public-ink: "#292820"
  public-muted: "#676258"
  public-line: "#ded8cc"
  public-action: "#a83d30"
  public-action-hover: "#8e3027"
  public-reading: "#f0ebe1"
  public-selection: "#e7c5b7"
typography:
  display:
    fontFamily: '"Jianghao Sans", "DM Sans", -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif'
    fontSize: "36px"
    fontWeight: 600
    lineHeight: 1.5
    letterSpacing: "-0.04em"
  headline:
    fontSize: "30px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "-0.025em"
  title:
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "-0.015em"
  body:
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.6
  button:
    fontSize: "13px"
    fontWeight: 500
    lineHeight: 1.5
  label:
    fontSize: "12px"
    fontWeight: 500
  public-display:
    fontFamily: '"Jianghao Sans", "DM Sans", "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: "clamp(36px, 4.1vw, 58px)"
    fontWeight: 600
    lineHeight: 1.36
    letterSpacing: "-0.015em"
  public-headline:
    fontFamily: '"Jianghao Sans", "DM Sans", "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: "clamp(28px, 3vw, 42px)"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "-0.01em"
  public-wordmark:
    fontFamily: '"Jianghao Sans", "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: "32px"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "0.02em"
  public-body:
    fontFamily: '"Jianghao Sans", "DM Sans", -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif'
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.8
  public-lead:
    fontSize: "17px"
    lineHeight: 1.85
  public-button:
    fontSize: "14px"
    fontWeight: 500
    lineHeight: 1.5
  public-caption:
    fontSize: "13px"
    lineHeight: 1.65
  public-descriptor:
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "0.025em"
  public-feature:
    fontSize: "24px"
    fontWeight: 500
    lineHeight: 1.5
  public-section-title:
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.5
  public-faq-title:
    fontSize: "28px"
    fontWeight: 600
    lineHeight: 1.4
  public-mobile-display:
    fontSize: "clamp(32px, 8.7vw, 36px)"
    fontWeight: 600
    lineHeight: 1.45
    letterSpacing: "-0.015em"
  public-narrow-display:
    fontSize: "30px"
    fontWeight: 600
    lineHeight: 1.45
    letterSpacing: "-0.015em"
  public-mobile-wordmark:
    fontSize: "28px"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "0.02em"
  public-intro-display:
    fontFamily: '"Jianghao Sans", "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: "clamp(36px, 5vw, 64px)"
    fontWeight: 600
    lineHeight: 1.36
    letterSpacing: "-0.015em"
  public-intro-lead:
    fontSize: "18px"
    lineHeight: 1.8
rounded:
  badge: "5px"
  icon: "6px"
  control: "8px"
  notice: "10px"
  card: "12px"
  dialog: "16px"
  public-image: "3px"
  public-play: "4px"
  public-control: "5px"
  public-mark: "14px"
spacing:
  small: "8px"
  control: "12px"
  medium: "16px"
  section: "24px"
  large: "32px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.paper}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "9px 16px"
  button-secondary:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "9px 16px"
  button-ghost:
    textColor: "{colors.muted}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "9px 10px"
  button-danger:
    backgroundColor: "#f9e4df"
    textColor: "#a93625"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "9px 16px"
  input:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "11px 12px"
  navigation:
    backgroundColor: "{colors.navigation-active}"
    textColor: "{colors.navigation-ink}"
    rounded: "{rounded.control}"
    padding: "12px 14px"
  status:
    backgroundColor: "#eeefe9"
    textColor: "#67745c"
    rounded: "{rounded.badge}"
    padding: "3px 7px"
  project-card:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
  slide-preview:
    backgroundColor: "{colors.paper}"
    rounded: "9px"
  segmented:
    backgroundColor: "#e9ece1"
    rounded: "{rounded.control}"
    padding: "4px"
  studio-disclosure:
    textColor: "{colors.ink}"
    padding: "18px 0"
  public-button-primary:
    backgroundColor: "{colors.public-action}"
    textColor: "{colors.public-paper}"
    typography: "{typography.public-button}"
    rounded: "{rounded.public-control}"
    padding: "11px 20px"
  public-button-primary-hover:
    backgroundColor: "{colors.public-action-hover}"
    textColor: "{colors.public-paper}"
    rounded: "{rounded.public-control}"
  public-button-inverse:
    backgroundColor: "{colors.public-paper}"
    textColor: "{colors.public-ink}"
    typography: "{typography.public-button}"
    rounded: "{rounded.public-control}"
    padding: "11px 20px"
  public-media:
    backgroundColor: "{colors.public-ink}"
    rounded: "{rounded.public-control}"
  public-mark:
    backgroundColor: "{colors.public-action}"
    textColor: "{colors.public-canvas}"
    rounded: "{rounded.public-mark}"
    size: "64px"
---

# Design System: AutoPPT

## Overview

**Creative North Star: "Quiet Personal Speech Studio"**

The interface is a warm, restrained working environment for a person developing an ongoing speech. Pale paper surfaces, olive supporting tones and a terracotta action color keep attention on the manuscript and the actual generated image. The style workbench pairs the complete image with a focused tabbed editor; native disclosures reveal optional settings and generation evidence when needed.

This records the implemented system in `src/styles.css`, `src/studio.css`, `src/scene.css`, the shared components and main views, refreshed on 2026-10-01. The selected style is a whole visual grammar: typography, palette, linework, details and whitespace. Content determines the original composition and expression; style determines how it is drawn. The application palette does not become the output style. Content attachments and the production report extend the existing quiet working surfaces, shared buttons and modal conventions. Product behavior remains documented in `PRODUCT.md`.

**Key Characteristics:**

- Warm light canvas with white working surfaces and fine olive-gray borders.
- Large, complete generated images paired with quiet saved-state captions and PNG download.
- Compact persistent navigation; content and feedback beneath the image, with design rules and history available on demand.
- Explicit progress, saved state, incomplete work and recovery actions.

The 2026-10-11 invitation-hosted website and workspace journey extended this identity with incumbent type, warm canvas, white forms, terracotta actions and olive selection states. Its historical source and review boundary remain recorded in `.impeccable/web-site-journey.md`; its public-brand measurements below describe that earlier snapshot. The authenticated workspace navigation continues to use the studio identity.

**Public Brand — 2026-10-12: "Publishing Studio"**

The confirmed public identity is **讲好 · AI 演讲工作台 · 从一份讲稿，到一次从容的表达。** Marketing, invitation/login, support reading pages and the standalone Mac introduction use warm paper, ink and vermilion, locally hosted Noto Sans SC type, fine rules and actual work as proof. The `public-*` tokens are intentional additions scoped to those surfaces; unprefixed tokens remain the App/workspace system. Brand geometry and the larger type scale are not App drift. Current source authority and implementation boundaries are recorded in `.impeccable/jianghao-brand.md` and `docs/讲好-品牌规范.md`.

The current source also unifies the product display name, workbench headers, menus and shared mark as 讲好. App and workspace body text now use `Jianghao Sans` with DM Sans and system fallbacks; their established studio palette, layout, type sizes and control dimensions remain. The installed `/Applications/AutoPPT.app` has not been replaced or restarted by this source update. Its filename, data paths and project-package identifiers remain AutoPPT.

The local “编辑文字与动效” surface extends this same working identity: a complete slide canvas with direct text editing, compact labeled controls and explicit save state. Its authored text and background keep the presentation’s own style. This is a scoped source-workbench extension; implementation and validation boundaries remain in `.impeccable/layered-speech.md`, `docs/分层演讲-制作与编辑试用.md` and `docs/分层演讲-画布编辑与动效编排.md`.

## Colors

### Primary

Terracotta (`accent`) marks primary actions, selected pages and selected style choices. Its darker companion supplies the primary button hover state.

### Secondary

Pale olive and dark olive (`navigation-active`, `navigation-ink`) identify the current navigation destination. Green status colors indicate readiness or configured state; amber status colors indicate pending attention. Status meaning also appears in words and, where used, an icon.

### Neutral

Warm canvas, white paper and the slightly darker sidebar create the main surface hierarchy. Ink carries primary content; muted text supports secondary content. The final stylesheet uses `supporting-text` across most captions, hints and metadata. Fine `line` borders separate working areas without making every region a card.

**The Content Palette Rule.** Keep saved slide-style colors and source-image colors inside their preview surfaces; the surrounding controls retain the application palette.

The earlier hosted website reused the canvas, paper, ink, muted, line and accent colors above. Its public style selector used olive navigation fill and ink, with a local selected stroke (`#b3bca8`) and pale olive hover surface (`#e9ece1`). The hosted workspace sidebar retains the sidebar tone, with local quiet navigation text (`#586250`), recent-project text (`#59624f`), hover fill (`#e4e6dc`) and account separator (`#d6dacf`). These supporting component values do not replace the shared palette. Public demo covers retain their own saved visual grammars inside the complete image frame.

The current public brand uses `public-action` for the quotation mark, primary actions and the promise's key phrase; `public-action-hover` supplies the deeper hover. `public-canvas`, `public-paper` and `public-reading` provide warm paper, form and reading grounds. `public-ink`, `public-muted` and `public-line` establish content, supporting copy and fine rules; `public-selection` gives selected text a warm tint. The dark closing section reverses paper and ink. These public colors do not recolor saved artwork or authenticated workspace controls.

## Typography

App and authenticated-workspace roles now inherit the root `Jianghao Sans` stack, with locally bundled DM Sans at weights 400, 500, 600 and 700 and Chinese system fallbacks. This family change keeps the established working-interface type scale, line spacing and control dimensions. Dynamic characters outside the bundled subsets use the declared fallback faces.

The frontmatter records the base hierarchy. Home display type varies with viewport; general page headings use local sizes around the headline role. Section and card titles step down to compact supporting labels. Page numbers and batch counts use tabular numerals where alignment matters.

Generated image typography follows the saved style and design plan; it does not inherit the interface heading scale. Long manuscript passages preserve whitespace. Manuscript rows have a comfortable reading measure (75ch maximum) and open line spacing (2.1); the note editor uses similar spacing (2.05). Small interface hints are compact, including some mobile labels (9–11px); this describes the current implementation, not a general minimum-size recommendation.

### Public Brand Type — 2026-10-12

Public type uses `Jianghao Sans`, the local alias for Noto Sans SC Variable. Display and section headings use weight 600; the shared 讲好 wordmark uses weight 700 with slightly open tracking. The frontmatter records the hosted hero, section heading, wordmark, body, lead and compact metadata roles. Ordinary public body copy is 16px/1.8, with 17px/1.85 hero support and 13px/1.65 captions; dense navigation, form and descriptor roles retain their documented compact sizes. Invitation and reading headings use the same face while retaining their existing surface sizes. Fifteen variable WOFF2 character chunks (about 875 KiB total) are limited to characters present in public copy, use `font-display: swap` and weights 100–900, and include the original OFL license. Unavailable dynamic characters fall back to Chinese system sans. The hosted stack keeps DM Sans as a fallback; the static introduction shares the local face with its system sans fallbacks. No remote font service is required.

At 1100px and below the hosted hero becomes `clamp(36px, 5.5vw, 58px)`. At 640px and below it uses `public-mobile-display` (32–36px/1.45), lead copy becomes 16px/1.8 and section headings 28px. The standalone hero uses `public-intro-display`, then the same `public-mobile-display` role below 759px. Both shared wordmarks use the 28px mobile role. The small legacy static captions remain current implementation detail, not a new minimum-size rule or a claimed craft-floor pass.

At 360px and below, hosted and static hero headings use `public-narrow-display` (30px) and keep “从容的表达。” together with `white-space: nowrap` on that phrase. This resolves the reviewed 320px title wrap; the 390px-and-wider type scale is unchanged.

### Hosted Website and Navigation Type — 2026-10-11 Snapshot

The public website inherits DM Sans and the Chinese system fallbacks. Its hero uses fluid display type (`clamp(34px, 4.3vw, 62px)`, weight 600, line-height 1.22, tracking -0.035em); at 900px and below it uses `clamp(36px, 6.5vw, 54px)`. Account-entry headings use `clamp(30px, 3.4vw, 46px)` with the same weight, line-height and tracking, then a fixed 31px at 640px and below. Website section headings use `clamp(25px, 2.8vw, 40px)`, line-height 1.35 and tracking -0.03em. The account form title is 25px; reading-page titles use `clamp(30px, 4vw, 45px)` and reading-section headings use 23px. These values are scoped exceptions, rather than replacements for the base interface roles.

Website lead copy is 18px with line-height 1.9 and a 34ch measure; it becomes 16px on narrow screens and gains a 50ch measure at the 900px breakpoint. Workflow and account-story copy use 16px; workflow titles use 19px; FAQ summaries use 17px. The wordmark is 23px/700, with a 25px letter inside its mark. Website action buttons are 14px. Named fields retain the shared 13px input text, 12px label and 10px helper; the direct password row inherits 14px text. The form does not establish a new global field scale. Hosted navigation uses 12px recent/support labels and 11px counts; its mobile brand is 18px.

## Layout

The desktop shell uses a sticky full-height sidebar (222px) and a flexible main column. The main page is centered within a maximum width (1500px), with normal page padding (38px 44px 40px). Settings use a narrower maximum width (1100px). Borders and spacing divide page headings, project controls, the gallery and the manuscript composer.

Project and style libraries use three columns; page previews use two larger columns. The current-batch gallery, all-pages view and manuscript view share a segmented switch. The composer follows the gallery, while submitted source text is available in a disclosure. Page detail places the complete image and redesign controls beside tabbed notes, design and versions (1.65:1 columns with a 280px minimum information panel).

The style workbench places the complete 16:9 preview, a compact save action, and a horizontal trial-history strip (150px thumbnails) in a flexible left column. A 320–380px right editor uses two tabs for manuscript and result adjustments. Full rules and saved versions live inside a closed advanced disclosure in the manuscript tab. Its body scrolls independently while the generation action stays visible in its footer. Optional audience/palette settings, reference-independent cover generation, and saved generation evidence use disclosures. Tabs keep draft fields mounted; changing tabs never starts generation. At 960px and below, the editor comes before the preview in a single column; its action footer sticks above the mobile navigation.

Style details lead with an explicit saved state. Industry, audience, use case, and content topic belong to project creation and the project’s saved content preferences, rather than reusable style configuration. Reference-based refinement offers only visual requests; its draft is stored locally per style and is applied only by an explicit re-extraction action. Without reference images, the inapplicable refinement form is absent. Full rules, analysis records, versions, and page-number guidance remain accessible under a closed “高级设置” disclosure. Trial content preferences stay in the trial draft and are never promoted as style rules. The optional content-led composition stage is retired: new generation uses the saved visual rules directly, and legacy art-direction records remain read-only evidence.

Content attachments form a two-column grid beneath the page-redesign feedback, with complete thumbnails (110px high) and a visible filename and remove control. The production report uses the existing wide modal: four metrics across the top, followed by a comparison summary, any first difference and an expandable page list. At the mobile breakpoint (600px), metrics become two columns and page rows omit the secondary image-status label; attachment thumbnails remain in two columns.

The digital-presenter settings pair a saved-avatar library (240px) with a flexible workbench, separated by an open gap (28px). Identity editing and text preview follow the same border-and-spacing hierarchy as the existing studio. At its local narrow breakpoint (at most 700px), the library moves above the workbench and retains two avatar columns; identity fields stack beneath the portrait, and action rows wrap. This layout applies to the presenter settings, without changing the shell's existing breakpoints.

| Viewport        | Implemented behavior                                                                                                                                                                            |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| At least 1600px | Wider page padding (44px 60px), larger home display (42px), larger gallery gaps.                                                                                                                |
| At most 1150px  | Sidebar narrows to 192px; project/style libraries become two columns; workflow becomes two columns; toolbars wrap; page detail narrows to 1.4:1 columns with a 260px minimum information panel. |
| At most 850px   | Sidebar becomes a 76px icon rail; recent projects are hidden; page detail stacks vertically; versions use two columns.                                                                          |
| At most 960px   | The style workbench stacks with the editor first; the footer action remains accessible and history scrolls horizontally.                                                                        |
| At most 600px   | Navigation becomes a fixed bottom bar (62px); page padding is 24px 18px 28px; libraries and slide galleries become one column; settings, split preview and style detail stack.                  |

On mobile, bulk actions and toasts sit above the bottom navigation. The home illustration is hidden, page selection controls stay visible, and the style chooser retains two columns. Dialogs remain scrollable within the viewport.

**The Preview First Rule.** Preserve the complete generated image and reveal secondary controls through detail views and disclosures as space contracts.

### Layered Presentation Trial

The local motion workbench uses a wide dialog, with a page rail, flexible complete preview and compact inspector. The desktop grid uses 120px / flexible / 250px columns; at 1500px and above the side columns become 130px and 275px. Inspector height is bounded by the viewport (`min(730px, calc(100dvh - 295px))`). Its white fields sit on a warm opaque surface, divided from save actions by a fine rule. At desktop widths of at least 1000px and heights at most 800px, the preview scales down proportionally to keep nearby controls within reach.

At 950px and below the inspector moves beneath the preview and releases its height constraint. At 600px and below the workbench stacks, the page rail becomes a horizontal sequence, and toolbar actions wrap. These are local editing-surface breakpoints, not replacements for the App shell’s breakpoints.

**The Bounded Edit Loop Rule.** Keep saved-page and deck playback in the top toolbar, draft audition and one-step undo beside the canvas, and save/draft-discard/saved-undo in an opaque, non-scrolling inspector footer. On desktop, only the field body scrolls; the two inspector mode buttons and layer selector stay above it. On narrow screens, release the inspector height and let fields follow the preview in normal document flow.

### Public Brand Layout — 2026-10-12

The hosted header and principal content share a 1480px maximum width and 5.5% side padding. The hero pairs promise and real video in 1:1.03 columns, with padding 96px/88px and a 5.5% gap; below 1100px it stacks with a 40px gap. At 640px the header is at least 80px, gutters become 20px, the hero uses 48px/44px padding and a 34px gap, and principal sections use 58px vertical padding.

The four-action row uses four columns, then two at 640px; delivery uses three columns, then one. The twelve-page gallery retains two collections per desktop row and stacks at 1000px, with each lead page and two companions kept complete in 16:9 frames. Account entry, support reading geometry and authenticated workspace geometry remain those of the existing journey. The standalone Mac introduction retains its centered cover hero, local installation/source links and independent layout; its body container remains at most 1120px with 40px desktop gutters.

### Hosted Website and Workspace Layout — 2026-10-11 Snapshot

The following public geometry is retained as historical context. The current public-brand layout is specified above; authenticated workspace geometry remains applicable.

The public website uses an open, ruled layout. Header, hero and footer share a centered maximum width (1440px) and desktop side padding (5%). The header is at least 88px high. The hero uses 0.85:1.15 columns with a 5% gap and vertical padding (82px 88px); its complete example image keeps a 16:9 frame. Workflow content uses a narrower maximum width (1296px), 1:1.15 columns and a 10% gap. The proof section reverses the visual balance to 1.15:1 columns on the sidebar-colored ground. FAQ content is limited to 900px; reading pages to 850px, with body text no wider than 72ch.

Account entry is centered within 1190px, with 1.1:1 columns, a 10% gap and padding (60px 5% 80px). Its white form uses 30px internal padding, an 18px gap between main blocks and a 16px fieldset gap. At the narrow breakpoint the story remains above the form, its supporting list is hidden and the form remains full width with 22px internal padding.

| Hosted surface breakpoint      | Implemented behavior                                                                                                                                                                                                                                             |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Website at most 900px          | Hero and proof sections stack; hero top padding becomes 48px with a 38px gap. Workflow retains two columns with a 7% gap. Account entry retains two columns with a 5% gap and 4% side padding.                                                                   |
| Website at most 640px          | Header becomes at least 72px high with 16px 20px padding and a disclosure menu. Hero uses 42px 20px 50px padding; workflow stacks with 45px 24px padding. Account entry stacks with 28px 20px 45px padding and a 26px gap. Footer stacks and style choices wrap. |
| Hosted workspace above 950px   | Sticky full-height sidebar is 232px, with a flexible main column; creation, primary destinations, recent projects and bottom support/account groups remain visible.                                                                                              |
| Hosted workspace 641–950px     | Sidebar becomes a 76px icon rail with named/title-bearing controls, a separate compact account icon and hidden recent projects.                                                                                                                                  |
| Hosted workspace at most 640px | A sticky 56px top bar opens a closable, fixed drawer (`min(300px, 88vw)`, 100dvh). The hosted shell has no bottom navigation padding; its internal top bar is 49px high. Drawer bottom padding respects the safe area.                                           |

These hosted values supersede the earlier Hosted Web V1 entry-form and shell geometry only for the new website journey. The local App keeps its own 600px/850px/1150px shell breakpoints. CSS breakpoints are independent of screenshot pixel dimensions and browser zoom.

## Elevation & Depth

Most surfaces are flat, separated by pale tones and one-pixel borders. Project cards lift slightly on hover (3px); they do not acquire a shadow. Soft shadows are reserved for the illustrative paper stack, the selected segmented option, floating bulk actions, toasts and modal dialogs. Their exact values live in the sidecar.

Dialogs use a dim translucent backdrop with a small blur (3px). The modal is the strongest elevation; normal library cards remain quieter.

Motion is brief and functional: button and project-card transitions (0.18s), page border and reveal transitions (0.15s), task progress (0.3s), and a continuous loading spinner (1.2s). Reduced-motion preferences collapse animations and transitions to near-zero duration.

The earlier hosted website stayed flat: borders, spacing and the proof section's pale olive ground separated content, without added card or hero shadows. The workspace drawer uses a translucent ink backdrop (`#24282466`) below the drawer. Current public pages retain flat, ruled surfaces and a shadow-free video action. The hero's key phrase changes from ink to vermilion over 800ms (`cubic-bezier(0.16, 1, 0.3, 1)`) only when reduced motion is not requested. The Amanda example can slide into view when its section approaches the viewport, with a click-to-reveal alternative; revealing never starts audio. Shared functional state transitions remain; the standalone intro retains its existing cover-stack depth and reduced-motion treatment.

## Shapes

Controls have gently rounded corners; cards and composers use the larger card radius; dialogs use the broadest radius. The frontmatter carries the recurring sizes. Fine borders supply definition, dashed borders identify add/upload areas, and circular shapes are limited to small indicators, color swatches and numbered workflow markers.

Project page previews use a landscape frame (16:9), with images kept complete through `object-fit: contain`. The large trial image preserves its natural proportions. Historical web scenes remain viewable as scalable SVG. Project covers remain uncropped; source images may use `object-fit: cover` in the style library’s contact-sheet thumbnails.

Trial history uses a solid terracotta outline for the selected result. No scene-selection marker or element-editing controls appear in the current image workflow.

In the earlier hosted website snapshot, complete example and proof images used the existing card corner (12px) and style-switch controls retained control corners (8px). Current public artwork frames use `public-image`; the video stage and primary actions use `public-control`, while its play action uses `public-play`. The quotation mark uses `public-mark` within its intrinsic square SVG. Account forms retain the broad dialog corner (16px) and a fine line border. Workspace primary/support controls keep 8px corners; recent-project rows keep a local 7px corner, and the account footer remains a flat separator row. Public corners are scoped identity choices.

## Components

### Buttons

Primary, secondary, ghost and danger variants share compact type, centered icon/text alignment and a minimum height (40px). Primary actions are terracotta; secondary actions are white with a fine border; ghost actions are quiet until hover; danger actions use a pale red treatment. Loading adds a spinner and disables the button. Disabled buttons reduce opacity (0.5). Buttons and links have a visible terracotta focus outline (3px, offset 3px).

### Inputs / Fields

Fields pair a visible label with white bordered inputs and optional help text. Ordinary inputs and textareas show a warm focus outline (2px, offset 1px). The manuscript composer is an implemented exception: its textarea is borderless and suppresses the outline inside the containing panel. Do not describe it as having a focus ring that does not exist. Multiline fields preserve roomy line spacing and vertical resizing.

### Navigation

The main navigation combines Phosphor icons, concise labels and optional counts. Active desktop items gain pale olive fill and darker text. The icon rail hides visible labels at the intermediate breakpoint; the mobile bottom bar restores compact labels beneath icons. Model settings remain a separate navigation destination.

### Chips / Status

Small rounded badges communicate neutral, good and warm states. They are informational labels, not filters. Ready badges may include a checkmark. Configuration labels say what is configured; a successful model-list connection is not presented as completed page-generation proof.

### Cards / Containers

Project cards combine a 16:9 cover, name and compact metadata. Style cards add reference or starting-style labels, description and color swatches. Their previews may show a reference image or a typography/color sample; built-in choices are labeled “内置起始风格”. White composer and connection panels use the same border and radius language.

Project-card deletion uses a 36px icon-only control at the top right, revealed on card hover or focus within for mouse users. Coarse-pointer devices retain a visible 44px target. The accessible name and hover label identify the action; deletion still opens the existing confirmation dialog. These rules are scoped to project cards.

### Digital Presenter

Settings uses three underline tabs: model services, speech and voices, and labs. Only the selected panel is visible; visited panels retain unsaved inputs. Configured service editors start collapsed beneath a compact saved-model and endpoint summary. Saving is explicit and scoped to that connection. Speech leads with the default voice and places capture behind its existing disclosure; leaving the speech panel stops microphone capture, and hidden-panel media is paused. Keyboard arrows, Home and End select tabs; hash routes reopen the selected category.

Digital presenters live in the labs panel with an experimental label and a short statement that quality and waiting time are still being improved. Rehearsal offers self and AI narration as the regular choices; the digital option is inside an experimental disclosure. New projects default to self, while saved rehearsal choices and legacy avatar setups are preserved. The laboratory resource dialog returns to rehearsal without resetting project choices or deleting media.

Saved-avatar choices use compact square portraits beside the name, style, default marker and MiniMax voice-readiness text. A selected choice gains a terracotta border and pale warm fill, with a pressed state. The surrounding fields, status badges and actions reuse the existing paper, ink and control language. Presenter actions allow wrapped labels and a comfortable minimum height (44px), scoped to this workflow.

Native disclosures make readiness determine the initial hierarchy: a saved connection and a ready identity are collapsed, while incomplete configuration remains open. “文字试播” stays visible beneath identity editing; unsaved edits carry an explicit message and disable preview generation. Uploading a portrait and creating another style remain within the settings workbench. The style-generation confirmation states the upload and cost, and explains that the new identity is saved separately while the original remains.

**The Presenter Voice Provenance Rule.** “MiniMax 声音” uses the same configured voice list as AI narration, including collected personal voices and MiniMax announcers. A portrait does not identify a voice. Text preview and page-note generation first synthesize audio with the selected saved MiniMax voice, then send that audio and portrait to HeyGen to synchronize the mouth. The selector, readiness text, preview hint and confirmation name this source. New generation never substitutes a HeyGen platform voice.

In a project, a saved-avatar selector and thumbnail lead directly to the page choice and “生成本页讲解” / “生成整场讲解” actions. Position, size and the optional existing-audio source remain in “显示位置与其他方式”. The primary path uses page notes with the saved MiniMax voice. “沿用已有 AI 口播” sends the selected original narration audio directly to HeyGen without selecting another voice or synthesizing it again; the primary description changes to “沿用所选 AI 口播的原声音，再同步头像嘴型。”, and an unselected narration shows “待选择口播”. Generation confirmations show the chosen identity, voice source, scope and text excerpt, followed by the upload and cost explanation and explicit confirmation action. The MiniMax path describes both services; the existing-audio path explains that the voice remains the original audio.

Preview and project generation share quiet records separated by fine borders. Each record pairs identity, scope and timestamp with a written status; its voice line distinguishes “MiniMax · [voice]”, “沿用原口播声音” and preserved “旧版 HeyGen 配音 · [voice]” history. Active work adds progress, and available clips expose playback, including a clearly labeled completed portion. Changed pages or identity make the previous result's incompatibility explicit. Continuing a task uses a confirmation explaining which work is queried or downloaded and which remaining work may be billed; saved audio is reused during query or download recovery. Video occupies a dark media surface; project playback places it over the page in a wide dialog with segment navigation, continuous play, speed and readable script below. The media surface is local to playback and does not establish a new application palette.

### Page Preview and Detail

Page frames show the complete generated image, with historical web scenes preserved for viewing and labeled as historical. Missing results display a text-and-icon placeholder with separate waiting, generating and incomplete messages. Selection appears as a terracotta outline, with bulk actions in a floating dark olive bar. Opening a page reveals the large preview, PNG download, navigation, manual splitting and redesign controls, plus separate tabs for manuscript, design and versions. The redesign form uses the whole saved style without a template or visual-direction selector. When a content brief is available, the design tab shows “这一页要表达什么” and “为什么这样表现” before the detailed plan. Saved notes and a page awaiting redesign remain distinct states; version restoration is an explicit action.

The current workflow produces images and exposes single-image download and project PPTX export. The workspace header has an “导出 PPT” action. Its dialog explains that each page is one complete image with the latest saved manuscript in speaker notes, preserving page order and image proportions. Missing pages, unsegmented batches and active jobs block download with an explanation. Changed manuscripts show an explicit current-image/latest-notes download label. Historical scenes flatten into a single PNG for export. Element editing remains outside this ordinary image workflow; the separate local layered trial is described below.

### Layered Presentation Trial

“编辑文字与动效” opens an independent local presentation record. The editor reuses the shared buttons, labeled white fields, fine borders and warm working surfaces. A darker local terracotta marks selected pages, disclosure headings, inspector focus and canvas selection outlines/handles; the canvas caret inherits the authored text color. This supporting treatment does not recolor the authored slide or replace the global action color. Interface text retains the working type ramp; slide fonts, sizes, colors and spacing belong to the presentation.

Click the actual main text to type, select, insert line breaks or paste plain text in place. Input echoes retain the focused node and caret; composition guards defer external updates during IME input. Named SVG handles move the layer or resize its text area, with scale-compensated targets kept inside the canvas edges. Handle arrow keys adjust one canvas unit, or ten with Shift. Moving or resizing changes geometry while preserving the chosen font size and natural glyph shapes. Artistic lettering already in the background remains artwork.

“文字排版” and “页面动效” are two labeled buttons with explicit pressed state. The former exposes built-in font, supported weight, size, color and tracking; geometry and speaking step remain in “位置与出场顺序”, with individual effect, delay and duration available for “原有编排”. The latter exposes page choreography and “自然出场”, “逐步讲述 · 点击下一步” or “整页静态”. “试播动效” beside the canvas auditions the current draft and returns it to editable geometry when stopped or finished. Saved-page and full-deck playback remain in the top toolbar and are disabled while edits are unsaved.

**The Natural Text Rule.** Preserve natural glyph shapes and the explicitly chosen font size. For layered text, wait for font/layout checks and block saving on overflow; explain the correction beside the save action instead of silently shrinking or stretching text.

**The Authored Layer Motion Rule.** Choose motion from the content and existing layer relationships. The six page choreographies—“叙事镜头”, “金句聚焦”, “章节开场”, “阅读节奏”, “两侧对话” and “层层推进”—use semantic groups, largest text, actual left/right position or speaking steps; “原有编排” preserves custom layer effects. These adapt suitable expressions from the 24-expression reference without creating their structural components, inventing data or changing saved geometry.

The six choreographies use finite transform/opacity entrances (650–950ms, `cubic-bezier(.16,1,.3,1)`) with total stagger delay capped at 1.4s. Focus briefly adds at most 3px blur; story and chapter can settle the background over 1.2s. Replay, stepping backward, page changes and edits cancel transient animations. Final layout is the saved layout. Reduced motion uses 120ms fades without spatial movement, blur, background zoom or stagger; whole-page mode skips entrances.

The canvas’s “撤销一步” and its undo/redo shortcuts restore local layer edits. The stable footer separately holds explicit save, overflow/status text, “撤销修改” for unsaved changes, or “撤销上次保存” when available. Saving checks the record revision; typing and audition do not persist changes or call a model. The managed player’s “暂停改字” pauses playback and opens the matching editor page. Saving refreshes that player without discarding the current page or speaking step; the speaker chooses when to continue. Status copy distinguishes screen text from the manuscript and existing narration. Offline playback has no workbench-edit action.

The five-style trial reuses existing artwork in a fresh isolated workspace; the full generation path is mock-tested. Browser evidence covers direct replacement/continued typing, line-break overflow blocking, keyboard move/resize, local undo, save/saved undo, audition and desktop/mobile layouts. Real pointer movement at the top edge, resizing at the bottom edge and undo were checked in a standalone preview using the same canvas editor; embedded-iframe pointer automation remains limited. Physical IME candidate UI, the OS reduced-motion switch, device frame rates and native/cross-system PowerPoint opening remain unverified. This source-workbench record does not imply a new live-model run, installed-App replacement or migration of existing projects; detailed evidence belongs in the linked trial documentation.

### Content Attachments

The page-redesign form places “内容附件” below feedback and above the primary redesign action. A quiet count (“0 / 4” through “4 / 4”), shared “添加图片” button and format hint support optional selection of 1–4 chart, product or screenshot images (PNG, JPG or WebP, at most 12 MB each). White bordered thumbnail surfaces use the existing control radius and `object-fit: contain`; filenames are numbered, truncate visually with the full name available on hover, and accompany a named remove button. Selecting a thumbnail opens the original material. Uploading and generation states disable conflicting actions; inline errors retain the selection for correction or retry.

**The Content Attachment Rule.** Content images are materials to incorporate into the page, distinct from style references. The form states that clicking “重新设计这页” sends the selected actual images to both the design and image-generation steps. The design tab exposes each image’s intended role, placement and preservation requirements; generation uses multi-image editing. Without content attachments, generation remains text-only. Style-reference images never enter production requests. Leaving or changing pages with unsubmitted notes or attachment choices opens the shared React modal with “留在此页” and “放弃修改并离开”; selection alone does not apply changes to the page.

### Production Report

“报告” sits beside “导出 PPT” in the workspace header and opens “制作报告” in the shared wide modal. Four open metric columns lead with “原文”, “页面”, “页面备注” and “演说稿”; large tabular numerals (30px) are paired with small units and explanatory captions. The summary reuses the existing green ready and amber attention treatments, always with an explicit text result. Loading, read failure and “重新读取” are visible states.

**The Report Integrity Rule.** Raw submitted text includes headings; the comparison separately identifies the spoken body after Markdown headings are removed. It checks actual body text against current page notes in page order, ignoring whitespace but preserving punctuation. Equal character counts alone do not mean the text matches. The report shows the first differing character and both contexts, with a page-jump action when that position maps to a page. Unsubmitted drafts, unsegmented batches and changed notes awaiting a new image remain explicit. The speech manuscript is assembled from those same notes, so their equal counts are not an independent completeness check.

An expandable, scrollable page list shows page number, title, note count and image readiness; selecting a row opens the page. “下载报告” saves the displayed counts, comparison and page details as a text file. Interface evidence is recorded in `.impeccable/review/attachments-desktop.png`, `attachments-user.png`, `attachments-mobile.png`, `report-desktop.png`, `report-user.png` and `report-mobile.png`. Scope review passed the interface and integration; automated tests verify actual image-byte transfer and text comparison. Real paid-model attachment fusion quality remains unverified.

### Segmented Controls and Dialogs

The gallery switch uses a pale olive track and a white active option. Detail tabs use an underline instead. Native dialogs open with `showModal()`, support Escape and a close button, and close when the user clicks outside their bounds; dirty manuscript or attachment edits prompt through the shared modal before leaving. Split and merge proposals are visibly previewed before generation.

### Hosted Web V1

The hosted working surface extends the incumbent studio in Operate mode. Invitation login pairs a concise statement with a labeled white form on warm paper; at its local 800px breakpoint the two columns stack. Project, style and account views retain the shared shell, typography, terracotta actions and olive navigation. Hosted navigation says “账号设置”, and the top bar identifies content as saved in the user's independent workspace. Model-readiness guidance names the administrator configuration rather than sending ordinary accounts to local key fields.

**The Hosted Surface Boundary Rule.** In hosted V1, variable manuscripts, styles, pages and history belong to the workspace; password, quota and usage belong to account settings; model endpoints and keys belong to administrator deployment configuration. The hosted creation surface provides image production and ordinary manual presentation. New AI narration, dynamic presentation and digital-person production remain outside this surface, while the complete App keeps its existing paths.

Account settings lead with available and reserved image quota, a written explanation, logout and a native password disclosure. The administrator panel adds invitation/user/quota management and review of uncertain generation records inside a white bordered container. Tables can scroll horizontally and account-row actions wrap on narrow screens. Ready, reserved, incomplete and uncertain results retain explicit words; model readiness is not generation proof. Image-generation confirmations name administrator-provided quota. Fixture counts in review images are illustrative, not default quota promises.

The ordinary player in `src/StandardPresentation.tsx` uses a native full-viewport dialog with the incumbent ink as a dark picture stage. It preserves the complete saved image with `object-fit: contain` and offers a pale sidebar-colored manuscript panel. Its 18px/500 project title, 20px page heading, 44px controls and warm fullscreen-error text are scoped component values. Previous/next buttons, a named page selector, keyboard navigation, optional fullscreen, a pressed-state manuscript toggle and visible exit remain available. Native Escape handling closes playback and the previous focus is restored; buttons inherit the shared focus treatment. Below 700px the header/actions wrap and optional notes stack under the image without hiding exit or page controls. Playback reads saved project assets and dispatches no provider requests.

Hosted V1 offers image download, PPTX/Markdown delivery and project source-package migration; its delivery surface hides static/dynamic HTML controls. Existing narration and dynamic materials in an imported package are preserved for migration without implying new hosted creation. The hosted help uses `shared/hosted-help.mjs` for invitation, quota, ordinary playback and migration guidance. This scope does not revise the local presenter or output-style rules above.

The surface contract and source trace are `.impeccable/hosted-web-v1.md`. Six login/workspace/admin/player desktop/mobile captures in `.impeccable/review/hosted-v1/` match its type, material, ground and manual-player contract; the independent finish review returned ship with no material fixes. This is interface evidence, not production deployment or generated-image-quality acceptance. The fixture shows 100 signup credits and concurrency 1; current configurable code defaults are 20 and 2. Global tokens, the North Star and unrelated historical records are preserved.

### Public Brand Implementation — 2026-10-12

`src/brand.css` loads after `src/website.css` and scopes the public identity to `.web-site`; `src/BrandLockup.tsx` combines a 40px quotation mark, real sans wordmark and optional descriptor; the shared lockup carries this face into the product without changing the global working-interface type scale.

Four ruled actions connect writing, the existing twelve-page gallery, narration and delivery. Account form behavior and workspace return semantics remain those of the existing journey, with scoped palette and heading changes.

The gallery presents complete artwork without the former enlargement prompt or image-opening interaction. `src/NarrationExample.tsx` adds 《朝花夕拾》 page 4, “先讲故事”, with the original 36.816625-second Amanda AI recording and an illustrative girl avatar. Its reveal loads the case description; a separate explicit play action starts sound. Named pause, progress and retry controls retain the original recording. The source page and audio are read-only publication copies; the original project and manuscript remain intact.

Hosted public primary buttons use the prefixed component tokens; 44px is their minimum height. On the ink closing section the action reverses to paper and ink. Hosted links, buttons and summaries use a 2px vermilion focus outline with a 5px offset; input focus uses 2px with a 2px offset and a matching caret. The skip link is clipped while unfocused and fully revealed on focus. Existing menu disclosure, captioned video, complete image frames and error recovery remain available.

The static Mac introduction carries the same public palette, quotation mark, sans hero and 5px actions through `site/intro/intro.css`, with its centered cover hero, local installation/source links and existing layout. It does not become the hosted invitation homepage. The direction contract is embedded in `index.html` and `site/intro/index.template.html`: publishing studio, grounded direction 7, seed `81573e3e`, code-led expansion. Asset provenance, validation and the limited review verdict belong to `.impeccable/jianghao-brand.md`.

Public six-page product media now uses `public/product-demo/jianghao-introduction.mp4` and `public/product-demo/讲好-产品介绍.pptx`, with matching 讲好 names, exact SVG mark, manuscript and subtitles. Three old-name narration segments were re-recorded; nineteen original segments remain. The video is approximately 128.092 seconds, with subtitles aligned to decoded audio and pauses. PPT page structure, canvas dimensions, read-back and per-page rendered branding were checked; this is media verification, not a new whole-surface visual verdict.

Current scoped checks passed 21 website/desktop/version/usage/deployment cases with one public-deployment browser test skipped, plus three static-intro checks including browser inspection. Website media controls and geometry passed at 1440, 820, 390 and 320px. The independent review in `.impeccable/review/brand-unification/finish-review.md` returned **ship** for the two resolved findings only: 320px promise wrapping and documentation truth. Full-suite limitations remain recorded in `.impeccable/jianghao-brand.md`; this verdict does not certify the whole new workbench, installed App, human PowerPoint opening or voice quality.

Selected-source preservation checks retained 《朝花夕拾》 at 133 pages: the chosen page-4 record and original Amanda narration record are equal, and the original page file plus five source audio segments have equal SHA-256 hashes. The isolated product-demonstration source retained all 27 checked database/WAL/SHM/settings/JSON/audio inputs. These are scoped source checks, not a byte audit of all active-user databases.

### Hosted Website and Workspace Journey — 2026-10-11 Snapshot

This public-header and visual record predates the 讲好 identity. Its account behavior and authenticated-workspace boundary remain applicable; current public colors, type and imagery follow the scoped section above.

The hosted public header pairs a named wordmark with product, help, login/workspace and invitation actions. Current links use terracotta text; hover underlines retain link meaning. At 640px and below the named menu button reports its expanded state and exposes a vertical navigation below the header. A keyboard-visible skip link leads to the main content. The public style switch has three named buttons with pressed states; changing the choice changes only the complete public built-in cover and its caption. Native FAQ disclosures use fine bottom rules instead of enclosing cards. Website buttons have a comfortable minimum height (44px), 14px type and padding (11px 20px).

Invitation registration and login share the white bordered form. Registration asks for the invitation, account, password and password confirmation; login asks for account and password. The account-format explanation is passed through the existing Field hint, so its visible helper and `aria-describedby` match. The complete hint states 3–80 allowed characters, the first-character rule and that an email is only an account name. Registration passwords require 12–128 characters; login accepts 1–128. The named visibility toggle has a 44px width and minimum height and a pressed state, while its input reserves 46px of right padding. Busy or unavailable account service disables the fieldset, errors appear as an alert, and service failure offers an explicit reconnect action. Switching registration/login preserves a validated return target; password recovery leads to the administrator-help section.

Hosted workspace navigation groups creation and the project/style destinations above a separately collapsible list of up to six recent projects. Support, public website and the administrator-only website-management destination sit above the unified account/quota footer. Primary rows are at least 42px high with padding (11px 13px); the creation action is at least 44px high. Active rows use the existing olive fill and ink with weight 600. Recent titles truncate with the full title retained on hover. The icon rail preserves accessible names and titles. On mobile, the drawer marks itself as modal, contains Tab navigation, closes by Escape/backdrop/close control or destination selection, makes workspace content inert while open and restores previous focus and body scrolling when closed.

**The Website Workspace Boundary Rule.** Public product, invitation/login, support and data/use pages are separate from the authenticated creative workspace. Visiting the public website from the same signed-in workspace keeps that workspace mounted and hidden; returning resumes the last validated work route and its draft. Signing out removes that identity's workspace; successful authentication clears workspace preferences. Public examples use checked-in demonstration assets; uploaded or generated workspace media remains behind authentication. This behavior is specific to the hosted journey.

Source authority is `src/WebSite.tsx`, `src/website.css`, `src/WorkspaceNavigation.tsx`, `src/workspace-navigation.css`, `src/Account.tsx` and `shared/web-routes.mjs`, with shared controls in `src/components.tsx` / `src/styles.css` and public/private serving boundaries in `server/hosted/index.mjs`. The nine supplied captures cover public desktop/mobile, registration desktop/mobile, login desktop, workspace desktop/mobile, tablet navigation and administrator desktop. The independent finish review in `.impeccable/review/web-site-finish-review.md` records ship after the sole account-hint correction; it confirms that correction against the two refreshed registration captures while retaining the earlier fidelity/ceiling findings. The detector's 24 findings are advisory. Evidence comes from an isolated local mock workspace and does not establish production deployment or real-model output quality; exact capture dimensions and source observations live in the websiteJourney sidecar extension.

### Style Workbench

The style-detail action opens a full workspace within the existing shell. A single large generated image is the visual anchor, with its saved state and “保存图片” link immediately below. The manuscript input offers an expandable existing-page picker; the adjacent feedback field has separate actions for “只调整这一页” and “调整规范并再试”. Changing manuscript or rules leaves the previous result visible with an explicit caption until another trial completes. Running and incomplete trials retain written status and recovery controls.

Native disclosures keep the full candidate rules, whole style language and selected design plan available on demand. Candidate manuscript, feedback, rules and selected trial survive reopening. A separate promotion row saves the completed selected image trial’s style snapshot as the formal style. Promotion remains disabled while work is running, manuscript/rules differ from that trial, a completed image result is missing or the trial is already applied. Selecting a history card restores its manuscript and candidate snapshot without promoting it. Historical web trials retain the caption “历史网页”; another trial produces an image.

**The Resolved Style Rule.** Style-reference image management remains in style creation and explicit re-extraction. After understanding content relationships, trial and production planning apply the full saved style to resolve each page’s `styleExecution`: `typeHierarchy` covers cross-scale typography, `spatialRhythm` organizes density and whitespace, `graphicHierarchy` establishes graphic and line hierarchy, and `microDetail` carries editorial microdetails. Style fidelity depends on these relationships, beyond color, large type and simple lines. Actual auxiliary microcopy must enter `displayText` and only summarize or translate the page’s content. Image requests receive resolved page choices and any explicitly selected content attachments, without conflicting alternatives from the whole style library or original style-reference images. The workbench offers no reference comparison or automatic deviation review.

**The Candidate Boundary Rule.** Keep candidate and formal style rules visibly separate; only the explicit promotion action changes the style used for later production.

### Whole Style Language

Within “完整设计规范”, `StyleLanguage` uses the native disclosure “查看用于创作的风格规范” and the explanation “同一套视觉规则，随内容形成不同的表现。” Its eight text sections are “风格特征”, “字体与文字层级”, “色彩组合”, “构图与留白原则”, “图形画法”, “细节与辅助标记”, “如何延伸到不同内容” and “避免的做法”. These describe a reusable drawing grammar; reference-image subjects, counts and positions are not fixed templates. The design-plan disclosure begins with “这一页要表达什么” and “为什么这样表现” when a content brief is available, followed by the composition, speaking intent, graphic details, inherited style features, adaptations and display text.

### Output Style Correction — 2026-09-30

**The Current Style Authority Rule.** Current explicit style rules take precedence over historical observations. For the restored Neo-Swiss style, the user prefers the original 示例演讲 pages 6–9: bold Chinese sans-serif type, black/white/lime, and compositions that vary with the content. Refinement adds only small supporting copy and precise microdetails. The original Neo-Swiss history is restored in the local database with a refinement addendum; this example does not hardcode other styles.

**The Details Refinement Rule.** The model declares `details` or `composition` mode. With an unchanged manuscript, `details` preserves the previous main copy, layout and visual, adding only short supporting annotations. A changed manuscript disables preservation of the old copy.

**The Opaque Image Rule.** Image requests require an opaque background. Requests without content attachments are text-only; selected content attachments are actual inputs to the design and multi-image editing steps. Unexpected transparent output is rejected while retaining the previous image and pending plan.

Style compiler v3 and planning v5 carry this correction; planning permits typographic expressions for more content relationships. Legacy raster plans without an engine declaration remain accepted. The original 示例演讲 source slides are untouched. This changes generated output behavior; the application palette and navigation remain unchanged. Existing interface evidence remains `.impeccable/review/content-first-desktop.png`, `.impeccable/review/content-first-user-1039.png`, `.impeccable/review/content-first-mobile.png` and `.impeccable/review/content-first-plan.png`.

Actual samples in test project `76279902-8efb-4e61-ade7-3595a836670e` are black (`.local/assets/9b52e759-f952-49b1-9598-f247e41de0d9.png`), final white (`.local/assets/35f1a308-5ab5-4d45-bcc7-70eeaaf0ec40.png`) and fresh content (`.local/assets/0cfe1ef6-efee-4cab-a225-4d6e191e30ed.png`). The independent reviewer first required a rebuild, then passed the black and fresh-content samples. The remaining white-page alignment issue was fixed and marked resolved/ship, limited to its listed fixes. This does not guarantee other styles or pages. The earlier thin-blue sample approval was rejected by the user and is superseded.

## Do's and Don'ts

### Do:

- **Do** preserve complete generated images and keep historical web scenes clearly identified.
- **Do** reuse the warm shell, terracotta action color and olive supporting states across App and authenticated-workspace views; use `public-*` identity tokens on public brand surfaces.
- **Do** show progress, incomplete work, changed inputs, saved notes and pages awaiting redesign as distinct states with meaningful text.
- **Do** keep the actual image ahead of detailed rules, with content and feedback directly beneath it.
- **Do** let content determine the expression and original composition, with the whole style grammar determining how it is drawn.
- **Do** keep page-only changes, candidate rule revisions and formal-style promotion visibly separate.
- **Do** keep the full manuscript accessible alongside condensed page text, with manual split/merge previews and version history available on demand.
- **Do** keep hosted website and workspace layout values scoped, preserve named navigation in the icon rail, and associate account-format help with its field.
- **Do** keep layered editing’s scrollable fields, persistent save/undo footer and top playback actions distinct; preserve natural text geometry and explicit overflow feedback.

### Don't:

- **Don't** present missing results, failed pages or stale previews as newly completed output.
- **Don't** let the application palette substitute for the user’s saved output style or let that style recolor application controls.
- **Don't** reintroduce template or visual-direction pickers, generic layout galleries or element editing into the ordinary image workflow. Its PPTX export remains complete images with speaker notes; editable text belongs to the explicit, independently saved layered trial.
- **Don't** reintroduce style-reference image selection, reference comparison or automatic deviation review into the finalized trial and production flows; content attachments have their own explicit material input.
- **Don't** treat choosing a history result as saving its candidate rules to the formal style.
- **Don't** treat reviewed image samples or a successful interface review as a general guarantee of output quality or reference-style fidelity.
- **Don't** expose private workspace media as public demonstration assets or turn the hosted website's type and breakpoints into global App defaults.

## Product introduction website

The standalone `/intro/` page now uses the scoped 讲好 public identity: warm paper, ink, vermilion, locally hosted Noto Sans SC headings and body, system sans fallbacks and generous centered product storytelling. Its existing cover hero and local installation/source path remain separate from the hosted invitation homepage. The earlier white/pale-gray and blue presentation is superseded only on this introduction surface; the App working-interface palette remains as documented above.

Approved built-in covers lead the page and a six-choice gallery. Eight application screenshots were refreshed from the current isolated build with public fictional demonstration material, without paid-model calls or real user data. Cover switching has named buttons, pressed state, left/right and Home/End keyboard support; covers no longer open an enlargement dialog. Every workflow remains visible without selecting a tab. Screenshot image dialogs retain Escape and focus return. Small screens use a disclosure navigation; reveal motion respects reduced-motion preferences and all content stays visible without JavaScript.

The primary action leads to installation instructions, with an explicitly labeled source ZIP download. Mac builds remain internal; no public installer or hosted generation service is implied. Export is described as full-page image PPTX with speaker notes plus a separate Markdown manuscript.

## Hosted rehearsal controls — 2026-10-11

The hosted rehearsal view keeps voice, speed and current-page manuscript in one compact form. Current-page trial and whole-project generation share a sticky top operation bar, with visible page and scope. Expression, trial length, existing narration and manual saving remain in a native disclosure. Long manuscript text scrolls within its field; on small screens the form precedes the preview. These values are scoped to hosted rehearsal, retain the warm studio palette and shared primitives, and do not change native App controls or existing settings. The Operate brief and validation boundaries are recorded in `.impeccable/rehearsal-web-layout.md`.


### Production to rehearsal continuity (2026-10-20)

Rehearsal has one primary action, “开始演练”. A real saved first-page preview and the playback source sit beside it. “编辑文字与动效” belongs to the production area; closing the editor leaves the user there. The player can return to that editor, and reopening rehearsal reads the saved record. Selected versions are remembered per project in the browser; incomplete, stale or reordered versions are not silently substituted with another editable deck.

AI narration and its existing records use one collapsed “AI 口播与配音（可选）” disclosure. Active work remains visible in its summary. Legacy picture extraction stays in compatibility settings, not the primary flow. Screen copy, speaker notes and narrated text remain separate. The warm workbench identity, action color, fonts and shared controls are unchanged; mobile stacks the preview and actions.


### New project creation (2026-10-20)

Local project creation has two steps: topic and visual style, then optional audience context. Style covers are selectable directly and searchable; industry presets carry authored briefs and never invoke a model. The default is unrestricted context. Custom generation is explicit, with a cancellable native modal showing the requested audience and elapsed waiting time. Creation waits for a complete custom brief and a separate user action after review. Errors release the modal and allow retry or preset selection. Back navigation and style-library roundtrips retain the draft. Keep the action row outside the scroll area on desktop and mobile. Existing project and trial editors retain their current behavior; no saved-content migration is involved.
