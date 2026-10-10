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
typography:
  display:
    fontFamily: '"DM Sans", -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif'
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
rounded:
  badge: "5px"
  icon: "6px"
  control: "8px"
  notice: "10px"
  card: "12px"
  dialog: "16px"
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

## Colors

### Primary

Terracotta (`accent`) marks primary actions, selected pages and selected style choices. Its darker companion supplies the primary button hover state.

### Secondary

Pale olive and dark olive (`navigation-active`, `navigation-ink`) identify the current navigation destination. Green status colors indicate readiness or configured state; amber status colors indicate pending attention. Status meaning also appears in words and, where used, an icon.

### Neutral

Warm canvas, white paper and the slightly darker sidebar create the main surface hierarchy. Ink carries primary content; muted text supports secondary content. The final stylesheet uses `supporting-text` across most captions, hints and metadata. Fine `line` borders separate working areas without making every region a card.

**The Content Palette Rule.** Keep saved slide-style colors and source-image colors inside their preview surfaces; the surrounding controls retain the application palette.

## Typography

DM Sans is bundled locally at weights 400, 500, 600 and 700 through `src/main.tsx`. Chinese text uses the declared system fallbacks, beginning with PingFang SC on macOS. All interface roles inherit this stack; no separate display or monospaced face is used.

The frontmatter records the base hierarchy. Home display type varies with viewport; general page headings use local sizes around the headline role. Section and card titles step down to compact supporting labels. Page numbers and batch counts use tabular numerals where alignment matters.

Generated image typography follows the saved style and design plan; it does not inherit the interface heading scale. Long manuscript passages preserve whitespace. Manuscript rows have a comfortable reading measure (75ch maximum) and open line spacing (2.1); the note editor uses similar spacing (2.05). Small interface hints are compact, including some mobile labels (9–11px); this describes the current implementation, not a general minimum-size recommendation.

## Layout

The desktop shell uses a sticky full-height sidebar (222px) and a flexible main column. The main page is centered within a maximum width (1500px), with normal page padding (38px 44px 40px). Settings use a narrower maximum width (1100px). Borders and spacing divide page headings, project controls, the gallery and the manuscript composer.

Project and style libraries use three columns; page previews use two larger columns. The current-batch gallery, all-pages view and manuscript view share a segmented switch. The composer follows the gallery, while submitted source text is available in a disclosure. Page detail places the complete image and redesign controls beside tabbed notes, design and versions (1.65:1 columns with a 280px minimum information panel).

The style workbench places the complete 16:9 preview, a compact save action, and a horizontal trial-history strip (150px thumbnails) in a flexible left column. A 320–380px right editor uses two tabs for manuscript and result adjustments. Full rules and saved versions live inside a closed advanced disclosure in the manuscript tab. Its body scrolls independently while the generation action stays visible in its footer. Optional audience/palette settings, reference-independent cover generation, and saved generation evidence use disclosures. Tabs keep draft fields mounted; changing tabs never starts generation. At 960px and below, the editor comes before the preview in a single column; its action footer sticks above the mobile navigation.

Style details lead with an explicit saved state. Industry, audience, use case, and content topic belong to project creation and the project’s saved content preferences, rather than reusable style configuration. Reference-based refinement offers only visual requests; its draft is stored locally per style and is applied only by an explicit re-extraction action. Without reference images, the inapplicable refinement form is absent. Full rules, analysis records, versions, and page-number guidance remain accessible under a closed “高级设置” disclosure. Trial content preferences stay in the trial draft and are never promoted as style rules. The optional content-led composition stage is retired: new generation uses the saved visual rules directly, and legacy art-direction records remain read-only evidence.

Content attachments form a two-column grid beneath the page-redesign feedback, with complete thumbnails (110px high) and a visible filename and remove control. The production report uses the existing wide modal: four metrics across the top, followed by a comparison summary, any first difference and an expandable page list. At the mobile breakpoint (600px), metrics become two columns and page rows omit the secondary image-status label; attachment thumbnails remain in two columns.

