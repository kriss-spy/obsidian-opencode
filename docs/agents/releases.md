# Stable and development branches

Keep `main` as the default branch. Its manifest must identify a public stable release with downloadable assets.
Keep runtime source, dependencies, and distribution files aligned with that release. CI and verification tools may advance separately.
Develop features and prepare unpublished versions on `dev` or branches based on `dev`.

`Published stable release` checks PRs targeting `main`, main pushes, and main merge groups.
It checks version metadata, public release state, asset bytes and digests, and runtime source against the release tag.
Metadata requests use the read-only workflow token to avoid anonymous API limits on shared runners.
The check rejects draft/prerelease metadata explicitly and downloads assets without credentials. Maintainer access to a private asset cannot satisfy it.
`dev` receives the full compatibility suite without requiring its candidate version to be public.

## Release sequence

1. Prepare the version, notes, checklist, and candidate on `dev`.
2. Run [verification](verification.md) against the exact packaged candidate. Record manual evidence and missing coverage.
3. Keep the default-branch manifest at the existing public version while the candidate is a draft.
4. Obtain the maintainer's publication decision. Pushing a stable tag starts a workflow that publishes after validation.
5. After publication, verify public downloads, hashes, and attestations.
6. Open a promotion PR that aligns `main` with the exact published tag. Require compatibility and `Published stable release` before merging.
7. Verify the default manifest, community listing, and a fresh-vault installation after directory processing.

Tag creation is a publication action. A release hold prohibits pushing its stable tag.
The 2.4.0 draft remains on hold. Its original candidate is preserved at `codex/2.4.0-candidate` (`3e8aa5706aad2b0007906304d1fb8a19ad4d3cff`).

The #85 recovery restores older runtime content through a forward commit. Git history still contains the unreleased changes.
A later merge from `dev` alone does not undo that restoration. The promotion PR must explicitly restore runtime source, metadata, and assets from the approved public tag.
