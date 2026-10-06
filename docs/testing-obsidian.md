# Testing in Obsidian

Unit tests cannot establish that an Obsidian plugin loads, registers commands, creates workspace leaves, or renders correctly in Electron. The end-to-end suite launches an isolated Obsidian instance and creates a fresh vault from `test/vault` for every run.

It does not open, register, modify, or read any existing vault. `wdio-obsidian-service` stores downloaded Obsidian versions and temporary profiles under `.obsidian-cache/`.

## Run

```bash
npm run test:obsidian
```

To run only the baseline smoke coverage, use:

```bash
npm run test:obsidian:smoke
```

On the first run, the service downloads a compatible Obsidian installer and app bundle. Later runs reuse that cache but still receive a fresh copy of the test vault.

On Windows, an additional suite exercises the installed OpenCode CLI, ConPTY rendering, and mouse interactions:

```bash
npm run test:obsidian:windows-ui
```

This suite requires `opencode` and Node.js on `PATH` and is not part of CI because it uses the developer's real OpenCode configuration.

On WSL2 with X410 running, use the dedicated suite:

```bash
npm run test:obsidian:wsl-x410
```

It resolves X410 through WSL's Windows-host gateway, disables the WSLg Wayland route, enables software GL for consistent Electron startup, pins Obsidian 1.12.7, and runs the full isolated suite. It also launches the installed formal OpenCode V2 binary with isolated XDG data directories. Set `DISPLAY_X410` when X410 uses a non-default display address.

The suite builds and installs the plugin, configures a deterministic local fake `opencode` executable, and checks:

- The plugin activates in the isolated Obsidian process.
- Its expected commands are registered.
- Session history renders fixture data, previews messages, and exports a Markdown note.
- The conversations panel can start a new session when session history is empty.
- Restoring a session launches the terminal with the exact `-s <session>` arguments.
- New Session and Continue Last Session restart an existing PTY and remain responsive to keyboard input.
- Caps Lock is ignored as terminal input while ordinary keyboard input remains responsive.
- Per-vault environment variables reach both conversation commands and terminal processes as literal values.
- The terminal is a singleton with usable dimensions, rows, and columns, and its sidebar collapses and reveals.
- The private editor server completes the JSON-RPC handshake, sends single and multiple `at_mentioned` messages, closes clients, and stays out of global lock-file discovery.

Screenshots of the conversations and terminal views are written to `test-results/obsidian/`.

When developing in multiple worktrees, run builds and unit tests independently, but give one coordinator ownership of real-app testing. `maxInstances: 1` serializes workers within one WebdriverIO run; it does not serialize separate runs. On Linux, use the same host-wide lock for every app run:

```bash
OBSIDIAN_VERSION=1.12.7 OBSIDIAN_INSTALLER_VERSION=1.12.7 \
  flock /tmp/obsidian-opencode-real-app.lock npm run test:obsidian
```

An opt-in Linux test also starts the installed formal V2 CLI, reveals its terminal after focusing a note, and checks keyboard input:

```bash
OPENCODE_REAL_E2E=1 OBSIDIAN_TEST_GREP='real V2' \
  OBSIDIAN_VERSION=1.12.7 OBSIDIAN_INSTALLER_VERSION=1.12.7 \
  flock /tmp/obsidian-opencode-real-app.lock npm run test:obsidian
```

This test uses `--standalone`, separate temporary OpenCode configuration/data directories, and the fresh test vault. It types a draft without submitting it, closes its PTY, and removes its profile. It does not reload the plugin in an existing vault.

Set `OBSIDIAN_VERSION` and `OBSIDIAN_INSTALLER_VERSION` to pin versions instead of testing the latest release:

```bash
OBSIDIAN_VERSION=1.12.7 OBSIDIAN_INSTALLER_VERSION=1.12.7 npm run test:obsidian
```

Linux CI needs Xvfb and a window manager. The `wdio-obsidian-service` sample workflow demonstrates the supported setup.

