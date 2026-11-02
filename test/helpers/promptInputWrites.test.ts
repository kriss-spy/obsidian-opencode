import { describe, expect, it } from "vitest";
import { promptInputWrites } from "./promptInputWrites";

describe("prompt input observation", () => {
	it("separates complete focus and primary device replies from dropped prompt text", () => {
		expect(promptInputWrites(["\x1b[I", "\x1b[?62;4;9;22c", " Folder drop 笔记/ ", "\x1b[O"]))
			.toEqual([" Folder drop 笔记/ "]);
	});
	it("retains mixed chunks, partial replies, keys and unexpected control bytes", () => {
		const input = ["\x1b[?62;4;9;22c Folder/ ", "\x1b[?62;4", "\x1b[A", "\r\n\t", "@Smoke.md", " Folder/ "];
		expect(promptInputWrites(input)).toEqual(input);
	});
});
