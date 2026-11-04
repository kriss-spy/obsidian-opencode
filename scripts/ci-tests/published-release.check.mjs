import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { checkPublishedRelease } from "../check-published-release.mjs";

function fixture() {
	const root = mkdtempSync(path.join(tmpdir(), "published-release-"));
	const write = (name, value) => writeFileSync(path.join(root, name), typeof value === "string" ? value : JSON.stringify(value));
	write("manifest.json", { version: "2.3.2", minAppVersion: "1.7.2" });
	write("package.json", { version: "2.3.2", dependencies: { example: "1.0.0" } });
	write("package-lock.json", { version: "2.3.2", packages: { "": { version: "2.3.2" } } });
	write("versions.json", { "2.3.2": "1.7.2" });
	write("main.js", "published bundle"); write("styles.css", "published styles");
	mkdirSync(path.join(root, "src")); write("src/main.ts", "published source");
	const git = args => execFileSync("git", args, { cwd: root, stdio: "ignore" });
	git(["init", "-q"]); git(["add", "."]);
	git(["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "Published"]);
	git(["tag", "2.3.2"]);
	const bytes = Object.fromEntries(["main.js", "manifest.json", "styles.css"].map(name => [name, readFileSync(path.join(root, name))]));
	const release = { tag_name: "2.3.2", draft: false, prerelease: false, published_at: "2026-10-25T00:00:00Z",
		assets: Object.entries(bytes).map(([name, value]) => ({ name, size: value.length, state: "uploaded" })) };
	const requests = [];
	const fetchImpl = async (url, options) => {
		requests.push({ url, options });
		return new Response(url.includes("api.github.com") ? JSON.stringify(release) : bytes[url.split("/").pop()]);
	};
	return { root, write, release, requests, check: extra => checkPublishedRelease({ root, repository: "example/plugin", fetchImpl, ...extra }),
		close: () => rmSync(root, { recursive: true, force: true }) };
}

test("stable guard accepts public assets and infrastructure changes without credentials", async () => {
	const f = fixture();
	try {
		f.write("new-ci-tool.mjs", "infrastructure");
		assert.equal((await f.check()).version, "2.3.2");
		assert.equal(f.requests.length, 4);
		for (const request of f.requests) assert.equal(request.options.headers, undefined);
	} finally { f.close(); }
});

test("stable guard rejects an unavailable public release even if a draft exists privately", async () => {
	const f = fixture();
	try { await assert.rejects(f.check({ fetchImpl: async () => new Response("Not found", { status: 404 }) }), /Public release request failed \(404\)/); }
	finally { f.close(); }
});

for (const [label, patch] of [["draft", { draft: true }], ["prerelease", { prerelease: true }], ["unpublished", { published_at: null }], ["wrong tag", { tag_name: "2.4.0" }]]) {
	test(`stable guard rejects ${label} metadata`, async () => {
		const f = fixture();
		try { Object.assign(f.release, patch); await assert.rejects(f.check(), /published stable release/); }
		finally { f.close(); }
	});
}

test("stable guard rejects missing public assets and changed distribution files", async () => {
	const f = fixture();
	try {
		const asset = f.release.assets.pop();
		await assert.rejects(f.check(), /Missing public release asset/);
		f.release.assets.push(asset); f.write("main.js", "unpublished bundle");
		await assert.rejects(f.check(), /distribution differs/);
	} finally { f.close(); }
});

test("stable guard rejects changed source or runtime dependencies under the published version", async () => {
	const f = fixture();
	try {
		f.write("src/main.ts", "unpublished source");
		await assert.rejects(f.check(), /runtime source\/dependencies/);
		f.write("src/main.ts", "published source");
		f.write("package.json", { version: "2.3.2", dependencies: { example: "2.0.0" } });
		await assert.rejects(f.check(), /runtime source\/dependencies/);
	} finally { f.close(); }
});

test("stable guard rejects inconsistent local versions and public asset digests", async () => {
	const f = fixture();
	try {
		f.write("versions.json", {}); await assert.rejects(f.check(), /compatibility mapping/);
		f.write("versions.json", { "2.3.2": "1.7.2" });
		f.release.assets[0].digest = `sha256:${"0".repeat(64)}`;
		await assert.rejects(f.check(), /digest differs/);
		f.write("package.json", { version: "2.4.0" });
		await assert.rejects(f.check(), /versions differ/);
	} finally { f.close(); }
});
