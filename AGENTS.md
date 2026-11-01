## Agent skills

### Verification

Before any change, read `docs/agents/verification.md` for the authoritative commands, artifact checks, and manual evidence requirements.

### Definition of done

- Run `npm run verify` and the WDIO specs relevant to the change when the environment allows. Follow the verification guide above.
- In the final report, list passed checks and checks not run, including applicable Windows/macOS, real-vault, and manual UI checks.
- Never close or mark an issue completed until the user confirms the fix or a test reproducing the original report passes.

### Terminal regressions

For terminal UI or link-detection bugs, first capture a real buffer fixture and write a failing test from it, then fix the bug. See `test/fixtures/README.md` for capture and replay instructions.

### Issue tracker

Issues are tracked on GitHub. See `docs/agents/issue-tracker.md`.

### Triage labels

Using standard default labels (`needs-triage`, `needs-info`, `ready-for-agent`, etc.). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout (one `CONTEXT.md` at repo root). See `docs/agents/domain.md`.
