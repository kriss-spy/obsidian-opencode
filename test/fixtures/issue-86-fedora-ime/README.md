# Issue 86: Fedora native IME reproduction

The exact Chinese and Japanese symptoms in [issue 86](https://github.com/kriss-spy/obsidian-opencode/issues/86) reproduced on this Fedora machine on 2026-11-07.

## Environment

- Fedora Linux 44, KDE Plasma, native Wayland session.
- Fcitx5 5.1.23, existing Pinyin and Mozc configuration.
- Existing Fcitx5 trigger: `Super+space`, corresponding to the report's Meta/Win+Space.
- Published OpenCode plugin 2.3.2, downloaded from the GitHub release.
- Isolated Flatpak Obsidian 1.14.5, Electron 43.8.3, Chromium 150.0.7871.250.
- Flatpak launch enabled `--enable-wayland-ime --wayland-text-input-version=3` through its existing launcher.
- Real host OpenCode CLI v2.2.6, launched by the plugin with `--standalone` and separate XDG directories.
- Test vault: `/home/krisspy/.cache/issue86-repro/vault`.
- Test application profile: `/home/krisspy/.cache/issue86-repro/profile`.
- Repository checkout: `361c894f1241d276e52ad2910afd003986d352a7`. The test used published plugin assets rather than a source rebuild.

The user's existing app runs Obsidian 1.15.1. These captures came from the separate 1.14.5 instance. They do not establish a 1.15.1 result.

## Steps and actual results

1. Open the real OpenCode terminal in the isolated vault.
2. Focus its terminal input.
3. Activate Pinyin through Fcitx5.
4. Type `nihao` without selecting a candidate or submitting the prompt.
5. Press native Super+Space.

Expected: `nihao`. Actual terminal text: `ni haonihao`.

The initial capture shows trusted composition updates ending at `ni hao`. Pressing Meta emitted `ni hao` through xterm's `onData` event. Switching the IME then emitted `nihao`. The terminal buffer and screenshot show their concatenation. The captured `compositionend` event has `isTrusted: false`; preceding IME composition updates are trusted. No DOM composition events were injected by the reproduction script.

Repeat the steps with Mozc and compose `こんにちわ` before pressing Super+Space.

Expected: `こんにちわ`. Actual terminal text: `こんにちわこんにちわ`.

Both cases reproduced twice in the final automated run. Chinese also reproduced in the initial capture and earlier repeat runs. The native keyboard utility uses Linux `/dev/uinput`; Fcitx5 performs the actual composition and shortcut handling. CDP only focuses the terminal, attaches observers, and reads results. No model prompt was submitted.

The first Japanese attempt composed `こんいちわ` because the typed romanization did not produce the requested text with this Mozc configuration. It duplicated that text. The final run corrected the physical key sequence and verified the exact issue text `こんにちわ` twice.

## Evidence and checks

- `results.json`: final four native runs, all with `reproduced: true` and matching terminal buffers.
- `chinese-first-events.json`, `chinese-first-buffer.json`, `chinese-first.png`: initial exact Chinese capture.
- `chinese-{1,2}-events.json`, `chinese-{1,2}-buffer.json`, `chinese-{1,2}.png`: final Chinese captures.
- `japanese-{1,2}-events.json`, `japanese-{1,2}-buffer.json`, `japanese-{1,2}.png`: final exact Japanese captures.
- Buffer fixtures use the repository's `captureTerminalBuffer` and `normalizeFixture` functions. They retain cells, widths, wrap flags, and terminal dimensions.
- `reproduce.mjs`: archived native reproduction runner, preserved as executed. Its absolute paths refer to the original Fedora checkout. It is not a standalone test. It requires the isolated app running on CDP port 9229, the `issue86` agent-browser session, the attached event observers, and the compiled keyboard utility in the paths shown in the script.
- `keys.c`: native input utility source. Compile with `gcc keys.c -o /home/krisspy/.cache/issue86-repro/keys`.
- `node test/fixtures/issue-86-fedora-ime/assert-single-commit.mjs`: exited 1, with all four single-commit assertions failing on the captured exact duplicates. This checks captured evidence; it does not replay the application or verify a future fix.
- Screenshot inspection confirmed the Chinese duplicate in the rendered prompt.
- Published asset hashes match the release API digests:
  - `main.js`: `578c46dfc8429c18ebb85220fdae3db8aa3266af110bf8ffa199bfc66d0ea2ca`
  - `manifest.json`: `44dde68dabaee448e62fb35ea36115c784fbb49e338cc8b2a24f167739e6ebf6`
  - `styles.css`: `e9b74c075e54e218754622a50f73dd980efb04a6bf6a57e248ea6ab10653adcf`

This directory preserves the original captures from local `test-results/issue86/` in Git. The reproduction changed no production source. The isolated app was closed after capture. The existing user vault and app were not changed.

Not run: `npm run verify`, WDIO suites, Windows/macOS tests, the user's real-vault workflow, and Obsidian 1.15.1. This task captured the Fedora report with native IME input. It did not implement or verify a fix. The results were subsequently posted in [this issue comment](https://github.com/kriss-spy/obsidian-opencode/issues/86#issuecomment-6707283414). The issue remains open.

## Evidence branch verification

The verification limits above describe the original native reproduction. Branch verification is recorded in `verification.md`. The captured JSON and PNG files are historical evidence; verification does not rewrite them.

Run the captured-input assertion from the repository root:

```sh
node test/fixtures/issue-86-fedora-ime/assert-single-commit.mjs
```

It intentionally exits 1 on these bug captures. It is outside the normal automated test suite. It cannot establish whether a code change fixes the native IME behavior.

The `preedit.value` fields in later captures include text retained in xterm's hidden textarea from earlier cases. Each case resets the event and input logs and clears the visible CLI prompt. The `input` field records only that case's emitted text. The corresponding buffer and screenshot confirm the visible result. The initial Chinese capture predates those repeat runs.
