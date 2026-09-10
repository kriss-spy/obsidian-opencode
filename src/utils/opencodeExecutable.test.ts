import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs";
import { identifyOpenCodeCli, resolveOpencodeExecutable } from "./opencodeExecutable";

vi.mock("fs", () => ({
	accessSync: vi.fn(),
	readdirSync: vi.fn(() => {
		throw new Error("not found");
	}),
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

	it("expands a home-relative configured executable path", () => {
		vi.mocked(fs.accessSync).mockImplementation((candidate) => {
			if (candidate !== "/home/tester/.nvm/versions/node/v22.17.1/bin/opencode2") throw new Error("not found");
		});

		expect(resolveOpencodeExecutable("~/.nvm/versions/node/v22.17.1/bin/opencode2", {
			platform: "linux",
			environment: { PATH: "/usr/bin" },
			homeDirectory: "/home/tester",
		})).toBe("/home/tester/.nvm/versions/node/v22.17.1/bin/opencode2");
	});

	it("resolves a bare executable installed by NVM outside the inherited PATH", () => {
		vi.mocked(fs.readdirSync).mockReturnValue([
			{ name: "v20.19.6", isDirectory: () => true },
			{ name: "v22.17.1", isDirectory: () => true },
		] as unknown as ReturnType<typeof fs.readdirSync>);
		vi.mocked(fs.accessSync).mockImplementation((candidate) => {
			if (candidate !== "/home/tester/.nvm/versions/node/v22.17.1/bin/opencode2") throw new Error("not found");
		});

		expect(resolveOpencodeExecutable("opencode2", {
			platform: "linux",
			environment: { PATH: "/usr/bin" },
			homeDirectory: "/home/tester",
		})).toBe("/home/tester/.nvm/versions/node/v22.17.1/bin/opencode2");
	});

	it("resolves a bare executable from the active NVM for Windows symlink", () => {
		vi.mocked(fs.accessSync).mockImplementation((candidate) => {
			if (candidate !== "C:\\Program Files\\nodejs\\opencode2.CMD") throw new Error("not found");
		});

		expect(resolveOpencodeExecutable("opencode2", {
			platform: "win32",
			environment: {
				PATH: "C:\\Windows\\System32",
				NVM_SYMLINK: "C:\\Program Files\\nodejs",
			},
			homeDirectory: "C:\\Users\\tester",
		})).toBe("C:\\Program Files\\nodejs\\opencode2.CMD");
	});

	it("resolves a bare executable from an installed NVM for Windows version", () => {
		vi.mocked(fs.readdirSync).mockImplementation((directory) => {
			if (directory !== "C:\\Users\\tester\\AppData\\Roaming\\nvm") throw new Error("not found");
			return [
				{ name: "v20.19.6", isDirectory: () => true },
				{ name: "v22.17.1", isDirectory: () => true },
			] as unknown as ReturnType<typeof fs.readdirSync>;
		});
		vi.mocked(fs.accessSync).mockImplementation((candidate) => {
			if (candidate !== "C:\\Users\\tester\\AppData\\Roaming\\nvm\\v22.17.1\\opencode2.CMD") {
				throw new Error("not found");
			}
		});

		expect(resolveOpencodeExecutable("opencode2", {
			platform: "win32",
			environment: {
				PATH: "C:\\Windows\\System32",
				NVM_HOME: "C:\\Users\\tester\\AppData\\Roaming\\nvm",
			},
			homeDirectory: "C:\\Users\\tester",
		})).toBe("C:\\Users\\tester\\AppData\\Roaming\\nvm\\v22.17.1\\opencode2.CMD");
	});
});

describe("identifyOpenCodeCli", () => {
	it("recognizes stable OpenCode, OpenCode v2, and rejects Codex", () => {
		expect(identifyOpenCodeCli("opencode [project]  start opencode tui")).toBe("stable");
		expect(identifyOpenCodeCli("OpenCode 2.0 preview command line interface")).toBe("v2");
		expect(identifyOpenCodeCli("Codex CLI\nUsage: codex [OPTIONS]")).toBeNull();
	});
});
