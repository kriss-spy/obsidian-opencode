import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { gunzipSync } from "node:zlib";
import { WINDOWS_NODE_PTY_X64 } from "./windowsNodePtyX64";
import { WINDOWS_NODE_PTY_ARM64 } from "./windowsNodePtyArm64";

const materialized = new Map<string, string>();

export function materializeWindowsNodePty(architecture: "x64" | "arm64"): string {
	const existing = materialized.get(architecture);
	if (existing) return existing;
	const archive = architecture === "arm64" ? WINDOWS_NODE_PTY_ARM64 : WINDOWS_NODE_PTY_X64;
	const files = JSON.parse(gunzipSync(Buffer.from(archive, "base64")).toString("utf8")) as Record<string, string>;
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), "obsidian-opencode-node-pty-"));
	for (const [relative, contents] of Object.entries(files)) {
		const target = path.resolve(directory, relative);
		if (path.relative(directory, target).startsWith("..") || path.isAbsolute(relative)) throw new Error("Invalid PTY asset path");
		fs.mkdirSync(path.dirname(target), { recursive: true });
		fs.writeFileSync(target, Buffer.from(contents, "base64"), { flag: "wx", mode: 0o600 });
	}
	const entry = path.join(directory, "lib", "index.js");
	materialized.set(architecture, entry);
	return entry;
}
