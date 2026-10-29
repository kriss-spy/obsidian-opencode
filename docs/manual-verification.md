# Manual platform verification

Use the produced candidate files (`main.js`, `manifest.json`, `styles.css`) and record their SHA-256 values from `artifact.json`. Use a disposable vault or a copy of a representative vault. Keep the original vault closed during tests against its copy. Link every run from the candidate's [release checklist](releases/TEMPLATE-checks.md).

## Coverage inventory

| Suite or environment | Required automated coverage | Manual coverage and reason |
| --- | --- | --- |
| `real-opencode.e2e.ts` | All three OSes × Obsidian 1.12.7/latest, isolated pinned OpenCode 2.1.4; artifact hashes and lifecycle | Desktop usability and installed CLI variants |
| `real-v2-workflow.e2e.ts` | Linux × both app versions via `test:obsidian:real-workflows`; isolated profile | Native keyboard/input behavior on other platforms |
| `folder-drop.e2e.ts` real V2 case | Linux × both app versions via `test:obsidian:real-workflows`; isolated profile | Explorer/Finder drag paths on native desktops |
| `windows-terminal-links.e2e.ts` | Windows × Obsidian 1.14.5/latest, isolated real ConPTY | Reporter Windows 10/11 desktops, display scaling and hardware differences |
| `plugin.e2e.ts`: model picker layout, model click | Manual legacy suite (`test:obsidian:windows-ui`) | These cases assert legacy picker labels and the locally configured GPT-5.6 Terra model. A fresh 2.1.4 profile does not establish that fixture; record CLI/config prerequisites and an unavailable fixture as blocked |
| `plugin.e2e.ts`: shell output, mouse click/session activation, message scroll/selection, prompt cursor click | Manual legacy suite (`test:obsidian:windows-ui`) | These cases share legacy shell-command/session-screen assumptions and mutable terminal state. They need native version-specific verification; mandatory V2 lifecycle/hover checks cover separate behaviors |
| `plugin.e2e.ts`: #52 formal V2 launch/input/image paste and WSL image/Windows clipboard cases; `run-wsl-x410-tests.mjs` | Unit contracts and fake-image app coverage where applicable | Requires WSL2, X410 and a Windows clipboard; hosted Linux/native Windows jobs do not provide this topology |
| `plugin.e2e.ts`: macOS #26 composition | Synthetic composition in the app matrix | Native Pinyin input-source selection, candidate confirmation and physical key events require macOS desktop interaction |
| ARM64 | Architecture selected by hosted runners only | Run missing OS/architecture combinations explicitly; x64 evidence does not establish ARM64 behavior |
| Real vault/plugin combinations and popout windows | Copied small fixture vault in CI | Vault size, themes, other plugins, focus across native windows and user settings need representative desktop checks |

Every `OPENCODE_REAL_E2E` case is accounted for above. Legacy Windows cases remain manual while their fixtures are ported to the pinned V2 CLI. The legacy Windows command currently reads the local OpenCode configuration: run it only in a disposable OS account/profile with test configuration and no production credentials. It is not an unattended CI command.

## Desktop checklist

On Linux and an installed Windows 10/11 CLI, verify each release candidate's activation, ordinary input, Caps Lock, Shift+Enter, resize, focus after switching notes, restart, session restore and file mentions. Check wheel scrolling, text selection, model/session picker clicks and prompt cursor placement. Confirm that file mentions reach only the intended plugin session while another unrelated CLI is open. Close/reopen the terminal and confirm owned processes exit without affecting that unrelated CLI.

On WSL2 + X410, run `npm run test:obsidian:wsl-x410` with the candidate artifact selected. Check display routing, keyboard focus, folder/file drops, image copy to the Windows clipboard and cleanup. Record WSL distro/kernel, Windows build, X410 version and display route.

On macOS, choose the native Pinyin input source, compose and confirm Chinese text in the terminal, switch notes and return, then repeat through restart and a popout window. Record input source, architecture and whether events were native or synthetic. macOS remains experimental; this evidence informs defects without changing the support policy.

Repeat relevant workflows on missing ARM64 targets and a copied representative vault with its normal theme/plugins. Record plugin/theme versions and whether disabling a conflicting plugin changes the result. Never label a blocked/unavailable fixture as passed.

## Evidence template

Copy this block for each run and save screenshots/logs alongside it. Redact credentials and private note content before sharing.

```markdown
### Run: <date/time and timezone> — <tester>
- Candidate version / exact source commit:
- Artifact evidence link (`artifact.json`) and SHA-256 for all three assets:
- OS edition, version and build / architecture:
- Obsidian app version / installer version / Electron version:
- OpenCode version / install method / resolved executable:
- Profile isolation and relevant test configuration (no secrets):
- Vault fixture/copy, size, themes and enabled plugins with versions:
- Environment details (input source, scaling, WSL/X410, window layout):
- Command or numbered reproduction steps:
- Expected result:
- Actual result and status for each step (pass / fail / blocked / not run):
- Screenshots, buffer/process logs and automated run links:
- Defect links / missing coverage / reason for any exception:
- Human sign-off, scope and date:
```