`.github/workflows/test.yml` runs the unit and isolated Obsidian suites on pushes and pull requests. CI pins both Obsidian components to 1.12.7, caches downloads, and uploads the screenshots as build artifacts.

## Obsidian CLI

The official CLI is useful for quick diagnostics against an already registered development vault:

```bash
obsidian plugin:reload id=opencode
obsidian command id=opencode:open-terminal
obsidian dev:errors
obsidian dev:screenshot path=screenshot.png
```

It cannot non-interactively create or register an arbitrary fresh vault. `vault:open` is TUI-only, so the CLI is not the isolation boundary for this suite. WebdriverIO supplies fresh profiles, vault copying, locators, input actions, waiting, screenshots, and assertions.

## Issue Coverage

| Issues | Automated evidence |
| --- | --- |
| #1, #2, #3, #4 | Real terminal-view drop events produce normalized single/multiple WebSocket mentions; handshake and cleanup are verified. |
| #24 | The Linux terminal must have non-trivial pixel dimensions and xterm rows/columns. |
| #27 | New Session and Continue Last Session replace an existing PTY and remain responsive to keyboard input. |
| #28 | The editor server is passed directly to the embedded OpenCode process and is not published for unrelated OpenCode clients to discover. |
| #32 | The conversations panel keeps its compact new-session action available and functional when session history is empty. |
| #33 | Caps Lock does not reach the PTY as text or a derived control sequence; ordinary input still does. |
| #37 | Per-vault environment variables propagate literally to conversation commands and terminal child processes. |
| #26 | Pinyin keydowns emitted while `isComposing` do not reach the PTY; only committed Chinese text is sent. Run with `npm run test:obsidian:macos-ime`. |
| #22 | Unit tests verify the isolated Windows ConPTY helper and resize channel. Windows CI covers stubbed rendering, input, live resizing, restart, and session workflows; `npm run test:obsidian:windows-ui` covers the real CLI and mouse interactions. |
| #10 | Unit tests cover large-export limits; E2E covers normal preview and export-to-note behavior. |
| #21 | Unit tests cover activity/diff parsing, successful edit metadata with an empty diff, latest-turn boundaries, pagination, and idle/running/touched precedence. E2E verifies rendered states, tooltips, warning badges, and the terminal action; a V2 API executable fixture exercises completion retention and new-turn reset through the real client and source. |
| #46 | Unit tests cover inclusive editor ranges, private bridge delivery, and ordered text fallbacks; E2E invokes the editor command and checks exact ranges and unsubmitted terminal input. |
| #57 | Unit tests cover reveal/activation ordering and guards against late focus; E2E checks command, ribbon, status, toggle, restart, restore, and editor focus stability. The opt-in Linux test also checks the installed V2 CLI. |
| #62 | Unit tests cover path parsing, wrapped terminal cells, confinement, link activation, mouse ownership, and lifecycle cleanup; E2E uses actual pointer events and editor navigation, stubbing only the external browser opener. |
| #63 | E2E checks the official ribbon mark's geometry, accessible labels, and light/dark rendering. |
| #50, #52, #53, #54 | Unit tests cover WSL2 detection, Unicode/Base64 transport, argument safety, failures, routing, OSC 52, and PNG validation. The X410 suite exercises formal V2 startup, exact selection copy, Unicode paste, OSC 52, Windows image paste through a temporary OpenCode attachment path, and rendered SIXEL copy to Windows. |

Not yet automatable in this Linux job:

- #15-#19 describe panel-mode behavior not present on the current branch.

## Unreleased 2.3.0 verification

On 2026-10-05, the integrated changes for #21, #46, #57, #62, and #63 were verified on Linux `7.2.5-200.fc44.x86_64`, with Obsidian app and installer 1.12.7 and installed OpenCode V2 CLI 2.0.22:

- `npm test`: 269 passing and 5 platform-only tests skipped.
- Production TypeScript and esbuild build: passing.
- `OPENCODE_REAL_E2E=1 npm run test:obsidian`: all seven spec files passed, with 36 passing tests and 9 platform tests skipped.
- An additional real-xterm OSC 8 regression passed: an unsafe target cannot open a browser even when its visible label looks like an HTTPS URL.

