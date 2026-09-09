import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs";
import { identifyOpenCodeCli, resolveOpencodeExecutable } from "./opencodeExecutable";

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

describe("identifyOpenCodeCli", () => {
	it("recognizes stable OpenCode, OpenCode v2, and rejects Codex", () => {
		expect(identifyOpenCodeCli("opencode [project]  start opencode tui")).toBe("stable");
		expect(identifyOpenCodeCli("OpenCode 2.0 preview command line interface")).toBe("v2");
		expect(identifyOpenCodeCli("Codex CLI\nUsage: codex [OPTIONS]")).toBeNull();
	});
});
