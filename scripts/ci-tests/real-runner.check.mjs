import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const runner = fileURLToPath(new URL("../run-real-opencode-tests.mjs", import.meta.url));
const commit = "a".repeat(40);
const passed = {
	status: "passed", platform: process.platform, commit, appVersion: "1.14.5", cliVersion: "opencode v2.1.4",
	checks: ["launch", "input", "resize", "close", "reopen", "cleanup"],
};
function invoke({ proof, stale = false, exit = 0 } = {}) {
	const directory = mkdtempSync(path.join(tmpdir(), "real runner contract "));
	try {
		const child = path.join(directory, "node_modules/@wdio/cli/bin/wdio.js");
		mkdirSync(path.dirname(child), { recursive: true });
		if (stale) {
			mkdirSync(path.join(directory, "test-results/obsidian/real-opencode"), { recursive: true });
			writeFileSync(path.join(directory, "test-results/obsidian/real-opencode/passed.json"), JSON.stringify(passed));
		}
		writeFileSync(child, `
			const fs = require("node:fs");
			const proof = ${JSON.stringify(proof ?? null)};
			if (proof) {
				fs.mkdirSync("test-results/obsidian/real-opencode", { recursive: true });
				fs.writeFileSync("test-results/obsidian/real-opencode/passed.json", JSON.stringify(proof));
			}
			process.exit(${exit});
		`);
		return spawnSync(process.execPath, [runner], {
			cwd: directory, env: { ...process.env, CI_EXPECTED_SHA: commit }, encoding: "utf8", timeout: 10_000,
		});
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}

test("an empty or skipped successful invocation cannot reuse an old passing result", () => {
	const result = invoke({ stale: true });
	assert.notEqual(result.status, 0);
	assert.match(result.stderr, /ENOENT/);
});
test("a failing app run cannot be rescued by a completion file", () => {
	assert.equal(invoke({ proof: passed, exit: 7 }).status, 7);
});
test("a complete passing native run is accepted", () => {
	const result = invoke({ proof: passed });
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /Mandatory real OpenCode checks completed/);
});
test("evidence from another platform is rejected", () => {
	assert.notEqual(invoke({ proof: { ...passed, platform: "wrong-platform" } }).status, 0);
});
test("evidence from another commit is rejected", () => {
	assert.notEqual(invoke({ proof: { ...passed, commit: "b".repeat(40) } }).status, 0);
});
test("missing lifecycle coverage is rejected", () => {
	const result = invoke({ proof: { ...passed, checks: passed.checks.filter(check => check !== "cleanup") } });
	assert.notEqual(result.status, 0);
	assert.match(result.stderr, /Missing mandatory real OpenCode check: cleanup/);
});