All real-app runs used fresh vaults/profiles and the shared `flock /tmp/obsidian-opencode-real-app.lock` lock. The installed CLI test checked terminal activation and keyboard input; the #21 fallback was also checked against actual V2 message metadata for a successful edit with an empty diff. Native Windows, WSL2/X410, and macOS checks were not repeated for this set of changes.

The tested `main.js` SHA-256 is `d49fd061b97c6251f2a602699819de54d0b32f36e18ad51db574c5a4fa810d9b`. This records an unreleased integration; it does not imply a version bump or published release.

### Ctrl+Z follow-up (2026-10-05)

The installed OpenCode 2.0.22 CLI reproduced a frozen embedded renderer after Ctrl+Z. The fix guards effective direct suspend bindings before xterm encodes them, preserving disabled suspend bindings, configured undo bindings, shared leaders, and composition.

- Production build and `npm test`: passing, with 272 tests passed and 5 platform-only tests skipped.
- The final isolated app run passed the installed-CLI Ctrl+Z regression and the restart/new/continue/restore workflow. It verified that the existing draft survived, subsequent typing reached OpenCode, and xterm emitted no suspend byte.
- Broader reruns were not green: the full focus sequence failed and the terminal-links suite hit renderer/script timeouts. The restart/restore case passed when run separately; the broader test interaction remains unresolved before release.
- Final tested `main.js` SHA-256: `fe76506468da76cb5cb7e8e75d6d681bcf0eaf93d938a1cc358028ab5e1dd96a`.

All app runs remained serialized under the shared lock and used isolated vaults/profiles. Native Windows, WSL2/X410, and macOS were not checked for this follow-up.

### TUI-wrapped session references (2026-10-05)

A read-only diagnostic in the running cloudnotes vault (Obsidian 1.14.4, installer 1.13.7) confirmed that OpenCode rendered an existing note path across two indented rows, both with `isWrapped=false`. The installed detector found neither fragment. The corrected detector, queried without attaching handlers or changing the session, returned the complete path and its cell range from both rows.

- Production build and `npm test`: passing, with 277 tests passed and 5 platform-only tests skipped.
- The isolated Obsidian 1.12.7 terminal-links suite passed all 7 tests before the basename-collision follow-up, covering TUI-managed and native wraps, Unicode/spaces, line/column jumps, selection, mouse ownership, external URLs, and OSC 8 guards. The final build passed the focused hard-row pointer test (1 test), including editor line/column navigation and no terminal input leakage. A repeat of the full terminal-links suite encountered hover instability and renderer timeouts; it did not complete cleanly.
- Regression tests retain ordinary hard-line separation and reject missing notes, outside-vault paths, inconsistent indentation, and separate bullets. Both rows prefer the full path over an existing root basename; missing/outside paths never offer that misleading basename. A changed continuation invalidates cached activation. Drop-handler tests now drain pending timers before restoring their window stub.
- Tested `main.js` SHA-256: `4e82870976d2e77eecd29c61fc50d4298e9d7e909636586b77c90df92bdca914`.

Real pointer tests used a fresh vault/profile under the shared app-test lock. The broader app suite was not repeated for this follow-up; the earlier full-focus-sequence failures remain unresolved.

### HTTP wrap follow-up (2026-10-05)

The saved cloudnotes session `ses_ef36ef203ffeRIUA8l2cTne6eF` reproduced a 142-character HTTP(S) address split across six OpenCode-managed hard rows. Before the fix, a real Ctrl+click attempted to open only `https://resources.anthropic/`. The complete address returned HTTP 200.

