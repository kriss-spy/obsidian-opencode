import { execFile } from "node:child_process";
import { release as osRelease } from "node:os";
import { TextDecoder } from "node:util";
import { findExecutableOnPath } from "../utils/opencodeExecutable";

export interface TerminalClipboard {
	readText(): Promise<string>;
	writeText(text: string): Promise<void>;
	readImagePng?(): Promise<Buffer | null>;
	writeImagePng?(png: Uint8Array): Promise<void>;
}

interface ProcessResult {
	stdout: string;
	stderr: string;
}

type ProcessRunner = (executable: string, args: string[], input?: string) => Promise<ProcessResult>;

interface WslDetectionOptions {
	platform?: NodeJS.Platform;
	release?: string;
}

interface WslClipboardOptions extends WslDetectionOptions {
	environment?: NodeJS.ProcessEnv;
	powershellExecutable?: string | null;
	run?: ProcessRunner;
}

const POWERSHELL_ARGS = ["-NoProfile", "-NonInteractive", "-STA", "-EncodedCommand"];
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const CLIPBOARD_RETRY_FUNCTION = [
	"function Invoke-ClipboardOperation {",
	"param([scriptblock]$Operation);",
	"$ErrorActionPreference = 'Stop';",
	"for ($attempt = 0; $attempt -lt 5; $attempt++) {",
	"try { return (& $Operation) } catch {",
	"if ($attempt -eq 4) { throw };",
	"Start-Sleep -Milliseconds (50 * ($attempt + 1))",
	"}",
	"}",
	"}",
].join(" ");
const READ_COMMAND = [
	CLIPBOARD_RETRY_FUNCTION,
	"$text = Invoke-ClipboardOperation { Get-Clipboard -Raw -Format Text };",
	"if ($null -eq $text) { $text = '' };",
	"$bytes = [Text.Encoding]::UTF8.GetBytes([string]$text);",
	"[Console]::Out.Write([Convert]::ToBase64String($bytes))",
].join(" ");
const READ_IMAGE_COMMAND = [
	"Add-Type -AssemblyName System.Windows.Forms;",
	"Add-Type -AssemblyName System.Drawing;",
	CLIPBOARD_RETRY_FUNCTION,
	"$image = Invoke-ClipboardOperation { if ([Windows.Forms.Clipboard]::ContainsImage()) { [Windows.Forms.Clipboard]::GetImage() } };",
	"if ($null -ne $image) {",
	"$stream = New-Object IO.MemoryStream;",
	"try { $image.Save($stream, [Drawing.Imaging.ImageFormat]::Png);",
	"[Console]::Out.Write([Convert]::ToBase64String($stream.ToArray())) }",
	"finally { $stream.Dispose(); $image.Dispose() }",
	"}",
].join(" ");
const CLEAR_COMMAND = [
	"Add-Type -AssemblyName System.Windows.Forms;",
	CLIPBOARD_RETRY_FUNCTION,
	"Invoke-ClipboardOperation { [Windows.Forms.Clipboard]::Clear() }",
].join(" ");
const WRITE_IMAGE_COMMAND = [
	"Add-Type -AssemblyName System.Windows.Forms;",
	"Add-Type -AssemblyName System.Drawing;",
	CLIPBOARD_RETRY_FUNCTION,
	"$encoded = [Console]::In.ReadToEnd();",
	"$bytes = [Convert]::FromBase64String($encoded);",
	"$stream = New-Object IO.MemoryStream(,$bytes);",
	"$source = [Drawing.Image]::FromStream($stream);",
	"$image = New-Object Drawing.Bitmap($source);",
	"try { Invoke-ClipboardOperation { [Windows.Forms.Clipboard]::SetImage($image) } }",
	"finally { $image.Dispose(); $source.Dispose(); $stream.Dispose() }",
].join(" ");

function encodePowerShellCommand(command: string): string {
	return Buffer.from(command, "utf16le").toString("base64");
}

function decodeBase64Utf8(encoded: string): string | null {
	if (!BASE64_PATTERN.test(encoded)) return null;
	const bytes = Buffer.from(encoded, "base64");
	if (bytes.toString("base64").replace(/=+$/, "") !== encoded.replace(/=+$/, "")) return null;
	try {
		return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	} catch {
		return null;
	}
}

