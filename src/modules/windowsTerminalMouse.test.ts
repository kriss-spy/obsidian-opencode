import { describe, expect, it } from "vitest";
import { isOpenCodePicker, pickerTargetAtRow } from "./windowsTerminalMouse";

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
});
