# Windows graphics and native mouse input (#83)

The Windows helper uses **node-pty 1.1.0 with `useConptyDll: true`**. It embeds the official package's x64/ARM64 JavaScript, native modules, packaged `conpty.dll`/`OpenConsole.exe`, and MIT license into the three-file plugin distribution. Regenerate the payloads with `npm run embed:windows-pty`; node-pty is pinned in the package and lockfile. No native module is loaded into Electron: it stays in the existing external Node helper, which still starts inside the kill-on-close Job Object.

Linux/macOS retain the Python PTY implementation. Windows does not silently fall back to the older OS host when the packaged runtime cannot load; setup errors are reported in the terminal. Node.js on PATH and Windows 10 1809+ remain required.

## Options compared

| Option | Isolated OpenTUI 0.8.0 result on this PC |
| --- | --- |
| Candidate's bundled zigpty 0.2.1 / system ConPTY | SIXEL false, resolution null, image protocol blocks, outer mouse enable absent |
| Maintained node-pty with system ConPTY | Same failure; changing libraries alone does not fix negotiation |
| node-pty prebuilt redistribution with packaged ConPTY | SIXEL true, pixel resolution returned, image protocol sixel, outer mouse enable present |
| Official stable node-pty 1.1.0 with packaged ConPTY | Same passing result; selected to avoid a custom backend or beta dependency |

The diagnostic renderer loaded a generated 400x400 PNG successfully in every case. For the selected backend it reported `sixel=true`, `resolution={width:826,height:462}`, and `effectiveProtocol=sixel`. The original host instead answered primary device attributes with `ESC[?1;0c` and consumed mouse-enable sequences. Enabling xterm's image addon or changing font/size settings cannot repair that transport.

Windows-only cursor, picker and wheel workarounds now stand aside whenever the application enables native mouse tracking. This lets OpenCode's own Skills, model and session handlers receive the original coordinates rather than converting a rendered row into a search query. The keyboard-only fallback remains for applications that do not request mouse events.

## Regression evidence

Local platform: Windows 10 x64, build 19045; Node 24.22.1; Obsidian app/installer 1.14.5, Chromium 150.0.7871.250; OpenCode 2.2.5 for the isolated real-CLI check; renderer-only probe OpenTUI 0.8.0 on Bun 1.3.14. No live vault or plugin was changed.

- The new isolated app test **fails on the exact original 2.4.0 candidate** (decoded image is null), then passes on the fixed build. Its native Node fixture uses no OpenCode credentials or profile. It checks original 32x16 decoded dimensions, exact red/blue pixel samples, and actual browser pointer clicks on Skills, Select model and Sessions rows with descriptions.
- A real baseline xterm buffer is retained at `test/fixtures/issue-83-windows-skills-baseline.json`, with provenance beside it. It is an isolated reproduction, not a capture of the user's session.
- Native integration covers primary DA and pixel-size reply round trips, SGR mouse press/release, PowerShell/npm launch, interruption and complete descendant cleanup. The original Job Object containment is preserved.
- The #70 real-CLI hover test now checks that packaged ConPTY does **not** create the old screen-sized wrapped block after reflow, then retains its pointer/provider invocation, renderer latency and prompt input assertions. This is a deliberate expectation change for the new host, not evidence that the old OS-host reproducer ran. Pathological wrapped-block coverage remains in the link-provider tests.
- The new app spec runs automatically in the existing Windows compatibility matrix and explicitly skips other operating systems.

Run the focused app regression with `npm run test:obsidian -- --spec test/specs/windows-terminal-protocols.e2e.ts`. All app runs must use the runner's fresh profile/copied test vault. The fake peer proves transport and browser hit-testing; real Skills behavior with the user's theme/plugin combinations still requires manual sign-off.

## Limits

Native ARM64, older Windows versions, and Linux/macOS app runs require CI/manual verification. Packaged native assets increase the plugin bundle from about 1.6 MB to about 4.2 MB. WezTerm was not changed or diagnosed as using this exact backend. This branch does not publish a release or install into cloudnotes.
