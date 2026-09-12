interface TerminalBufferLine {
	translateToString(trimRight?: boolean, startColumn?: number, endColumn?: number): string;
}

interface TerminalBuffer {
	length: number;
	viewportY: number;
	getLine(index: number): TerminalBufferLine | undefined;
}

export const CLEAR_PICKER_QUERY = "\x7f".repeat(200);
export const SCROLL_PAGE_UP = "\x1b[5~";
export const SCROLL_PAGE_DOWN = "\x1b[6~";
export const SCROLL_LINE_UP = "\x1b\x19";
export const SCROLL_LINE_DOWN = "\x1b\x05";
const SCROLLBAR_COLUMN_TOLERANCE = 3;

export interface OpenCodeScrollbarThumb {
	column: number;
	startRow: number;
	endRow: number;
}

export function findOpenCodeScrollbarThumb(buffer: TerminalBuffer, visibleRows: number): OpenCodeScrollbarThumb | null {
	const lines = Array.from({ length: visibleRows }, (_, row) =>
		(buffer.getLine(buffer.viewportY + row)?.translateToString(true) ?? "").trimEnd()
	);
	const runs: Array<Array<{ row: number; column: number; character: string }>> = [];
	for (let row = 0; row < lines.length; row++) {
		const line = lines[row];
		const character = line.at(-1) ?? "";
		if (!"█▄▀".includes(character)) continue;
		const cell = { row, column: line.length - 1, character };
		const previousRun = runs.at(-1);
		const previousCell = previousRun?.at(-1);
		if (previousCell && previousCell.row === row - 1 && previousCell.column === cell.column) previousRun!.push(cell);
		else runs.push([cell]);
	}
	const thumb = runs
		.filter((run) => run.some(({ character }) => character === "█") || (
			run.length === 1
			&& !lines[run[0].row].slice(0, -1).includes(run[0].character)
		))
		.sort((left, right) => right[0].column - left[0].column || right.length - left.length)[0];
	return thumb
		? { column: thumb[0].column, startRow: thumb[0].row, endRow: thumb[thumb.length - 1].row }
		: null;
}

export function findOpenCodeScrollRegionRows(buffer: TerminalBuffer, visibleRows: number): number {
	const lines = Array.from({ length: visibleRows }, (_, row) =>
		buffer.getLine(buffer.viewportY + row)?.translateToString(true) ?? ""
	);
	const promptBorder = lines.findLastIndex((line) => /^\s*╹▀/.test(line));
	if (promptBorder < 0) return visibleRows;
	let promptStart = promptBorder;
	while (promptStart > 0 && /^\s*┃/.test(lines[promptStart - 1])) promptStart -= 1;
	return promptStart > 0 ? promptStart : visibleRows;
}

export function scrollbarPageInput(
	thumb: OpenCodeScrollbarThumb,
	clickedColumn: number,
	clickedRow: number,
): string | null {
	if (Math.abs(clickedColumn - thumb.column) > SCROLLBAR_COLUMN_TOLERANCE) return null;
	if (clickedRow < thumb.startRow) return SCROLL_PAGE_UP;
	if (clickedRow > thumb.endRow) return SCROLL_PAGE_DOWN;
	return null;
}

export function scrollbarDragInput(
	previousRow: number,
	currentRow: number,
	trackRows = 1,
	thumbRows = trackRows,
): string | null {
	if (currentRow === previousRow) return null;
	const lineCount = Math.max(1, Math.round(
		Math.abs(currentRow - previousRow) * trackRows / Math.max(1, thumbRows)
	));
	if (currentRow < previousRow) return SCROLL_LINE_UP.repeat(lineCount);
	if (currentRow > previousRow) return SCROLL_LINE_DOWN.repeat(lineCount);
	return null;
}

export function isOpenCodePicker(buffer: TerminalBuffer): boolean {
	for (let index = 0; index < buffer.length; index++) {
		const line = buffer.getLine(index)?.translateToString(true).trim() ?? "";
		if ((line.startsWith("Sessions") || line.startsWith("Select ")) && line.includes("esc")) return true;
	}
	return false;
}

export function pickerTargetAtRow(buffer: TerminalBuffer, visibleRow: number): string {
	return buffer.getLine(buffer.viewportY + visibleRow)
		?.translateToString(true)
		.replace(/[●┃█▀╹]/g, " ")
		.trim()
		.replace(/\s+/g, " ") ?? "";
}
