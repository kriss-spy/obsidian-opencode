import { describe, expect, it } from "vitest";
import {
	findOpenCodeScrollbarThumb,
	findOpenCodeScrollRegionRows,
	isOpenCodePicker,
	pickerTargetAtRow,
	SCROLL_PAGE_DOWN,
	SCROLL_PAGE_UP,
	scrollbarDragInput,
	scrollbarPageInput,
} from "./windowsTerminalMouse";

function buffer(lines: string[], viewportY = 0) {
	return {
		length: lines.length,
		viewportY,
		getLine: (index: number) => lines[index] === undefined ? undefined : {
			translateToString: () => lines[index],
		},
	};
}

describe("Windows terminal mouse adapter", () => {
	it("recognizes OpenCode session and selection pickers", () => {
		expect(isOpenCodePicker(buffer(["Sessions                         esc"]))).toBe(true);
		expect(isOpenCodePicker(buffer(["Select model                     esc"]))).toBe(true);
		expect(isOpenCodePicker(buffer(["ordinary terminal output"]))).toBe(false);
	});

	it("extracts a searchable picker label from a visible row", () => {
		const terminalBuffer = buffer(["scrollback", "┃ ● GPT-5.6 Terra    Free ╹"], 1);

		expect(pickerTargetAtRow(terminalBuffer, 0)).toBe("GPT-5.6 Terra Free");
	});

	it("finds OpenCode's drawn scrollbar and maps track clicks to page input", () => {
		const thumb = findOpenCodeScrollbarThumb(buffer([
			"message                                      ",
			"message                                     ▄",
			"message                                     █",
			"message                                     █",
			"message                                      ",
		]), 5);

		expect(thumb).toEqual({ column: 44, startRow: 1, endRow: 3 });
		expect(scrollbarPageInput(thumb!, 44, 0)).toBe(SCROLL_PAGE_UP);
		expect(scrollbarPageInput(thumb!, 44, 4)).toBe(SCROLL_PAGE_DOWN);
		expect(scrollbarPageInput(thumb!, 47, 4)).toBe(SCROLL_PAGE_DOWN);
		expect(scrollbarPageInput(thumb!, 48, 4)).toBeNull();
		expect(scrollbarDragInput(2, 4, 5, 2)).toBe("\x1b\x05".repeat(5));
		expect(scrollbarDragInput(4, 2, 5, 2)).toBe("\x1b\x19".repeat(5));
		expect(scrollbarDragInput(2, 2)).toBeNull();
	});

	it("finds a one-half-cell thumb in an old session without mistaking the footer for it", () => {
		const oldSession = buffer([
			"old session output                              ",
			"▣ Build · model                                ▄",
			"                                                 ",
			"  ┃ prompt                                       ",
			"  ┃                                              ",
			"╹▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀",
		]);
		const thumb = findOpenCodeScrollbarThumb(oldSession, 6);

		expect(thumb).toEqual({ column: 47, startRow: 1, endRow: 1 });
		expect(findOpenCodeScrollRegionRows(oldSession, 6)).toBe(3);
	});
});
