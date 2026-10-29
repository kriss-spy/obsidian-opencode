# <version> release candidate verification

Candidate commit: <full SHA>. Candidate artifact: <workflow artifact link>.

| Asset | SHA-256 |
| --- | --- |
| main.js | <hash> |
| manifest.json | <hash> |
| styles.css | <hash> |

## Automated evidence

- [ ] Build, unit tests, CI contracts and source/plugin review: <run links>.
- [ ] Required compatibility for this exact commit and packaged artifact: <run link>.
- [ ] Linux/Windows/macOS × Obsidian 1.12.7/latest lifecycle evidence includes installed asset hashes: <links>.
- [ ] Linux real focus/Ctrl+Z and file/folder mentions on both versions: <links>.
- [ ] Windows ConPTY hover on Obsidian 1.14.5/latest: <links>.
- [ ] Tag, package/lockfile/manifest versions, compatibility map and release notes agree.

## Manual evidence and sign-off

Use [the coverage inventory and evidence template](../manual-verification.md); record pass, fail, blocked or not run with a reason. Link each run, including missing coverage. Historical checks apply only to their recorded artifact.

- [ ] Linux desktop core workflows with the installed CLI: <evidence>.
- [ ] Windows 10/11 desktop core workflows, mouse/model/session interactions: <evidence>.
- [ ] WSL2 + X410 and Windows clipboard: <evidence or reason not run>.
- [ ] Native macOS IME/focus/popout checks (experimental): <evidence or reason not run>.
- [ ] ARM64 combinations absent from the hosted matrix: <evidence or reason not run>.
- [ ] Representative vault copy, themes/other plugins and native popouts: <evidence or reason not run>.
- [ ] Maintainer reviewed failures, blocked fixtures and remaining risks: <name/date/decision>.

## Publication

Release authorization: <user/maintainer decision link>. Tagging triggers publication after required automated gates; the workflow does not enforce the human checklist. Record sign-off before creating the tag. Verify the downloaded published assets match the candidate hashes and inspect provenance after publication: <evidence>.
