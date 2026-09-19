import { afterEach, describe, expect, it, vi } from "vitest";
import { isOpenCodeThemePicker, terminalColorQueryResponse, ThemePreviewInputBatcher } from "./themePreview";

afterEach(() => vi.useRealTimers());

function buffer(lines: string[], viewportY = 0) {
	return {
		length: lines.length,
		viewportY,
		getLine: (index: number) => lines[index] === undefined ? undefined : {
			translateToString: () => lines[index],
		},
	};
}

describe("theme preview integration", () => {
	it("reports the host background to terminal theme probes", () => {
		expect(terminalColorQueryResponse(11, "#1e1e1e"))
			.toBe("\x1b]11;rgb:1e1e/1e1e/1e1e\x1b\\");
	});

	it("supports the CSS color formats used by Obsidian themes", () => {
		expect(terminalColorQueryResponse(10, "rgb(212, 212, 212)"))
			.toBe("\x1b]10;rgb:d4d4/d4d4/d4d4\x1b\\");
		expect(terminalColorQueryResponse(11, "#abc"))
			.toBe("\x1b]11;rgb:aaaa/bbbb/cccc\x1b\\");
		expect(terminalColorQueryResponse(11, "transparent")).toBeNull();
	});

	it("recognizes the OpenCode theme preview dialog", () => {
		expect(isOpenCodeThemePicker(buffer([
			"Themes                                      esc",
			"Search",
			"  opencode",
		]), 3)).toBe(true);
		expect(isOpenCodeThemePicker(buffer(["Select model                esc"]), 1)).toBe(false);
		expect(isOpenCodeThemePicker(buffer([
			"Themes                                      esc",
			"ordinary terminal output",
		], 1), 1)).toBe(false);
	});

	it("sends rapid navigation as one batch after the input burst", () => {
		vi.useFakeTimers();
		const sent: string[] = [];
		const input = new ThemePreviewInputBatcher((data) => sent.push(data));

		input.send("\x1bOB", true);
		input.send("\x1bOB", true);
		input.send("\x1bOB", true);
		expect(sent).toEqual([]);
		vi.advanceTimersByTime(50);
		expect(sent).toEqual(["\x1bOB\x1bOB\x1bOB"]);
	});

	it("applies pending navigation before confirming and leaves other terminal input alone", () => {
		const sent: string[] = [];
		const input = new ThemePreviewInputBatcher((data) => sent.push(data));

		input.send("\x1b[B", true);
		input.send("\x1b[B", true);
		input.send("\r", true);
		input.send("hello", false);

		expect(sent).toEqual(["\x1b[B\x1b[B\r", "hello"]);
	});

	it("waits until navigation input goes quiet before previewing", () => {
		vi.useFakeTimers();
		const sent: string[] = [];
		const input = new ThemePreviewInputBatcher((data) => sent.push(data));

		input.send("\x1b[B", true);
		vi.advanceTimersByTime(30);
		input.send("\x1b[B", true);
		vi.advanceTimersByTime(30);
		expect(sent).toEqual([]);
		vi.advanceTimersByTime(20);

		expect(sent).toEqual(["\x1b[B\x1b[B"]);
	});

	it("drops pending previews when the user cancels the picker", () => {
		const sent: string[] = [];
		const input = new ThemePreviewInputBatcher((data) => sent.push(data));
		input.send("\x1b[B", true);
		input.send("\x1b", true);

		expect(sent).toEqual(["\x1b"]);
	});

	it("answers terminal color probes without flushing pending navigation", () => {
		vi.useFakeTimers();
		const sent: string[] = [];
		const input = new ThemePreviewInputBatcher((data) => sent.push(data));
		const response = "\x1b]11;rgb:1e1e/1e1e/1e1e\x1b\\";
		input.send("\x1b[B", true);
		input.send(response, true);

		expect(sent).toEqual([response]);
		vi.advanceTimersByTime(50);
		expect(sent).toEqual([response, "\x1b[B"]);
	});

	it("drops queued previews when the terminal closes", () => {
		vi.useFakeTimers();
		const sent: string[] = [];
		const input = new ThemePreviewInputBatcher((data) => sent.push(data));
		input.send("\x1b[B", true);
		input.send("\x1b[B", true);

		input.dispose();
		vi.runAllTimers();

		expect(sent).toEqual([]);
	});
});
