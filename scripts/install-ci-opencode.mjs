import { execFileSync } from "node:child_process";
import { appendFileSync, chmodSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Extract the native package directly; no global install, launcher shim, or
// developer configuration is involved. npm verifies the registry tarball integrity.
const version = "2.1.4";
if (!["linux", "darwin", "win32"].includes(process.platform) || !["x64", "arm64"].includes(process.arch)) {
	throw new Error(`Unsupported CI platform: ${process.platform}/${process.arch}`);
}
if (!process.env.npm_execpath) throw new Error("Run with npm run ci:install-opencode");
const directory = mkdtempSync(path.join(process.env.RUNNER_TEMP ?? tmpdir(), "opencode-ci-"));
const platform = process.platform === "win32" ? "windows" : process.platform;
const spec = `@opencode/cli-${platform}-${process.arch}@${version}`;
const packed = JSON.parse(execFileSync(process.execPath, [process.env.npm_execpath,
	"pack", spec, "--pack-destination", directory, "--json"], { encoding: "utf8" }));
if (packed.length !== 1 || packed[0].version !== version) throw new Error("Unexpected OpenCode package");
execFileSync("tar", ["-xzf", path.join(directory, packed[0].filename), "-C", directory]);
const manifest = JSON.parse(readFileSync(path.join(directory, "package/package.json"), "utf8"));
if (manifest.version !== version) throw new Error("Unexpected extracted OpenCode version");
const executable = path.join(directory, "package/bin", process.platform === "win32" ? "opencode.exe" : "opencode");
if (process.platform !== "win32") chmodSync(executable, 0o755);
const actual = execFileSync(executable, ["--version"], { encoding: "utf8", timeout: 30_000 }).trim();
if (!/^(?:opencode\s+)?v?2\.1\.4$/i.test(actual)) throw new Error(`Unexpected OpenCode binary: ${actual}`);
console.log(`${process.platform}/${process.arch}: ${actual}\n${executable}`);
if (process.env.GITHUB_ENV) {
	appendFileSync(process.env.GITHUB_ENV, `OPENCODE_REAL_EXECUTABLE=${executable}\nOPENCODE_WINDOWS_EXECUTABLE=${executable}\n`);
}
