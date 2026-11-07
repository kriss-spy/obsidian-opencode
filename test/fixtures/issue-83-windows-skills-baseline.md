# Issue 83: native Windows baseline

`issue-83-windows-skills-baseline.json` is a real xterm buffer capture from a fresh Obsidian 1.14.5/installer 1.14.5 profile on Windows x64, using the unmodified 2.4.0 candidate assets at commit `3e8aa5706aad2b0007906304d1fb8a19ad4d3cff`.

The peer was `windows-protocol-stub.cjs`, a deterministic native Node console fixture, not the user's OpenCode session. The fixture displays Skills, advertises mouse modes, queries terminal capabilities, and emits a known SIXEL image when SIXEL is advertised. The baseline had no decoded image and reported no mouse tracking. The app regression failed expecting the decoded 32x16 image. The same regression passes with the packaged node-pty ConPTY backend and native-mode mouse guards.

This fixture contains no user data. It reproduces the transport failure in an isolated app; it is not a claim to have captured or fixed every failure in the user's live session. The separately reproduced real OpenTUI 0.8.0 image negotiation is recorded in `docs/windows-terminal-protocols.md`.
