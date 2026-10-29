# Verification commands

Run from the repository root. Use Node.js 24 and `npm ci`; the plugin-review tooling has its own lockfile and needs `npm ci --prefix scripts/plugin-review/lib`.

| Check | Command | Passing result |
| --- | --- | --- |
| Production typecheck and bundle | `npm run build` | TypeScript and esbuild exit successfully |
| Unit and integration contracts | `npm test` | No failures; native platform skips are reported |
| CI runner and artifact contracts | `npm run test:ci` | Missing/stale evidence and altered artifact cases are rejected |
| Review runner regression checks | `scripts/plugin-review/self-test.sh` | All report/exit-code fixtures pass |
| Required source/manifest review | `scripts/plugin-review/review.sh --skip-release --skip-behavior --fail-on error --report-dir test-results/review` | Zero errors |
| Isolated Obsidian app suite | `npm run test:obsidian` | All applicable specs pass in a copied test vault |
| Native OpenCode lifecycle | `npm run ci:install-opencode`, then `npm run test:obsidian:real` | Fresh completion evidence includes launch, input, resize, close, reopen, cleanup |
| Linux real focus, Ctrl+Z, file/folder mentions, session links | `npm run test:obsidian:real-workflows` | All three real V2 cases pass; pending/empty runs fail |
| Windows ConPTY hover regression | `npm run test:obsidian:windows-links` | Required native wrapped-block repro and responsiveness assertions pass |

The CLI installer exports the pinned binary through `GITHUB_ENV` in CI. Locally, set `OPENCODE_REAL_EXECUTABLE` (and `OPENCODE_WINDOWS_EXECUTABLE` for the hover suite) to the path it prints. GUI runs use separate profiles; serialize local runs under `/tmp/obsidian-opencode-real-app.lock` on Linux. See [testing details](../testing-obsidian.md) for app/installer overrides and platform requirements.

## Verify the candidate artifact

After `npm run build`, package the three upload assets with the exact checkout SHA:

```sh
node scripts/release-artifact.mjs stage release-artifact "$(git rev-parse HEAD)"
node scripts/release-artifact.mjs verify release-artifact "$(git rev-parse HEAD)"
OPENCODE_TEST_PLUGIN_DIR=release-artifact npm run test:obsidian:real
```

Set `OPENCODE_TEST_PLUGIN_DIR=release-artifact` for every app test against that candidate. WDIO installs those files into its copied vault even when a command also rebuilds the source tree. The mandatory lifecycle compares all three installed files against `artifact.json`; its runner rejects completion evidence with absent or different asset hashes. In CI, `CI_EXPECTED_SHA` additionally binds checkout, artifact and completion evidence.

`compatibility.yml` packages once, downloads the artifact on every platform, and gates all validation. `release.yml` downloads and verifies that same artifact after validation, checks tag/package/manifest/lockfile/compatibility-map identity and release notes, and publishes those exact assets. A source rebuild after verification cannot change the published bundle.

For a release candidate, copy [the release checklist template](../releases/TEMPLATE-checks.md) to a versioned checklist, fill its evidence links, and follow [the manual verification matrix](../manual-verification.md). Keep human platform sign-off distinct from automated success. The full review tool's release inspection is useful after publication; it is not the required source gate and cannot verify an unpublished release.
