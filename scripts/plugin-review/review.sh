#!/usr/bin/env bash
# review - run the local automated-review pass on an Obsidian plugin.
#
# Orchestrates four sub-checks (eslint, behavior, manifest, release) and
# aggregates the results into the reviewer's three-section format:
#   ## Releases
#   ## Behavior
#   ## Source code
#
# Usage:
#   review.sh [options] [plugin-root]
#
# Options:
#   --skip-eslint      don't run the eslint pass
#   --skip-behavior    don't run the behavior capability scan
#   --skip-manifest    don't run the manifest validation
#   --skip-release     don't run the release attestation check
#   --report-dir DIR   write the report to DIR (default: ./obsidian-plugin-review-reports)
#   --fail-on LEVEL    exit non-zero if any finding at or above LEVEL
#                      (error|warning|recommendation|never; default: error)
#   --print-raw-tsv    also print the raw TSV findings to stderr
#   -h, --help         show this help
#
# Exit code:
#   0  - no Error-severity findings (or no findings at the chosen level)
#   1  - at least one Error-severity finding (or finding at --fail-on level)
#   2  - usage error

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB_DIR="$SCRIPT_DIR/lib"

skip_eslint=0
skip_behavior=0
skip_manifest=0
skip_release=0
report_dir="./obsidian-plugin-review-reports"
fail_on="error"
print_raw_tsv=0
plugin_root=""

usage() {
  sed -n '2,/^$/p' "$0" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --skip-eslint)     skip_eslint=1 ;;
    --skip-behavior)   skip_behavior=1 ;;
    --skip-manifest)   skip_manifest=1 ;;
    --skip-release)    skip_release=1 ;;
    --report-dir)      report_dir="$2"; shift ;;
    --fail-on)         fail_on="$2"; shift ;;
    --print-raw-tsv)   print_raw_tsv=1 ;;
    -h|--help)         usage 0 ;;
    -*)                echo "unknown option: $1" >&2; usage 2 ;;
    *)                 plugin_root="$1" ;;
  esac
  shift
done

if [ -z "$plugin_root" ]; then
  plugin_root="$(pwd)"
fi

if [ ! -d "$plugin_root" ]; then
  echo "review: not a directory: $plugin_root" >&2
  exit 2
fi

# Hard dependencies.
for tool in jq python3; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "review: required tool not found: $tool" >&2
    exit 2
  fi
done

mkdir -p "$report_dir"
tsv_file="$(mktemp)"
trap 'rm -f "$tsv_file"' EXIT

# ── Run sub-checks ────────────────────────────────────────────────────
run_subcheck() {
  local tag="$1" script="$2" should_skip="$3"
  shift 3
  if [ "$should_skip" -eq 1 ]; then
    return
  fi
  if [ ! -x "$script" ]; then
    printf '%s\tError\tReview sub-check is not executable: %s\tlocal-setup\n' "$tag" "$script" >> "$tsv_file"
    return
  fi
  # Capture output. Tag every non-empty line with the section tag.
  local out
  if ! out="$("$script" "$@" 2>/dev/null)"; then
    out="$(printf 'Error\tReview sub-check failed: %s\tlocal-setup' "$script")"
  fi
  if [ -z "$out" ]; then
    return
  fi
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    printf '%s\t%s\n' "$tag" "$line" >> "$tsv_file"
  done <<< "$out"
}

run_subcheck "Source"   "$LIB_DIR/eslint-runner.sh"   "$skip_eslint"   "$plugin_root"
run_subcheck "Source"   "$LIB_DIR/manifest-check.sh" "$skip_manifest" "$plugin_root"
run_subcheck "Behavior" "$LIB_DIR/behavior-scan.sh"  "$skip_behavior" "$plugin_root"
run_subcheck "Releases" "$LIB_DIR/release-check.sh"  "$skip_release"  "$plugin_root"

if [ "${KEEP_TSV:-0}" = "1" ]; then
  cp "$tsv_file" "${tsv_file}.saved"
  echo "raw TSV preserved at ${tsv_file}.saved" >&2
fi

# ── Aggregate into the reviewer's format ──────────────────────────────
report_file="$report_dir/review-$(date -u +%Y%m%dT%H%M%SZ).md"
"$LIB_DIR/report.sh" "$tsv_file" > "$report_file"

# Optionally dump the raw TSV for debugging.
if [ "$print_raw_tsv" -eq 1 ]; then
  cat "$tsv_file" >&2
fi

# ── Print summary to stdout ───────────────────────────────────────────
errors=$(grep -c $'^Source\tError\t\|^Releases\tError\t\|^Behavior\tError\t' "$tsv_file" 2>/dev/null || true)
warnings=$(grep -c $'^Source\tWarning\t\|^Releases\tWarning\t\|^Behavior\tWarning\t' "$tsv_file" 2>/dev/null || true)
recs=$(grep -c $'^Source\tRecommendation\t\|^Releases\tRecommendation\t\|^Behavior\tRecommendation\t' "$tsv_file" 2>/dev/null || true)
passes=$(grep -c $'^Behavior\tPass\t' "$tsv_file" 2>/dev/null || true)

echo "Errors: $errors  Warnings: $warnings  Recommendations: $recs  Passes: $passes"
echo "Report: $report_file"

# ── Decide exit code ──────────────────────────────────────────────────
case "$fail_on" in
  error)         [ "$errors"   -gt 0 ] && exit 1 || exit 0 ;;
  warning)       [ "$errors"   -gt 0 ] && [ "$warnings" -gt 0 ] && exit 1
                 [ "$errors"   -gt 0 ] && exit 1
                 [ "$warnings" -gt 0 ] && exit 1
                 exit 0 ;;
  recommendation) [ "$errors" -gt 0 ] && exit 1
                  [ "$warnings" -gt 0 ] && exit 1
                  [ "$recs" -gt 0 ] && exit 1
                  exit 0 ;;
  never)         exit 0 ;;
  *)             echo "review: invalid --fail-on: $fail_on" >&2; exit 2 ;;
esac
