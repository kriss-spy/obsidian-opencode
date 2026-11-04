# Terminal buffer fixtures

For a terminal UI or link bug, capture the affected OpenCode layout before changing code.

1. Reproduce the report in Obsidian. Keep the affected terminal size and sidebar layout.
2. Run `node scripts/capture-terminal-fixture.mjs --snippet` from this repository.
3. Open Obsidian's developer console. Paste and run the printed snippet. It copies JSON from the first OpenCode terminal view.
4. Paste the clipboard into a temporary `dump.json`. Inspect it for private content before saving it in Git.
5. Run `node scripts/capture-terminal-fixture.mjs /path/to/dump.json issue-number-layout.json`.
6. Record the platform, OpenCode/Obsidian versions, reproduction steps, and expected links beside the fixture.
7. Load the JSON in a regression test. Confirm that it fails on the reported behavior before fixing code.

For multiple terminal views, change `[0]` in the snippet to select the affected view.
The script refuses to overwrite an existing fixture. Use a new name for another capture.

Version 1 records the active buffer, dimensions, viewport/base offsets, cursor, mouse mode, and every buffer row.
Each row retains `text`, `isWrapped`, and `[characters, width]` cells. Width 0 marks a wide character's continuation cell.
Do not trim spaces, infer wrapping from text, or truncate rows to `cols`: resized alternate buffers can retain stale columns.
This format captures text layout, not colors, images, or a screenshot. Keep screenshots for visual claims that require them.

`terminal-buffer-example.json` is a format example transcribed from the existing issue #68 screenshot fixture (`user-input-http.ts`).
It is not a live buffer capture or proof that the original report is fixed. The provider replay test remains on `dev`; stable main retains the published source tests. CI script contracts test capture and normalization.