- Production build/typechecking and the full unit suite passed: 283 passed, 5 platform-only skipped.
- Final isolated Obsidian 1.12.7 pointer checks passed (3 tests): existing wrapped-note navigation, first/middle/last HTTP-row clicks with no PTY input leakage, and the saved session rendered by installed OpenCode 2.0.22. Each saved-session click delivered the exact complete address to the browser opener; only that external side effect was intercepted.
- Unit regressions cover code-block, bullet and bordered-message indentation; hostname, percent-escape, query and fragment splits; native/hard-wrap combinations; stale continuations; independent short URLs; and suppression of partial targets beyond the row/length bounds. Standards and Spec reviews cleared.
- Tested and installed `main.js` SHA-256: `2a5ee807de4a1c696ad4ac8a8825346488981cb85ad2ad5f4c6505da9a32f3bf`.

All app runs used fresh vaults/profiles under the shared lock. The saved-session diagnostic was temporary and removed after verification; its pointer evidence is in `/tmp/opencode-wrapped-url-fixed/evidence.json`. The broader app suite and other platforms were not repeated. The documented ambiguity of a filled URL row followed by a single-word row remains.

### Underline overflow and full-suite follow-up (2026-10-05)

xterm draws multi-row link ranges across the full width of intermediate rows. OpenCode-managed wraps include indentation and padding, so the provider now publishes a separate range for each TUI row while retaining the complete URL/note target. Unit checks cover exact text-cell bounds; isolated pointer tests inspect the actual underline canvas to reject pixels outside the hovered row's text.

- Production build/typechecking and the full unit suite passed: 283 passed, 5 platform-only skipped.
- Focused wrapped-note and HTTP pointer/underline checks passed before the full app suite was started.
- The first full run passed six spec files, then hit the existing terminal-links animation-frame wait timeout. The test helper now finishes after parsing with a bounded redraw wait; all pointer, canvas, navigation, and input assertions remain enabled.
- The final complete Linux app run passed all seven spec files with `OPENCODE_REAL_E2E=1`, including the installed CLI suspend regression and all eight terminal-link tests. This supplies a clean final-suite run after the earlier focus/hover/timeout failures; other desktop platforms still need fresh verification.
- Standards and Spec review cleared. Tested and installed `main.js` SHA-256: `2973e38ef1d0aac63325bbcc9a59ff6c331d66ae8d3f940fadd79235969aaa2e`.

All GUI runs remained serial in fresh vaults/profiles under the shared lock. The user's plugin artifacts were installed with backups and hash verification, without changing settings or reloading the active terminal.

### Grouped wrapped-link underlines (2026-10-05)

The earlier overflow fix limited native hover decoration to one row. The final behavior retains those per-row hit bounds and underlines every fragment of the complete target together. Non-interactive, owned overlays use the mapped cells; they are removed on leave, disposal, viewport changes, invalidated content, and transitions to embedded OSC 8 links.

- Production build/typechecking passed; full unit suite: 284 passed, 5 platform-only skipped.
- Focused app checks verified all six rendered underline rectangles against actual fragment lengths, with no indentation/padding spill, no pointer interception, complete URL activation from three rows, and group removal on leave.
- The final full Linux app suite with installed OpenCode and `OPENCODE_REAL_E2E=1` passed: 38 tests, 9 platform tests skipped, all seven spec files green.
- Standards and Spec reviews cleared. Tested and installed artifact SHA-256: `main.js` = `b2ae24d867d626e064e133f4d1f6a6a355b552c34f78a8cc0049b2a3cfce1575`; `styles.css` = `336ce4aa00034c42328f8ae216835ad9d0820617dec91ed59e6221ff4dc97a32`.

The GUI runs remained serial in fresh vaults/profiles. Installation preserved user settings and the running session. Other desktop platforms still require fresh CI verification.

### Mixed row breaks in long note paths (2026-10-06)

The live cloudnotes terminal displayed an indexed note across five hard rows, combining slash boundaries, a word break, and a break between `.` and `md`. The previous matcher tried only a uniformly spaced or uniformly joined path; both failed. The provider now chooses spaces independently at each boundary, retaining the eight-row/4,096-unit bounds and exact indexed-note requirement. Reconstructed matches must begin in their initial source row; a per-call resolution cache avoids repeated suffix lookups.