function runProcess(executable: string, args: string[], input?: string): Promise<ProcessResult> {
	return new Promise((resolve, reject) => {
		const child = execFile(executable, args, {
			encoding: "utf8",
			maxBuffer: 32 * 1024 * 1024,
			windowsHide: true,
		}, (error, stdout, stderr) => {
			if (error) {
				const detail = String(stderr).trim();
				reject(new Error(detail ? `${error.message}: ${detail}` : error.message));
				return;
			}
			resolve({ stdout: String(stdout), stderr: String(stderr) });
		});
		if (input !== undefined) child.stdin?.end(input, "utf8");
	});
}

export function isWsl2(options: WslDetectionOptions = {}): boolean {
	const platform = options.platform ?? process.platform;
	const release = options.release ?? osRelease();
	return platform === "linux" && /microsoft-standard-wsl2/i.test(release);
}

class WslWindowsClipboard implements TerminalClipboard {
	constructor(
		private readonly powershellExecutable: string | null,
		private readonly run: ProcessRunner,
	) {}

	async readText(): Promise<string> {
		const result = await this.execute(READ_COMMAND, "read");
		const decoded = decodeBase64Utf8(result.stdout.trim());
		if (decoded === null) throw new Error("Windows clipboard returned invalid Unicode data.");
		return decoded;
	}

	async writeText(text: string): Promise<void> {
		if (!text) {
			await this.execute(CLEAR_COMMAND, "clear");
			return;
		}
		const encodedText = Buffer.from(text, "utf8").toString("base64");
		const command = [
			CLIPBOARD_RETRY_FUNCTION,
			`$bytes = [Convert]::FromBase64String('${encodedText}');`,
			"$text = [Text.Encoding]::UTF8.GetString($bytes);",
			"Invoke-ClipboardOperation { Set-Clipboard -Value $text }",
		].join(" ");
		await this.execute(command, "write");
	}

	async readImagePng(): Promise<Buffer | null> {
		const result = await this.execute(READ_IMAGE_COMMAND, "read an image from");
		const encoded = result.stdout.trim();
		if (!encoded) return null;
		const decoded = decodeBase64Utf8Bytes(encoded);
		if (!decoded || !isPng(decoded)) throw new Error("Windows clipboard returned invalid PNG image data.");
		if (decoded.length > MAX_IMAGE_BYTES) {
			throw new Error(`Windows clipboard image exceeds the ${MAX_IMAGE_BYTES / 1024 / 1024} MiB OpenCode attachment limit.`);
		}
		return decoded;
	}

	async writeImagePng(png: Uint8Array): Promise<void> {
		const bytes = Buffer.from(png);
		if (!isPng(bytes)) throw new Error("Rendered terminal image is not valid PNG data.");
		if (bytes.length > MAX_IMAGE_BYTES) {
			throw new Error(`Rendered terminal image exceeds the ${MAX_IMAGE_BYTES / 1024 / 1024} MiB clipboard limit.`);
		}
		await this.execute(WRITE_IMAGE_COMMAND, "write an image to", bytes.toString("base64"));
	}

	private async execute(command: string, operation: string, input?: string): Promise<ProcessResult> {
		if (!this.powershellExecutable) {
			throw new Error("Windows PowerShell clipboard interop is unavailable. Ensure powershell.exe is on WSL's PATH.");
		}
		try {
			return await this.run(this.powershellExecutable, [
				...POWERSHELL_ARGS,
				encodePowerShellCommand(command),
			], input);
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error);
			throw new Error(`Unable to ${operation} the Windows clipboard through PowerShell: ${detail}`);
		}
	}
}

function decodeBase64Utf8Bytes(encoded: string): Buffer | null {
	if (!BASE64_PATTERN.test(encoded)) return null;
	const bytes = Buffer.from(encoded, "base64");
	return bytes.toString("base64").replace(/=+$/, "") === encoded.replace(/=+$/, "") ? bytes : null;
}

function isPng(bytes: Uint8Array): boolean {
	return bytes.length >= 8 && Buffer.from(bytes.subarray(0, 8)).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
}

export function createWslWindowsClipboard(options: WslClipboardOptions = {}): TerminalClipboard | null {
	if (!isWsl2(options)) return null;
	const powershellExecutable = options.powershellExecutable === undefined
		? findExecutableOnPath("powershell.exe", {
			platform: "linux",
			environment: options.environment ?? process.env,
		})
		: options.powershellExecutable;
	return new WslWindowsClipboard(powershellExecutable, options.run ?? runProcess);
}

export function decodeOsc52ClipboardSet(data: string): string | null {
	const separator = data.indexOf(";");
	if (separator < 0) return null;
	const selection = data.slice(0, separator);
	const encoded = data.slice(separator + 1);
	if (!/^[cpsq0-7]*$/.test(selection) || encoded === "?") return null;
	return decodeBase64Utf8(encoded);
}
