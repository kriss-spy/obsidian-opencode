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
