import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { installVault } from "../install-vault.mjs";

test("vault install verifies assets, preserves settings, and backs up repeated installs", () => {
	const root = mkdtempSync(path.join(tmpdir(), "install vault "));
	try {
		const source = path.join(root, "source"), vault = path.join(root, "vault with spaces");
		mkdirSync(source); mkdirSync(vault);
		writeFileSync(path.join(source, "manifest.json"), JSON.stringify({ id: "fixture-plugin" }));
		writeFileSync(path.join(source, "main.js"), "first build");
		writeFileSync(path.join(source, "styles.css"), "body {}");
		const first = installVault(source, vault);
		assert.equal(first.backup, undefined);
		writeFileSync(path.join(first.target, "data.json"), "settings");
		writeFileSync(path.join(source, "main.js"), "second build");
		const second = installVault(source, vault);
		assert.equal(readFileSync(path.join(second.backup, "main.js"), "utf8"), "first build");
		assert.equal(readFileSync(path.join(second.backup, "data.json"), "utf8"), "settings");
		assert.equal(readFileSync(path.join(second.target, "data.json"), "utf8"), "settings");
		for (const name of ["main.js", "manifest.json", "styles.css"]) {
			assert.deepEqual(readFileSync(path.join(second.target, name)), readFileSync(path.join(source, name)));
		}
		assert.notEqual(installVault(source, vault).backup, second.backup);
		rmSync(path.join(source, "main.js"));
		assert.throws(() => installVault(source, vault), /ENOENT/);
		assert.equal(readFileSync(path.join(second.target, "main.js"), "utf8"), "second build");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("vault CLI requires an explicit path", () => {
	const result = spawnSync(process.execPath, ["scripts/install-vault.mjs"], { encoding: "utf8" });
	assert.equal(result.status, 1);
	assert.match(result.stderr, /--vault <path>/);
});
