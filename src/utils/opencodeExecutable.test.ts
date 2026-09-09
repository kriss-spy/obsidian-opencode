import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs";
import { resolveOpencodeExecutable } from "./opencodeExecutable";

vi.mock("fs", () => ({
	accessSync: vi.fn(),
	constants: { X_OK: 1 },
}));

describe("resolveOpencodeExecutable", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("auto-detects OpenCode in a user-local bin directory when the setting is empty", () => {
		vi.mocked(fs.accessSync).mockImplementation((candidate) => {
			if (candidate !== "/home/tester/.opencode/bin/opencode") throw new Error("not found");
		});

		expect(resolveOpencodeExecutable("", {
			platform: "linux",
			environment: { PATH: "/usr/bin" },
			homeDirectory: "/home/tester",
		})).toBe("/home/tester/.opencode/bin/opencode");
	});
});
