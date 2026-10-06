#!/usr/bin/env bash
# behaviour scan - detect plugin capabilities (the `## Behavior` section)
#
# scans the plugin's source tree (default: src/) and the compiled main.js
# for the four capabilities the automated reviewer reports on:
#
#   - Direct Filesystem Access (fs)        -> Warning
#   - Shell Execution (child_process)      -> Warning
#   - Clipboard Access                      -> Recommendation
#   - Vault Write                           -> Pass
#
# Usage:
#   behaviour-scan.sh <plugin-root> [extra-source-glob...]
#
# Output (stdout), one finding per line, tab-separated:
#
#   <severity>\t<capability-name>\t<message>
#
# Exit code is always 0; the orchestrator aggregates and decides.

set -euo pipefail

if [ "$#" -lt 1 ]; then
  echo "usage: $0 <plugin-root> [extra-source-glob...]" >&2
  exit 2
fi

PLUGIN_ROOT="$1"
shift || true

# Default scope: src/ and main.js. Extra globs can be passed as args.
SCAN_TARGETS=("$PLUGIN_ROOT/src" "$PLUGIN_ROOT/main.js")
for g in "$@"; do
  SCAN_TARGETS+=("$g")
done

# Only include files that exist; skip non-existent globs quietly.
existing_targets=()
for t in "${SCAN_TARGETS[@]}"; do
  if [ -e "$t" ]; then
    existing_targets+=("$t")
  fi
done

if [ "${#existing_targets[@]}" -eq 0 ]; then
  exit 0
fi

# ── Direct Filesystem Access ──────────────────────────────────────────
# Match `from "fs"`, `from "node:fs"`, `require("fs")`, `require("node:fs")`.
if grep -rEn --include='*.ts' --include='*.tsx' --include='*.js' --include='*.mjs' \
    -e 'from ["'"'"']fs["'"'"']' \
    -e 'from ["'"'"']node:fs["'"'"']' \
    -e 'require\(["'"'"']fs["'"'"']\)' \
    -e 'require\(["'"'"']node:fs["'"'"']\)' \
    "${existing_targets[@]}" >/dev/null 2>&1; then
  printf '%s\t%s\t%s\n' \
    "Warning" \
    "Direct Filesystem Access" \
    "Uses the Node.js \`fs\` module to access the filesystem outside of the Obsidian vault API. Can read and write any file on the system."
fi

# ── Shell Execution ───────────────────────────────────────────────────
if grep -rEn --include='*.ts' --include='*.tsx' --include='*.js' --include='*.mjs' \
    -e 'from ["'"'"']child_process["'"'"']' \
    -e 'from ["'"'"']node:child_process["'"'"']' \
    -e 'require\(["'"'"']child_process["'"'"']\)' \
    -e 'require\(["'"'"']node:child_process["'"'"']\)' \
    "${existing_targets[@]}" >/dev/null 2>&1; then
  printf '%s\t%s\t%s\n' \
    "Warning" \
    "Shell Execution" \
    "Executes shell commands via \`child_process\`. Gives the plugin full control over the system."
fi

# ── Clipboard Access ──────────────────────────────────────────────────
# Match navigator.clipboard, electron.clipboard, readText(), writeText().
# We deduplicate: if any of the patterns hits, report once.
if grep -rEn --include='*.ts' --include='*.tsx' --include='*.js' --include='*.mjs' \
    -e 'navigator\.clipboard' \
    -e 'electron\.clipboard' \
    -e 'clipboardManager\.readText' \
    -e '\.readText\(' \
    -e '\.writeText\(' \
    "${existing_targets[@]}" >/dev/null 2>&1; then
  printf '%s\t%s\t%s\n' \
    "Recommendation" \
    "Clipboard Access" \
    "Reads or writes the system clipboard. May expose content copied from outside Obsidian."
fi

# ── Vault Write (Pass) ────────────────────────────────────────────────
vault_write_pattern='\.(vault|fileManager)\.(create|modify|delete|trash|rename|append|trashFile|createNewFile|renameFile|processFrontMatter)\('
if grep -rEn --include='*.ts' --include='*.tsx' --include='*.js' --include='*.mjs' \
    -e "$vault_write_pattern" \
    "${existing_targets[@]}" >/dev/null 2>&1; then
  printf '%s\t%s\t%s\n' \
    "Pass" \
    "Vault Write" \
    "Creates or modifies vault files via the Obsidian API (\`vault.modify\`, \`vault.create\`, etc.)"
fi

exit 0
