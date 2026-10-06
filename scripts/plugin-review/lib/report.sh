#!/usr/bin/env bash
# report - aggregate findings from all sub-checks into the reviewer's
# three-section markdown format.
#
# Reads tab-separated findings from stdin (one per line) and prints
# the formatted markdown report to stdout.
#
# Input row shapes (all tab-separated):
#
#   Releases:
#     Releases\tRecommendation\t<message>\t<asset1>\t<asset2>\t...\t<explanation>
#
#   Behavior:
#     Behavior\t<severity>\t<capability>\t<message>
#
#   Source code (eslint + manifest):
#     Source\t<severity>\t<message>\t[<rule-id>]\t<file:line>[\t<file:line>...]
#     Source\t<severity>\t<field>\t<message>\t<rule-id>     (legacy manifest shape)
#
# Output: the markdown report (see references/review-output-format.md).
#
# Usage:
#   report.sh
#   ... | report.sh
#
# Reads stdin if no input file is given, or the first argument is a path.

set -euo pipefail

# Either the user passes a TSV file as $1, or we read stdin.
input="${1:-/dev/stdin}"
if [ "$input" = /dev/stdin ] || [ "$input" = - ]; then
  input="$(mktemp)"
  trap 'rm -f "$input"' EXIT
  cat > "$input"
fi

python3 - "$input" <<'PY'
import sys
import re
from collections import defaultdict

path = sys.argv[1]
if path == "-":
    data = sys.stdin.read()
else:
    with open(path) as f:
        data = f.read()

SEV_ORDER = {"Error": 0, "Warning": 1, "Recommendation": 2, "Pass": 3, "Info": 4}

releases = []            # list of dicts: severity, message, assets, explanation
behaviors = []           # list of dicts: severity, capability, message
source = defaultdict(list)  # key: (severity, message) -> list of (rule, locs)

def parse_source_row(parts):
    # New shape: Source <sev> <message> [<rule>] <loc> [<loc>...]
    if len(parts) < 3:
        return None
    sev = parts[1]
    message = parts[2]
    rule = ""
    locs = []
    # Heuristic: a part that looks like `pkg/rule-name` is a rule id.
    # A part that looks like `path:line[-line]` is a location.
    for p in parts[3:]:
        if re.match(r"^[\w@/-]+/[\w-]+$", p) or re.match(r"^[a-z][a-z0-9-]+$", p):
            rule = p
        else:
            locs.append(p)
    if not locs:
        locs = ["-"]
    return sev, message, rule, locs

for line in data.splitlines():
    if not line.strip():
        continue
    parts = line.split("\t")
    tag = parts[0]

    if tag == "Releases":
        # Releases\t<sev>\t<message>\t<asset>[\t<asset>...]\t<explanation>
        sev = parts[1]
        message = parts[2]
        assets = []
        explanation = ""
        if len(parts) > 4:
            explanation = parts[-1]
            assets = parts[3:-1]
        else:
            assets = parts[3:]
        releases.append({
            "severity": sev,
            "message": message,
            "assets": assets,
            "explanation": explanation,
        })

    elif tag == "Behavior":
        sev = parts[1]
        capability = parts[2]
        message = parts[3] if len(parts) > 3 else ""
        behaviors.append({
            "severity": sev,
            "capability": capability,
            "message": message,
        })

    elif tag == "Source":
        parsed = parse_source_row(parts)
        if not parsed:
            continue
        sev, message, rule, locs = parsed
        key = (sev, message)
        # Merge: append locs, dedupe but preserve order.
        existing = source[key]
        if existing:
            _, _, existing_rule, existing_locs = existing[0]
            merged_locs = list(existing_locs)
            for loc in locs:
                if loc not in merged_locs:
                    merged_locs.append(loc)
            rule = rule or existing_rule
            source[key] = [(sev, message, rule, merged_locs)]
        else:
            source[key] = [(sev, message, rule, locs)]

# ── Emit the report ───────────────────────────────────────────────────
out = []

# Releases section.
out.append("## Releases")
if not releases:
    out.append("")
else:
    out.append("")
    for r in sorted(releases, key=lambda x: SEV_ORDER.get(x["severity"], 9)):
        out.append(f"- **{r['severity']}**: {r['message']}")
        for a in r["assets"]:
            out.append(f"  - {a}")
        if r["explanation"]:
            out.append(f"  - {r['explanation']}")
    out.append("")

# Behavior section.
out.append("## Behavior")
if behaviors:
    out.append("")
    for b in sorted(behaviors, key=lambda x: SEV_ORDER.get(x["severity"], 9)):
        out.append(f"- **{b['severity']}**: **{b['capability']}**: {b['message']}")
    out.append("")

# Source code section.
out.append("## Source code")
if source:
    out.append("")
    # Sort by severity then message.
    items = sorted(source.items(), key=lambda kv: (SEV_ORDER.get(kv[0][0], 9), kv[0][1]))
    for (sev, message), entries in items:
        for entry in entries:
            _, _, rule, locs = entry
            out.append(f"- **{sev}**: {message}")
            if rule:
                out.append(f"  - {rule}")
            loc_str = ", ".join(locs)
            out.append(f"  - {loc_str}")
    out.append("")

# Final newline if any section had content; otherwise emit a placeholder
# note that source code was clean.
if not source and not behaviors and not releases:
    print("\n".join(out))
else:
    # Trim trailing blank lines.
    while out and out[-1] == "":
        out.pop()
    print("\n".join(out))
PY
