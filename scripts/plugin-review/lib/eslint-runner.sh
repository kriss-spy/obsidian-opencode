#!/usr/bin/env bash
# eslint-runner - run eslint with the local review config and emit
# findings in the report-sh input format.
#
# Usage:
#   eslint-runner.sh <plugin-root>
#
# Output (stdout), one finding per line, tab-separated:
#
#   <severity>\t<message>\t[<rule-id>]\t<file:line>[\t<file:line>...]
#
# Severity is mapped from eslint's exit code: an `error` becomes
# "Error", a `warn` becomes "Warning". We do not currently emit
# Recommendations from eslint (those are produced by behavior-scan.sh).
#
# If eslint or any of the required plugins are missing, the runner
# writes a single Error-severity finding to stdout explaining the
# missing dependency and exits 0. The orchestrator decides what to do.

set -euo pipefail

if [ "$#" -lt 1 ]; then
  echo "usage: $0 <plugin-root>" >&2
  exit 2
fi

PLUGIN_ROOT="$1"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG="$SCRIPT_DIR/.eslintrc.obsidian-review.cjs"

# Locate the eslint binary. Order of precedence:
#   1. $ESLINT_BIN env var (useful for testing outside the plugin repo)
#   2. <skill>/scripts/lib/node_modules/.bin/eslint (the bundled install)
#   3. <plugin-root>/node_modules/.bin/eslint
#   4. `npx eslint`
eslint_bin="${ESLINT_BIN:-}"
SELF_ESLINT="$SCRIPT_DIR/node_modules/.bin/eslint"
if [ -z "$eslint_bin" ] || [ ! -x "$eslint_bin" ]; then
  if [ -x "$SELF_ESLINT" ]; then
    eslint_bin="$SELF_ESLINT"
  elif [ -x "$PLUGIN_ROOT/node_modules/.bin/eslint" ]; then
    eslint_bin="$PLUGIN_ROOT/node_modules/.bin/eslint"
  elif command -v npx >/dev/null 2>&1; then
    eslint_bin="npx --no-install eslint"
  else
    printf 'Error\teslint not found: run `cd %s/scripts/lib && npm install`\tlocal-setup\n' "$SCRIPT_DIR"
    exit 0
  fi
fi

# Run eslint with JSON output. Don't fail-fast on lint errors — we want
# the full set of findings.
json_file="$(mktemp)"
trap 'rm -f "$json_file"' EXIT

pushd "$PLUGIN_ROOT" >/dev/null

set +e
# Discover TS files in src/ and at the root. Eslint's flat config
# doesn't expand shell globs the way the legacy config did, so we
# expand here with `find` and pass the explicit list.
ts_files=()
if [ -d "$PLUGIN_ROOT/src" ]; then
  while IFS= read -r f; do
    ts_files+=("$f")
  done < <(find "$PLUGIN_ROOT/src" \( -name '*.ts' -o -name '*.tsx' \) -not -path '*/node_modules/*' 2>/dev/null)
fi
for top in "$PLUGIN_ROOT/main.ts"; do
  [ -f "$top" ] && ts_files+=("$top")
done

if [ "${#ts_files[@]}" -eq 0 ]; then
  echo "no TypeScript files to lint" >&2
  printf '%s\t%s\t%s\n' "Error" "no TypeScript files found under src/ or main.ts" "local-setup"
  exit 0
fi

"$eslint_bin" \
  --config "$CONFIG" \
  --format json \
  --no-warn-ignored \
  "${ts_files[@]}" 2>/dev/null \
  > "$json_file"
eslint_status=$?
set -e

popd >/dev/null

# If eslint reported a config error, surface it.
if [ "$eslint_status" -ne 0 ] && [ ! -s "$json_file" ]; then
  printf 'Error\teslint failed to run (exit %d). Check your plugin''s tsconfig and node_modules.\tlocal-setup\n' "$eslint_status"
  exit 0
fi

# Parse the JSON. Each entry in the top-level array is a file result;
# each entry in `.messages` is a finding.
# Use python for robust JSON parsing (jq doesn't have great support
# for nested arrays of objects with arbitrary keys).
python3 - "$json_file" <<'PY'
import json, sys
with open(sys.argv[1]) as f:
    data = json.load(f)

severity_name = {1: "Warning", 2: "Error"}

for file_result in data:
    filepath = file_result.get("filePath", "")
    # Make path relative to the plugin root for stable output.
    rel = filepath
    for prefix in ("/src/", "/"):
        idx = rel.rfind(prefix)
        if idx != -1 and prefix == "/src/":
            rel = rel[idx + 1:]
            break
        elif idx != -1:
            rel = rel[idx + 1:]
            break

    for msg in file_result.get("messages", []):
        sev = severity_name.get(msg.get("severity"), "Warning")
        text = " ".join(msg.get("message", "").split())
        rule = msg.get("ruleId") or ""
        line = msg.get("line", 0)
        col = msg.get("column", 0)
        end_line = msg.get("endLine", 0)
        end_col = msg.get("endColumn", 0)

        if end_line and end_line != line:
            loc = f"{rel}:{line}-{end_line}"
        else:
            loc = f"{rel}:{line}"

        parts = [sev, text]
        if rule:
            parts.append(rule)
        parts.append(loc)
        print("\t".join(parts))
PY
