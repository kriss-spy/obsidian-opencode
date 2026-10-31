import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { runInNewContext } from "node:vm";
import { normalizeFixture } from "../capture-terminal-fixture.mjs";

test("console capture preserves wide cells, wrapping and stale columns after resize", () => {
	const cells = [["中", 2], ["", 0], ["é", 1], [" ", 1], ["stale", 1]];
	const line = {
		length: cells.length, isWrapped: true, translateToString: trim => { assert.equal(trim, false); return "中é stale"; },
		getCell: index => ({ getChars: () => cells[index][0], getWidth: () => cells[index][1] }),
	};
	const terminal = {
		cols: 4, rows: 2, modes: { mouseTrackingMode: "any" },
		buffer: { active: { type: "alternate", baseY: 0, viewportY: 0, cursorX: 3, cursorY: 1, length: 1, getLine: () => line } },
	};
	const result = spawnSync(process.execPath, ["scripts/capture-terminal-fixture.mjs", "--snippet"], { encoding: "utf8" });
	assert.equal(result.status, 0);
	let copied;
	runInNewContext(result.stdout, {
		app: { workspace: { getLeavesOfType: type => { assert.equal(type, "opencode-terminal"); return [{ view: { terminal } }]; } } },
		copy: value => { copied = value; },
	});
	const fixture = JSON.parse(normalizeFixture(JSON.parse(copied)));
	assert.equal(fixture.cols, 4);
	assert.equal(fixture.rows, 2);
	assert.equal(fixture.lines[0].isWrapped, true);
	assert.deepEqual(fixture.lines[0].cells, cells);
	assert.equal(fixture.lines[0].text, "中é stale");
	assert.throws(() => normalizeFixture({ ...fixture, cols: 0 }), /metadata/);
	assert.throws(() => normalizeFixture({ ...fixture, lines: [{ ...fixture.lines[0], cells: [["x", 9]] }] }), /row/);
});