The digital-presenter settings pair a saved-avatar library (240px) with a flexible workbench, separated by an open gap (28px). Identity editing and text preview follow the same border-and-spacing hierarchy as the existing studio. At its local narrow breakpoint (at most 700px), the library moves above the workbench and retains two avatar columns; identity fields stack beneath the portrait, and action rows wrap. This layout applies to the presenter settings, without changing the shell's existing breakpoints.

| Viewport | Implemented behavior |
| --- | --- |
| At least 1600px | Wider page padding (44px 60px), larger home display (42px), larger gallery gaps. |
| At most 1150px | Sidebar narrows to 192px; project/style libraries become two columns; workflow becomes two columns; toolbars wrap; page detail narrows to 1.4:1 columns with a 260px minimum information panel. |
| At most 850px | Sidebar becomes a 76px icon rail; recent projects are hidden; page detail stacks vertically; versions use two columns. |
| At most 960px | The style workbench stacks with the editor first; the footer action remains accessible and history scrolls horizontally. |
| At most 600px | Navigation becomes a fixed bottom bar (62px); page padding is 24px 18px 28px; libraries and slide galleries become one column; settings, split preview and style detail stack. |

On mobile, bulk actions and toasts sit above the bottom navigation. The home illustration is hidden, page selection controls stay visible, and the style chooser retains two columns. Dialogs remain scrollable within the viewport.

**The Preview First Rule.** Preserve the complete generated image and reveal secondary controls through detail views and disclosures as space contracts.

## Elevation & Depth

Most surfaces are flat, separated by pale tones and one-pixel borders. Project cards lift slightly on hover (3px); they do not acquire a shadow. Soft shadows are reserved for the illustrative paper stack, the selected segmented option, floating bulk actions, toasts and modal dialogs. Their exact values live in the sidecar.

Dialogs use a dim translucent backdrop with a small blur (3px). The modal is the strongest elevation; normal library cards remain quieter.

Motion is brief and functional: button and project-card transitions (0.18s), page border and reveal transitions (0.15s), task progress (0.3s), and a continuous loading spinner (1.2s). Reduced-motion preferences collapse animations and transitions to near-zero duration.

## Shapes

Controls have gently rounded corners; cards and composers use the larger card radius; dialogs use the broadest radius. The frontmatter carries the recurring sizes. Fine borders supply definition, dashed borders identify add/upload areas, and circular shapes are limited to small indicators, color swatches and numbered workflow markers.

Project page previews use a landscape frame (16:9), with images kept complete through `object-fit: contain`. The large trial image preserves its natural proportions. Historical web scenes remain viewable as scalable SVG. Project covers remain uncropped; source images may use `object-fit: cover` in the style library’s contact-sheet thumbnails.

Trial history uses a solid terracotta outline for the selected result. No scene-selection marker or element-editing controls appear in the current image workflow.

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

The current workflow produces images and exposes single-image download and project PPTX export. The workspace header has an “导出 PPT” action. Its dialog explains that each page is one complete image with the latest saved manuscript in speaker notes, preserving page order and image proportions. Missing pages, unsegmented batches and active jobs block download with an explanation. Changed manuscripts show an explicit current-image/latest-notes download label. Historical scenes flatten into a single PNG for export. Element editing remains paused.

### Content Attachments

The page-redesign form places “内容附件” below feedback and above the primary redesign action. A quiet count (“0 / 4” through “4 / 4”), shared “添加图片” button and format hint support optional selection of 1–4 chart, product or screenshot images (PNG, JPG or WebP, at most 12 MB each). White bordered thumbnail surfaces use the existing control radius and `object-fit: contain`; filenames are numbered, truncate visually with the full name available on hover, and accompany a named remove button. Selecting a thumbnail opens the original material. Uploading and generation states disable conflicting actions; inline errors retain the selection for correction or retry.

**The Content Attachment Rule.** Content images are materials to incorporate into the page, distinct from style references. The form states that clicking “重新设计这页” sends the selected actual images to both the design and image-generation steps. The design tab exposes each image’s intended role, placement and preservation requirements; generation uses multi-image editing. Without content attachments, generation remains text-only. Style-reference images never enter production requests. Leaving or changing pages with unsubmitted notes or attachment choices opens the shared React modal with “留在此页” and “放弃修改并离开”; selection alone does not apply changes to the page.

