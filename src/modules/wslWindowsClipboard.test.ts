import { describe, expect, it, vi } from "vitest";
import {
	createWslWindowsClipboard,
	decodeOsc52ClipboardSet,
	isWsl2,
} from "./wslWindowsClipboard";

describe("isWsl2", () => {
	it("distinguishes WSL2 from native Linux, WSL1, Windows, and macOS", () => {
		expect(isWsl2({ platform: "linux", release: "6.6.87.2-microsoft-standard-WSL2" })).toBe(true);
		expect(isWsl2({ platform: "linux", release: "6.8.0-generic" })).toBe(false);
		expect(isWsl2({ platform: "linux", release: "4.4.0-19041-Microsoft" })).toBe(false);
		expect(isWsl2({ platform: "win32", release: "10.0.26100" })).toBe(false);
		expect(isWsl2({ platform: "darwin", release: "25.0.0" })).toBe(false);
	});
});

describe("WSL Windows clipboard bridge", () => {
	it("writes arbitrary Unicode through encoded arguments without a shell", async () => {
		const run = vi.fn().mockResolvedValue({ stdout: "", stderr: "" });
		const clipboard = createWslWindowsClipboard({
			platform: "linux",
			release: "6.6.87.2-microsoft-standard-WSL2",
			powershellExecutable: "/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe",
			run,
		});
		const text = "Décodage 中文 😀\n'\"; $(touch /tmp/nope) `whoami`";

		expect(clipboard).not.toBeNull();
		await clipboard!.writeText(text);

		expect(run).toHaveBeenCalledOnce();
		const [executable, args] = run.mock.calls[0];
		expect(executable).toBe("/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe");
		expect(args.slice(0, 4)).toEqual(["-NoProfile", "-NonInteractive", "-STA", "-EncodedCommand"]);
		expect(args).toHaveLength(5);
		const command = Buffer.from(args[4], "base64").toString("utf16le");
		const encodedText = Buffer.from(text, "utf8").toString("base64");
		expect(command).toContain(encodedText);
		expect(command).not.toContain(text);
	});

	it("reads Unicode from Base64 ASCII output", async () => {
		const expected = "éàèêôù 中文 😀\r\nsecond line";
		const run = vi.fn().mockResolvedValue({
			stdout: `${Buffer.from(expected, "utf8").toString("base64")}\r\n`,
			stderr: "",
		});
		const clipboard = createWslWindowsClipboard({
			platform: "linux",
			release: "5.15.153.1-microsoft-standard-WSL2",
			powershellExecutable: "powershell.exe",
			run,
		});

		await expect(clipboard!.readText()).resolves.toBe(expected);
	});

	it("surfaces missing interop and process failures", async () => {
		const unavailable = createWslWindowsClipboard({
			platform: "linux",
			release: "5.15.153.1-microsoft-standard-WSL2",
			powershellExecutable: null,
		});
		await expect(unavailable!.writeText("hello")).rejects.toThrow(/PowerShell.*unavailable/i);

		const failing = createWslWindowsClipboard({
			platform: "linux",
			release: "5.15.153.1-microsoft-standard-WSL2",
			powershellExecutable: "powershell.exe",
			run: vi.fn().mockRejectedValue(new Error("interop disabled")),
		});
		await expect(failing!.readText()).rejects.toThrow(/interop disabled/);
	});

	it("reads and writes PNG clipboard images without placing binary data in command arguments", async () => {
		const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
		const run = vi.fn()
			.mockResolvedValueOnce({ stdout: png.toString("base64"), stderr: "" })
			.mockResolvedValueOnce({ stdout: "", stderr: "" });
		const clipboard = createWslWindowsClipboard({
			platform: "linux",
			release: "6.6.87.2-microsoft-standard-WSL2",
			powershellExecutable: "powershell.exe",
			run,
		});

		await expect(clipboard!.readImagePng!()).resolves.toEqual(png);
		await clipboard!.writeImagePng!(png);

		const [, args, input] = run.mock.calls[1];
		expect(args.join(" ")).not.toContain(png.toString("base64"));
		expect(input).toBe(png.toString("base64"));
	});

	it("returns null without an image and rejects invalid image bytes", async () => {
		const noImage = createWslWindowsClipboard({
			platform: "linux",
			release: "6.6.87.2-microsoft-standard-WSL2",
			powershellExecutable: "powershell.exe",
			run: vi.fn().mockResolvedValue({ stdout: "", stderr: "" }),
		});
		await expect(noImage!.readImagePng!()).resolves.toBeNull();
		await expect(noImage!.writeImagePng!(Buffer.from("not png"))).rejects.toThrow(/valid PNG/);
	});

	it("does not create a bridge outside WSL2", () => {
		expect(createWslWindowsClipboard({ platform: "linux", release: "6.8.0-generic" })).toBeNull();
	});
});

describe("decodeOsc52ClipboardSet", () => {
	it("decodes valid Unicode clipboard-set payloads", () => {
		const text = "quotes '\" and 中文 😀";
		expect(decodeOsc52ClipboardSet(`c;${Buffer.from(text, "utf8").toString("base64")}`)).toBe(text);
	});

	it.each([
		"c;?",
		"missing-separator",
		"invalid-selection!;SGVsbG8=",
		"c;not base64",
		"c;/w==",
	])("rejects malformed or query payload %s", (payload) => {
		expect(decodeOsc52ClipboardSet(payload)).toBeNull();
	});
});
