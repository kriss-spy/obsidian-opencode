#!/usr/bin/env bash
set -euo pipefail
scripts="$(cd "$(dirname "$0")" && pwd)"
fixture="$(mktemp -d)"
trap 'rm -rf "$fixture"' EXIT
mkdir -p "$fixture/src"
touch "$fixture/src/example.ts"
cat > "$fixture/eslint" <<'MOCK'
#!/usr/bin/env bash
printf '%s\n' '[{"filePath":"/fixture/src/example.ts","messages":[{"severity":2,"ruleId":"no-control-regex","message":"First line\nsecond\tpart","line":3}]}]'
exit 1
MOCK
chmod +x "$fixture/eslint"
ESLINT_BIN="$fixture/eslint" "$scripts/lib/eslint-runner.sh" "$fixture" > "$fixture/findings"
test "$(wc -l < "$fixture/findings")" -eq 1
grep -q $'Error\tFirst line second part\tno-control-regex\tsrc/example.ts:3' "$fixture/findings"
sed $'s/^/Source\t/' "$fixture/findings" | "$scripts/lib/report.sh" > "$fixture/report"
grep -q '^  - no-control-regex$' "$fixture/report"
# A real finding must fail the orchestrator; an empty run must have one zero.
if ESLINT_BIN="$fixture/eslint" "$scripts/review.sh" --skip-release --skip-manifest --skip-behavior --report-dir "$fixture/reports" "$fixture" > "$fixture/summary"; then
  echo 'Review incorrectly passed an ESLint error' >&2; exit 1
fi
cat > "$fixture/eslint" <<'MOCK'
#!/usr/bin/env bash
printf '[]\n'
MOCK
ESLINT_BIN="$fixture/eslint" "$scripts/review.sh" --skip-release --skip-manifest --skip-behavior --report-dir "$fixture/reports" "$fixture" > "$fixture/summary"
grep -q '^Errors: 0  Warnings: 0  Recommendations: 0  Passes: 0$' "$fixture/summary"
echo 'Review report regression checks passed'