### Production Report

“报告” sits beside “导出 PPT” in the workspace header and opens “制作报告” in the shared wide modal. Four open metric columns lead with “原文”, “页面”, “页面备注” and “演说稿”; large tabular numerals (30px) are paired with small units and explanatory captions. The summary reuses the existing green ready and amber attention treatments, always with an explicit text result. Loading, read failure and “重新读取” are visible states.

**The Report Integrity Rule.** Raw submitted text includes headings; the comparison separately identifies the spoken body after Markdown headings are removed. It checks actual body text against current page notes in page order, ignoring whitespace but preserving punctuation. Equal character counts alone do not mean the text matches. The report shows the first differing character and both contexts, with a page-jump action when that position maps to a page. Unsubmitted drafts, unsegmented batches and changed notes awaiting a new image remain explicit. The speech manuscript is assembled from those same notes, so their equal counts are not an independent completeness check.

An expandable, scrollable page list shows page number, title, note count and image readiness; selecting a row opens the page. “下载报告” saves the displayed counts, comparison and page details as a text file. Interface evidence is recorded in `.impeccable/review/attachments-desktop.png`, `attachments-user.png`, `attachments-mobile.png`, `report-desktop.png`, `report-user.png` and `report-mobile.png`. Scope review passed the interface and integration; automated tests verify actual image-byte transfer and text comparison. Real paid-model attachment fusion quality remains unverified.

### Segmented Controls and Dialogs

The gallery switch uses a pale olive track and a white active option. Detail tabs use an underline instead. Native dialogs open with `showModal()`, support Escape and a close button, and close when the user clicks outside their bounds; dirty manuscript or attachment edits prompt through the shared modal before leaving. Split and merge proposals are visibly previewed before generation.

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
- **Do** reuse the warm shell, terracotta action color and olive supporting states across all views.
- **Do** show progress, incomplete work, changed inputs, saved notes and pages awaiting redesign as distinct states with meaningful text.
- **Do** keep the actual image ahead of detailed rules, with content and feedback directly beneath it.
- **Do** let content determine the expression and original composition, with the whole style grammar determining how it is drawn.
- **Do** keep page-only changes, candidate rule revisions and formal-style promotion visibly separate.
- **Do** keep the full manuscript accessible alongside condensed page text, with manual split/merge previews and version history available on demand.

### Don't:
- **Don't** present missing results, failed pages or stale previews as newly completed output.
- **Don't** let the application palette substitute for the user’s saved output style or let that style recolor application controls.
- **Don't** reintroduce template or visual-direction pickers, generic layout galleries or element editing into the current image workflow. PPTX export must remain complete images with speaker notes.
- **Don't** reintroduce style-reference image selection, reference comparison or automatic deviation review into the finalized trial and production flows; content attachments have their own explicit material input.
- **Don't** treat choosing a history result as saving its candidate rules to the formal style.
- **Don't** treat reviewed image samples or a successful interface review as a general guarantee of output quality or reference-style fidelity.


## Product introduction website

The standalone `/intro/` page uses a separate marketing presentation: white and pale gray surfaces, large centered Chinese headlines, system typography, a restrained blue action color, and generous spacing inspired by product storytelling. It introduces AutoPPT as an AI speech-to-PPT tool before explaining style creation and speech production. This does not change the warm working-interface palette described above.

Approved built-in covers lead the page and a six-choice gallery. All application screenshots are captured from an isolated demo workspace. Cover switching has named buttons, pressed state, left/right and Home/End keyboard support; every workflow remains visible without selecting a tab. Native image dialogs support Escape and return focus. Small screens use a disclosure navigation; reveal motion respects reduced-motion preferences and all content stays visible without JavaScript.

The primary action leads to installation instructions, with an explicitly labeled source ZIP download. Mac builds remain internal; no public installer or hosted generation service is implied. Export is described as full-page image PPTX with speaker notes plus a separate Markdown manuscript.
