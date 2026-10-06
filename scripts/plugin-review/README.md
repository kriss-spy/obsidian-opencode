# Local plugin review

Tracked copy of the local `obsidian-plugin-review` skill scripts, updated for eslint-plugin-obsidianmd 0.4.2. Run from the repository root:

```sh
npm ci --prefix scripts/plugin-review/lib
scripts/plugin-review/self-test.sh
scripts/plugin-review/review.sh --report-dir /tmp/opencode-review
```

The source scan includes production and mocked unit tests. Only `obsidianmd/no-global-this` is disabled for `*.test.ts`: those Node fixtures intentionally provide the fake-timer host without a browser window. Production rules remain enabled. ESLint 0.4.2 adds the previously missing `prefer-create-el` check. Messages containing tabs/newlines become one TSV record; core rule IDs retain their own report line. Failed sub-checks are errors, not silent success.

This is a public-rule approximation, not an exact dashboard mirror. Capability notices describe intentional filesystem, shell, and clipboard access. Release inspection only looks for companion attestation assets; it does not validate GitHub's attestation API, and an unpublished candidate has no release result. It cannot reproduce private malware scanning or dashboard scoring.

The review tool has its own lockfile and Moment override because its Obsidian type dependency also pins the vulnerable Moment version. Audit both dependency trees. No runtime plugin dependency is added by this tool.