- The exact live buffer now yields the same complete note target on all five rows, with confined cell ranges. This diagnostic did not attach handlers or alter the session.
- Production build/typechecking passed; full unit suite: 286 passed, 5 platform-only skipped. A lookup-count regression covers worst-case eight-row ambiguity at 68 columns and verifies that the next provider call refreshes the note index.
- The initial complete terminal-link app spec passed all nine tests, including real Ctrl/Cmd-clicks on all five note rows, repeated navigation to the correct file, and zero PTY input leakage.
- The final optimized build passed the focused five-row pointer regression. Each click opened the full note in a new tab with no PTY leakage; the test restores its fixture and closes the new tab between checks to prevent stub resize writes and wrapping tab headers from invalidating subsequent coordinates. Other diagnostic attempts encountered unsupported window-control commands or stale test coordinates; those test-only window changes were removed.
- A subsequent broader app run passed six spec files, then failed the existing native-wrap hover precondition with a single-character suffix in column one and stalled. Its test processes were stopped without touching the user's app. The previous full-suite result above remains the last clean full Linux run; this follow-up does not claim a new full-suite pass.
- Standards and Spec reviews cleared the fix and cache. Wide-output lookup cost remains a possible follow-up optimization within the existing fixed limits.
- Installed `main.js` SHA-256: `ffe0acdc389f8bd7199099259d1547977922c6a54e6833f8690fcb0b7318fc09`. Artifact hashes were verified, settings preserved, and the user's active terminal was not reloaded. Backup: `/tmp/opencode-before-mixed-note-yv5hl616`.

### Wrapped table note paths (2026-10-06)

Session `ses_ef3381f6affeIiA6zYLGb8BC5o` contains eight long note paths in a Markdown table. Its live 68-column terminal displayed the indexed 215-character path across five bordered rows; the previous provider returned no links. A read-only probe of the new provider recognizes the same complete note on all five rows, mapping only the path cells.

- Bordered-cell reconstruction matches physical column positions, strips padding, and stops at separators, changed borders, blank path cells, or a new record's nonempty peer cell. It retains the eight-row/4,096-unit limits and adds a 16-column limit.
- Exact whole-cell lookup supports commas, parentheses, and the session's `AGENTS.md.md` filename. Reconstructed suppression ranges stay inside their individual cells; adjacent notes, web URLs, and ordinary quoted/prose references remain active. Complete quoted references stop reconstruction before following prose, while unquoted repeated extensions can continue across rows.
- Production build/typechecking passed. Final full unit suite: 301 passed, 5 platform-only skipped. Regression coverage includes physical Unicode column widths, repeated extensions split between rows (with the shorter note also indexed), quoted/prose cells, record boundaries, stale content, and rejection of missing/outside path suffixes.
- Final isolated Obsidian 1.12.7 app checks passed: four cases, 17 real Ctrl/Cmd-clicks across paragraph, table, punctuation, and split-extension layouts. Every click opened the full intended note in a new tab; no PTY input leaked. Both review axes cleared.
- Installed `main.js` SHA-256: `533dca20f39473b4b6060f8450247d2afc570c64e4f55b5bd74aeaa509162173`. Hashes were verified, settings preserved, and the user's active terminal was not reloaded. Final backup: `/tmp/opencode-before-reviewed-table-3kuch3qz`.

All app tests ran serially in isolated vaults/profiles under the shared lock. The broader app suite was not repeated for this fix; its previously documented native-wrap hover failure still needs a clean release-verification run.

### Wrapped table HTTP URLs (2026-10-06)

The same session `ses_ef3381f6affeIiA6zYLGb8BC5o` contains five long HTTP URLs in a table. Their exact addresses are retained in `test/fixtures/table-http-links.ts`, including Maps waypoints, Amazon query punctuation, a GitHub line fragment, YouTube parameters, and Wikipedia tracking parameters.

