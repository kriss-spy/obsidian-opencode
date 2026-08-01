# Reliability Roadmap

## Product Direction

Obsidian OpenCode is a focused OpenCode workspace integration: it embeds a dependable OpenCode CLI workflow in Obsidian. The roadmap prioritizes reliability and workflow polish over new product surface area.

Personal use is product discovery, not an automatic feature queue. Recurring friction becomes roadmap work only after its workflow, platform, expected behavior, observed behavior, and impact are recorded and it is reproducible or repeats.

## Stabilization Train

The next release cycle is feature-frozen. New features, including the panel-mode backlog and new-session button, are deferred until the stabilization exit criteria are met.

### Release Blockers

- The plugin activates and opens a usable terminal.
- Keyboard input, IME composition, mouse behavior, resizing, focus, and terminal restart work predictably.
- New, resumed, and restored sessions run in the intended vault and cannot leak context into unrelated OpenCode sessions.
- Session browsing, preview, and export either complete correctly or fail visibly and safely; they must not silently corrupt or lose work.
- Linux regressions in these workflows block every release.
- Windows regressions in these workflows block the Windows-support milestone.

## Work Sequence

### 1. Make Reliability Observable

- Keep the Linux CI unit and isolated-Obsidian suites as the baseline release gate.
- Before every release candidate, verify the Windows core workflows with the installed OpenCode CLI: activation, terminal input, resize, restart, session restore, and file mentions.
- Reconcile macOS test evidence with the current changelog. The test record still reports failures for #26, #27, and #28 after releases that claim to fix them; establish whether each is a remaining defect, stale evidence, or an incomplete test.
- Record each reproduced defect with platform, Obsidian version, OpenCode version, and minimal reproduction steps.

### 2. Remove Core Workflow Defects

- Reproduce and fix #33, where Caps Lock is inserted as terminal text. It is a release blocker because it breaks ordinary terminal input.
- Audit #22. Windows PTY support has shipped, so replace this stale umbrella issue with the specific remaining Windows defects, or close it if the original report no longer reproduces.
- Triage any newly observed daily-use friction using the release-blocker definition before starting implementation.

### 3. Graduate Windows Support

- Treat Windows as supported only after its release-candidate gate passes consistently for the core workflows.
- Keep macOS experimental. Fix reproducible macOS core-workflow defects and add regression coverage where practical, but do not make macOS a per-release gate during this train.

## Release Policy

- Ship urgent, verified input, terminal, session, and data-safety fixes as focused patch releases.
- Bundle non-blocking UX polish into periodic maintenance releases.
- Do not use a calendar deadline to end stabilization. End it when the release blockers are clear and the Windows release-candidate gate is established.

## Deferred Work

- #32: New OpenCode session button.
- #15 through #19: terminal panel-mode features.
- #21: OpenCode rollback and diff-ownership behavior, which is outside the plugin's current API boundary unless new evidence identifies a plugin-controlled seam.
- Broad UI redesigns, multi-provider support, and AI-to-vault knowledge features.
