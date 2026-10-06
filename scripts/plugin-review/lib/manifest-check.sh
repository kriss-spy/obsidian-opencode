#!/usr/bin/env bash
# manifest-check - validate manifest.json against submission requirements
#
# Mirrors what `obsidianmd/validate-manifest` plus the official submission
# requirements check. Outputs one finding per failed field, tab-separated:
#
#   <severity>\t<field>\t<message>\t[<rule-id>]
#
# Usage:
#   manifest-check.sh <plugin-root>
#
# Exit code: 0 if no findings, 1 if any Error-severity finding, 2 on usage.

set -euo pipefail

if [ "$#" -lt 1 ]; then
  echo "usage: $0 <plugin-root>" >&2
  exit 2
fi

PLUGIN_ROOT="$1"
MANIFEST="$PLUGIN_ROOT/manifest.json"

if [ ! -f "$MANIFEST" ]; then
  printf '%s\t%s\t%s\t%s\n' \
    "Error" "manifest.json" "manifest.json not found" "obsidianmd/validate-manifest"
  exit 1
fi

# Hard dependency.
if ! command -v jq >/dev/null 2>&1; then
  echo "manifest-check: jq is required but not installed" >&2
  exit 2
fi

emit() {
  # emit <severity> <field> <message> [rule-id]
  local sev="$1" field="$2" msg="$3" rule="${4:-obsidianmd/validate-manifest}"
  printf '%s\t%s\t%s\t%s\n' "$sev" "$field" "$msg" "$rule"
}

errors=0

# ── Required fields ───────────────────────────────────────────────────
for field in id name version minAppVersion description author; do
  val=$(jq -r --arg f "$field" '.[$f] // empty' "$MANIFEST")
  if [ -z "$val" ] || [ "$val" = "null" ]; then
    emit "Error" "$field" "$field: required field is missing"
    errors=$((errors + 1))
  fi
done

# ── id rules ──────────────────────────────────────────────────────────
id=$(jq -r '.id // ""' "$MANIFEST")
if [ -n "$id" ]; then
  if [[ "$id" =~ [[:space:]] ]]; then
    emit "Error" "id" "id: must not contain whitespace"
    errors=$((errors + 1))
  fi
  if [ "${#id}" -gt 100 ]; then
    emit "Error" "id" "id: must be 100 characters or fewer"
    errors=$((errors + 1))
  fi
  if [[ "$id" =~ ^[Oo]bsidian[-_] ]] || [[ "$id" =~ ^[Oo]bsidian$ ]]; then
    emit "Error" "id" "id: must not start with 'obsidian' (reserved for official plugins)"
    errors=$((errors + 1))
  fi
fi

# ── name rules ────────────────────────────────────────────────────────
name=$(jq -r '.name // ""' "$MANIFEST")
if [ -n "$name" ] && [ "${#name}" -gt 100 ]; then
  emit "Error" "name" "name: must be 100 characters or fewer"
  errors=$((errors + 1))
fi

# ── version rules ─────────────────────────────────────────────────────
version=$(jq -r '.version // ""' "$MANIFEST")
if [ -n "$version" ] && ! [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  emit "Error" "version" "version: must match x.y.z (semver, no prefix, no pre-release tags)"
  errors=$((errors + 1))
fi

# ── minAppVersion rules ───────────────────────────────────────────────
min_app=$(jq -r '.minAppVersion // ""' "$MANIFEST")
if [ -n "$min_app" ] && ! [[ "$min_app" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  emit "Error" "minAppVersion" "minAppVersion: must match x.y.z"
  errors=$((errors + 1))
fi

# ── description rules ─────────────────────────────────────────────────
desc=$(jq -r '.description // ""' "$MANIFEST")
if [ -n "$desc" ]; then
  if [ "${#desc}" -gt 250 ]; then
    emit "Error" "description" "description: must be 250 characters or fewer"
    errors=$((errors + 1))
  fi
  # First character must be a letter or digit.
  first="${desc:0:1}"
  if ! [[ "$first" =~ [A-Za-z0-9] ]]; then
    emit "Error" "description" "description: must start with a letter or digit"
    errors=$((errors + 1))
  fi
  # Last character must be a sentence terminator.
  last="${desc: -1}"
  if ! [[ "$last" =~ [.!?] ]]; then
    emit "Error" "description" "description: must end with a period, exclamation mark, or question mark"
    errors=$((errors + 1))
  fi
  # Emoji check: if the description has any code point outside basic
  # ASCII + Latin-1 + common punctuation, flag it. This is conservative
  # but matches the reviewer's strict posture.
  if printf '%s' "$desc" | LC_ALL=C grep -qP '[^\x00-\xFF]' 2>/dev/null; then
    emit "Error" "description" "description: must not contain emoji or non-ASCII characters"
    errors=$((errors + 1))
  fi
fi

# ── Optional fields ───────────────────────────────────────────────────
is_desktop=$(jq -r '.isDesktopOnly // empty' "$MANIFEST")
if [ -n "$is_desktop" ] && [ "$is_desktop" != "true" ] && [ "$is_desktop" != "false" ]; then
  emit "Error" "isDesktopOnly" "isDesktopOnly: must be a boolean (true or false)"
  errors=$((errors + 1))
fi

for url_field in authorUrl fundingUrl; do
  url=$(jq -r --arg f "$url_field" '.[$f] // empty' "$MANIFEST")
  if [ -n "$url" ] && ! [[ "$url" =~ ^https?:// ]]; then
    emit "Error" "$url_field" "$url_field: must be a valid http(s) URL"
    errors=$((errors + 1))
  fi
done

# ── versions.json consistency ─────────────────────────────────────────
versions_file="$PLUGIN_ROOT/versions.json"
if [ -n "$version" ] && [ -f "$versions_file" ]; then
  if ! jq -e --arg v "$version" '.[$v]' "$versions_file" >/dev/null 2>&1; then
    emit "Warning" "versions.json" "versions.json: missing entry for current version $version"
  fi
fi

exit "$errors"