- URLs reconstruct within one bordered column without inserting spaces. Query punctuation and escapes remain intact. New records, populated peer cells, separators, changed columns and prose stop reconstruction. The paragraph reconstructor skips bordered table rows, avoiding an overlapping target that could append a horizontal separator.
- Production build/typechecking passed. Full unit suite: 309 passed, 5 platform-only skipped. Table URL regressions cover every row, exact cell ranges, continuation limits, record/layout boundaries, short completed URLs and stale source/boundary rejection.
- Isolated Obsidian 1.12.7 checks passed all five table URL cases: 37 real Ctrl/Cmd-clicks, one per rendered fragment, each opening the full original URL with zero PTY input leakage. Actual underline rectangles match every fragment and exclude borders, padding and neighboring cells; leaving removes the group.
- Five additional app regression cases passed: 17 note clicks across paragraph/table/punctuation/split-extension layouts, and three paragraph URL clicks with grouped underline verification. Standards and Spec reviews cleared.
- Installed `main.js` SHA-256: `05aff6d0c157dfb7b7d65e74139182cea1bc8418ff49f9e26ed0fb18ef285b79`. All three artifact hashes match the build; settings were preserved. Backup: `/tmp/opencode-before-table-http-b7r1a9nn`. The user's active terminal was not reloaded.

All GUI runs were serial under the shared app lock in fresh isolated vaults/profiles. The initial table URL app attempt used an offscreen end-cell pointer coordinate; the test now clicks the visible start cell and separately verifies the complete start/end range and every underline rectangle. The broader suite was not rerun; the native-wrap hover release-verification limitation documented above remains.

### Tables beside the session sidebar (2026-10-06)

The prior table HTTP fix missed the user's actual layout. A read-only snapshot of the running session showed a 101-column frame with session-sidebar labels before some table rows. The previous parser required blank indentation before the opening table border and therefore stopped at those rows. The captured URL layout also includes breaks at query commas and plus signs.

- Table detection now excludes sidebar cells before the opening border, preferring the thin table border over a thick sidebar divider. Physical border alignment, continuation bounds, stale validation and cell-only hit ranges remain in place. Comma/plus URL breaks can continue within the same cell.
- `test/fixtures/sidebar-table-http.ts` preserves the actual physical rows and column positions with anonymized sidebar labels. Unit regressions check all 22 URL fragments, an additional thick sidebar divider, and a wrapped note with changing sidebar labels. Full unit suite: 312 passed, 5 platform-only skipped; production build/typechecking passed.
- An unattached, read-only instance of the corrected provider recognized the full original URL from every one of the 22 fragments in the user's live terminal buffer. No running handlers or session state were changed.
- Isolated Obsidian 1.12.7 pointer checks passed five captured-layout cases: all 22 real Ctrl/Cmd-clicks opened the full address, and hovering every row exposed the whole underline group. Actual rectangles matched text cells and excluded sidebar/border/padding cells; no PTY input leaked. Five existing note/paragraph URL regression cases also passed (17 note clicks and three paragraph URL clicks). Both review axes cleared.
- Installed `main.js` SHA-256: `994df163c425ff42cdc1a4b5f2be1ac2468d0c9fb09b85721fac55c957b49c8b`. All three artifact hashes match, settings were preserved, and the running user session was not reloaded. Backup: `/tmp/opencode-before-sidebar-table-http-fyzonqwn`.

App checks ran serially in fresh isolated vaults/profiles under the shared lock. This is focused verification; the broader native-wrap hover release check documented above remains outstanding.

### Wrapped paths beside wrapping text columns (2026-10-06)

Session `ses_ef07f9a7affeA2ezHBLKsUB6Yy` has a Section/Destination/Change table. All five destination notes are indexed, but the previous detector stopped when either neighboring column had continuation text. The screenshot and unobscured lower rows establish a 22-cell destination column with independently wrapping labels and descriptions; the Debug popup obscured the earlier live rows, and the user later changed sessions, so this verification does not claim a full live-buffer probe of all five paths.

