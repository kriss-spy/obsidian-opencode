# Evidence branch verification

Verified on Fedora 44 on 2026-11-07 using Node.js 24.4.0.

Passed:

- `npm ci --no-audit --no-fund`.
- `npm ci --prefix scripts/plugin-review/lib --no-audit --no-fund`.
- `npm run verify`: source/test typecheck, 364 unit tests passed with 5 platform skips, all 22 CI contracts passed, review regression checks passed, and source/manifest review reported zero errors or warnings.
- Artifact comparison: all 16 JSON/PNG files match the original captures byte for byte.
- All five buffer fixtures pass the existing `normalizeFixture` validator.
- All four final event captures contain the exact duplicate text present in their corresponding terminal buffers.
- `git diff --check`.

Expected failing evidence check:

```text
$ node test/fixtures/issue-86-fedora-ime/assert-single-commit.mjs
FAIL chinese-1: expected "nihao", received "ni haonihao"
FAIL chinese-2: expected "nihao", received "ni haonihao"
FAIL japanese-1: expected "こんにちわ", received "こんにちわこんにちわ"
FAIL japanese-2: expected "こんにちわ", received "こんにちわこんにちわ"
```

Exit code: 1. This demonstrates the captured bug; it is not a failing result from the normal verification suite or a test of a future fix.

Not run for this evidence-only change: WDIO suites, another native reproduction, Windows/macOS checks, real-vault checks, and manual UI checks beyond the earlier Fedora captures. No production behavior changed. No fix is claimed.
