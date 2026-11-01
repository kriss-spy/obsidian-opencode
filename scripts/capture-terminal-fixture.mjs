import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

// Self-contained so the same function can run in Obsidian's developer console.
export function captureTerminalBuffer(terminal) {
	if (!terminal) throw new Error("Open an OpenCode terminal first");
	const buffer = terminal.buffer.active;
	return {
		version: 1,
		cols: terminal.cols,
		rows: terminal.rows,
		buffer: buffer.type,
		baseY: buffer.baseY,
		viewportY: buffer.viewportY,
		cursorX: buffer.cursorX,
		cursorY: buffer.cursorY,
		mouseTrackingMode: terminal.modes.mouseTrackingMode,
		lines: Array.from({ length: buffer.length }, (_, row) => {
			const line = buffer.getLine(row);
			return {
				text: line.translateToString(false),
				isWrapped: line.isWrapped,
				cells: Array.from({ length: line.length }, (_, col) => {
					const cell = line.getCell(col);
					return [cell.getChars(), cell.getWidth()];
				}),
			};
		}),
	};
}

export function normalizeFixture(value) {
	const integer = number => Number.isInteger(number) && number >= 0;
	if (value.version !== 1 || !integer(value.cols) || !value.cols || !integer(value.rows) || !value.rows
		|| !["normal", "alternate"].includes(value.buffer)
		|| ![value.baseY, value.viewportY, value.cursorX, value.cursorY].every(integer)
		|| typeof value.mouseTrackingMode !== "string" || !Array.isArray(value.lines)) {
		throw new Error("Invalid terminal fixture metadata");
	}
	for (const line of value.lines) {
		if (typeof line.text !== "string" || typeof line.isWrapped !== "boolean" || !Array.isArray(line.cells)
			|| !line.cells.every(cell => Array.isArray(cell) && cell.length === 2
				&& typeof cell[0] === "string" && [0, 1, 2].includes(cell[1]))) {
			throw new Error("Invalid terminal fixture row");
		}
	}
	// Keep trailing spaces, zero-width cells and stale columns beyond terminal.cols.
	return JSON.stringify(value, null, 2) + "\n";
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	try {
		const args = process.argv.slice(2);
		if (args.length === 1 && args[0] === "--snippet") {
			console.log(`copy(JSON.stringify((${captureTerminalBuffer.toString()})(app.workspace.getLeavesOfType("opencode-terminal")[0]?.view.terminal)))`);
		} else if (args.length === 2 && /^[a-z0-9][a-z0-9-]*\.json$/.test(args[1])) {
			const destination = fileURLToPath(new URL(`../test/fixtures/${args[1]}`, import.meta.url));
			writeFileSync(destination, normalizeFixture(JSON.parse(readFileSync(args[0], "utf8"))), { flag: "wx" });
			console.log(`Saved ${destination}`);
		} else {
			throw new Error("Usage: node scripts/capture-terminal-fixture.mjs --snippet | <dump.json> <fixture-name.json>");
		}
	} catch (error) {
		console.error(error.message);
		process.exitCode = 1;
	}
}