- An aligned horizontal separator establishes the record, allowing independently wrapping peers while reconstructing only the destination column. Tables without this evidence retain the blank-peer rule. Drawn separators, changed geometry, blank path cells and new numbered rows still stop reconstruction. The same record handling applies to HTTP table links.
- Cached continuations retain snapshots of the exact separator and scanned preceding rows. Replacing that separator cannot fall back to older separator evidence. Unit regressions cover misaligned separators, aligned data replacing a nearer separator, multi-column URLs, physical Chinese widths, and full targets/ranges for all five notes.
- Production build/typechecking passed. Final full unit suite: 320 passed, 5 platform-only skipped. Standards and Spec reviews cleared after addressing the stale-separator finding.
- Final isolated Obsidian 1.12.7 run passed 15 relevant cases: 17 real clicks on the five multi-column note paths, 17 prior paragraph/table/punctuation/split-extension note clicks, 22 captured sidebar-table URL clicks, and three paragraph URL clicks. Each opened its complete intended target with no PTY leakage. Multi-column note hover checks verified all path fragments underlined together and confined to the destination text cells, including rows beside Chinese labels and prose.
- Installed `main.js` SHA-256: `afead01c43ec040ede89305351b949906eb8779d5406e4fb02d6a3299271601b`. All three artifact hashes match the build, settings were preserved, and the user's running session was not reloaded. Backup: `/tmp/opencode-before-multicolumn-table-rw3fs_f8`.

All GUI tests ran serially under the shared app lock in fresh isolated vaults/profiles. The broader native-wrap hover release-verification check documented above remains outstanding.

## WSL2/X410 evidence

On 2026-09-12, the dedicated suite ran on Ubuntu under kernel `6.18.33.2-microsoft-standard-WSL2`, with X410 as the selected X11 display, Obsidian app and installer 1.12.7, and formal OpenCode V2 CLI 2.0.1:

- `npm test`: 155 passing and 5 platform-only tests skipped.
- `npm run build`: passing.
- `npm run test:obsidian:wsl-x410`: 22 passing and 7 native-Windows tests skipped.

The clipboard test enabled `OPENCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT=1`, copied an active Unicode xterm selection with `Ctrl+C`, and separately emitted the OSC 52 payload used by OpenCode's default copy-on-select behavior. It verified both through the Windows clipboard API, pasted copied text into an actual Obsidian note with `Ctrl+V`, and restored the previous clipboard. It also round-tripped a Windows bitmap into formal OpenCode V2 as `[Image 1]` and copied a rendered 32 × 16 SIXEL canvas back to the Windows clipboard as PNG. The isolated XDG profile and clipboard image directory were removed after the terminal closed.

## macOS VM

The suite was executed in a Quickemu macOS 26.5.2 x86_64 guest against Obsidian app and installer 1.12.7:

- `npm test`: 72 passing and 2 Windows-only tests skipped.
- `npm run build`: passing.
- `npm run test:obsidian`: 14 passing and 6 Windows-only tests skipped.

The #26 test drives Chromium's composition event sequence inside the real macOS Obsidian/Electron process. It does not automate selection of the macOS Pinyin input source or generate native keystrokes through Accessibility APIs. Its assertion is at the plugin boundary: keydowns marked `isComposing` must be suppressed, while the committed text must be delivered once.

## Sources

- [Official Obsidian CLI documentation](https://help.obsidian.md/cli)
- [Official CLI command reference source](https://github.com/obsidianmd/obsidian-help/blob/master/en/Extending%20Obsidian/Obsidian%20CLI.md)
- [Obsidian 1.12.7 release notes](https://obsidian.md/changelog/2026-03-23-desktop-v1.12.7/)
- [`wdio-obsidian-service`](https://github.com/jesse-r-s-hines/wdio-obsidian-service)
- [`wdio-obsidian-service` sample plugin](https://github.com/jesse-r-s-hines/wdio-obsidian-service-sample-plugin)
- [WebdriverIO Electron testing](https://webdriver.io/docs/desktop-testing/electron/)
