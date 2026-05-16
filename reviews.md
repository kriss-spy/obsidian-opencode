## Releases

- **Recommendation**: The `main.js` release asset does not have a GitHub artifact attestation.
  - Artifact attestations let users cryptographically verify the provenance of the release assets, proving they were built from the source repository. https://docs.github.com/en/actions/security-for-github-actions/using-artifact-attestations/using-artifact-attestations-to-establish-provenance-for-builds
- **Recommendation**: The `styles.css` release asset does not have a GitHub artifact attestation.
  - Artifact attestations let users cryptographically verify the provenance of the release assets, proving they were built from the source repository. https://docs.github.com/en/actions/security-for-github-actions/using-artifact-attestations/using-artifact-attestations-to-establish-provenance-for-builds

## Network requests

- **Pass**: No suspicious network patterns found.

## Behavior

- **Warning**: **Shell Execution**: Executes shell commands via `child_process`. Gives the plugin full control over the system.
- **Pass**: **Vault Write**: Creates or modifies vault files via the Obsidian API (`vault.modify`, `vault.create`, etc.)

## Source code

- **Warning**: "builtin-modules" should be replaced with an alternative package.
  - https://github.com/es-tooling/module-replacements/blob/main/docs/modules/builtin-modules.md
  - package.json:21

## CSS lint

- **Warning**: Avoid !important — override styles by increasing selector specificity or using CSS variables instead. 
  - styles.css:8, styles.css:9, styles.css:14, styles.css:19, styles.css:20, styles.css:21, styles.css:22, styles.css:23, styles.css:24, styles.css:35, styles.css:36, styles.css:37, styles.css:38, styles.css:48, styles.css:49, styles.css:53, styles.css:54, styles.css:55, styles.css:56, styles.css:60, styles.css:61, styles.css:65, styles.css:66, styles.css:70, styles.css:75, styles.css:79, styles.css:85, styles.css:90, styles.css:91, styles.css:92, styles.css:93, styles.css:103, styles.css:104, styles.css:108, styles.css:109, styles.css:110, styles.css:111, styles.css:115, styles.css:116, styles.css:120, styles.css:121, styles.css:125, styles.css:130, styles.css:134
- **Warning**: Unexpected duplicate selector ".workspace-leaf-content[data-type="opencode-terminal"] .view-content", first used at line 18 
  - styles.css:34, styles.css:89
- **Warning**: Unexpected duplicate selector ".opencode-terminal", first used at line 27 
  - styles.css:41, styles.css:96
- **Warning**: Unexpected duplicate selector ".opencode-terminal .xterm", first used at line 52 
  - styles.css:107
- **Warning**: Unexpected duplicate selector ".opencode-terminal .xterm .xterm-viewport", first used at line 59 
  - styles.css:114
- **Warning**: Unexpected duplicate selector ".opencode-terminal .xterm-screen", first used at line 64 
  - styles.css:119
- **Warning**: Unexpected duplicate selector ".opencode-terminal .xterm-viewport canvas", first used at line 69 
  - styles.css:124
- **Warning**: Unexpected duplicate selector ".mod-right-split .workspace-leaf-content[data-type="opencode-terminal"]", first used at line 74 
  - styles.css:129
- **Warning**: Unexpected duplicate selector ".mod-right-split .opencode-terminal-container", first used at line 78 
  - styles.css:133

## Dependencies

- **Pass**: No vulnerable dependencies found.