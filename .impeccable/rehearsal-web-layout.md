# Hosted rehearsal layout — 2026-10-11

Mode: Operate. Target: the hosted project rehearsal route, `src/RehearsalCenter.tsx`, `src/HostedRehearsalControls.tsx` and scoped rehearsal CSS.

User brief: retain MiniMax speech; bring voice, manuscript and trial controls together; expose current-page trial and whole-project generation without finding the page footer; preserve all existing content and service configuration.

The incumbent warm studio, terracotta action, olive states, shared fields and buttons remain the visual authority. This is a layout refinement, with no new visual world or changes to provider routing, persistence, quotas, generation scope, confirmation or playback.

The hosted view uses a compact two-column preview and voice form. Voice and speed sit together above the bounded manuscript textarea. Expression, trial length, existing narration selection and manual saving use a native disclosure. The two generation actions share a sticky top toolbar with the current page and scope. At the stacked breakpoint the form precedes the preview; mobile action targets remain at least 44 CSS pixels. Native App and browser-local layouts retain their existing controls.

Bounded inspection: desktop and mobile were inspected together; one batch corrected mobile action stretching, form order and focus scroll margins. One confirmation round established first-viewport actions and no horizontal overflow at a 390×844 CSS viewport. Long draft input does not grow the page beyond the textarea. Screenshots and mock flow evidence are stored privately under `.hosted/rehearsal-layout-20261011/`, excluded from source and deployment packages.

Validation uses an isolated hosted workspace and a simulated MiniMax MP3. It covers short trial, whole-project generation and retained voice parameters, without paid provider calls or edits to user projects. Real voice similarity and provider authorization remain outside this layout check.
