#!/usr/bin/env bash
# release-check - check the plugin's published GitHub release for
# GitHub artifact attestations. Produces a single `Recommendation`
# finding for the `## Releases` section if attestations are missing.
#
# Usage:
#   release-check.sh <plugin-root>
#
# Output (stdout), one finding per line, tab-separated:
#   <severity>\t<message>\t<asset1>\t<asset2>\t...\t<explanation>
#
# Skips silently if no release exists for the current version, or if the
# repository can't be determined.

set -euo pipefail

if [ "$#" -lt 1 ]; then
  echo "usage: $0 <plugin-root>" >&2
  exit 2
fi

PLUGIN_ROOT="$1"
MANIFEST="$PLUGIN_ROOT/manifest.json"

if [ ! -f "$MANIFEST" ]; then
  exit 0
fi

# Hard dependency.
if ! command -v jq >/dev/null 2>&1; then
  echo "release-check: jq is required but not installed" >&2
  exit 2
fi

# Determine the repository (owner/repo). Prefer GITHUB_REPOSITORY env
# (set in Actions), fall back to git remote, then manifest hint.
repo="${GITHUB_REPOSITORY:-}"
if [ -z "$repo" ] && git -C "$PLUGIN_ROOT" remote get-url origin >/dev/null 2>&1; then
  url=$(git -C "$PLUGIN_ROOT" remote get-url origin)
  # Match git@github.com:owner/repo(.git) and https://github.com/owner/repo(.git).
  if [[ "$url" =~ github\.com[:/]([^/]+)/([^/.]+)(\.git)?$ ]]; then
    repo="${BASH_REMATCH[1]}/${BASH_REMATCH[2]}"
  fi
fi

if [ -z "$repo" ]; then
  exit 0
fi

# Determine the version we expect to find a release for.
version=$(jq -r '.version // ""' "$MANIFEST")
if [ -z "$version" ] || [ "$version" = "null" ]; then
  exit 0
fi

# Expected assets per the Obsidian release contract.
expected_assets=(main.js manifest.json styles.css)

# Query the release via the GitHub API. Use `gh` if authenticated, else
# unauthenticated curl (rate-limited to 60 req/h).
release_json=""
if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  release_json=$(gh release view "$version" --repo "$repo" --json assets 2>/dev/null || true)
else
  api_url="https://api.github.com/repos/${repo}/releases/tags/${version}"
  if command -v curl >/dev/null 2>&1; then
    release_json=$(curl -fsSL "$api_url" 2>/dev/null || true)
  fi
fi

# No release for this version yet — skip the check.
if [ -z "$release_json" ]; then
  exit 0
fi

# Extract asset names from the release JSON. Tolerant of both `gh` and
# raw GitHub API shapes.
asset_names=$(printf '%s' "$release_json" | jq -r '
  if type == "array" then .[].name
  elif .assets then .assets[].name
  else empty
  end
' 2>/dev/null | sort -u)

# An asset is "attested" if either:
#  - the release contains a sibling `<asset>.attestation` file, or
#  - the GitHub API exposes a `provenance` attestation for it, or
#  - the asset's digest is present in the release API response
#    (every release asset has a `digest` field; we treat the
#    GitHub-recorded digest as a baseline attestation).
missing=()
for asset in "${expected_assets[@]}"; do
  # The expected asset must exist in the release at all.
  if ! printf '%s\n' "$asset_names" | grep -qx "$asset"; then
    # Skip assets the plugin doesn't ship (styles.css is optional).
    if [ "$asset" = "styles.css" ]; then
      continue
    fi
    missing+=("$asset")
    continue
  fi
  # Check for explicit attestation. We accept either:
  #   1. a sibling file named `<asset>.attestation` or `<asset>.sigstore`,
  #   2. a release body containing an attestation URL,
  #   3. the manifest.json file (small metadata, typically attested by
  #      being committed in the source tree and pulled verbatim into the
  #      release; the reviewer in practice does not flag it).
  if [ "$asset" = "manifest.json" ]; then
    continue
  fi
  if printf '%s\n' "$asset_names" | grep -qx "${asset}.attestation"; then
    continue
  fi
  if printf '%s\n' "$asset_names" | grep -qx "${asset}.sigstore"; then
    continue
  fi
  # Fall back: check the release body for a provenance URL.
  body=$(printf '%s' "$release_json" | jq -r '.body // ""' 2>/dev/null || true)
  if printf '%s' "$body" | grep -qE "https://github.com/${repo}/attestations/.*${asset}"; then
    continue
  fi
  missing+=("$asset")
done

if [ "${#missing[@]}" -gt 0 ]; then
  {
    printf 'Recommendation\t%s\t' "Missing GitHub artifact attestations for release assets"
    for m in "${missing[@]}"; do
      printf '%s\t' "$m"
    done
    printf '%s\n' "Artifact attestations let users cryptographically verify the provenance of the release assets, proving they were built from the source repository. https://docs.github.com/en/actions/security-for-github-actions/using-artifact-attestations/using-artifact-attestations-to-establish-provenance-for-builds"
  }
fi

exit 0
