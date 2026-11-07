import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import path from "node:path";

test("embedded Windows runtimes contain the pinned, unmodified node-pty distributions", () => {
	assert.equal(JSON.parse(readFileSync("node_modules/node-pty/package.json", "utf8")).version, "1.1.0");
	for (const [arch, suffix] of [["x64", "X64"], ["arm64", "Arm64"]]) {
		const source = readFileSync(`src/pty/windowsNodePty${suffix}.ts`, "utf8");
		const encoded = source.match(/= "([A-Za-z0-9+/=]+)";/)?.[1];
		assert.ok(encoded, `Missing ${arch} payload`);
		const files = JSON.parse(gunzipSync(Buffer.from(encoded, "base64")).toString());
		for (const required of ["LICENSE", "lib/index.js", "lib/windowsPtyAgent.js", "lib/worker/conoutSocketWorker.js",
			`prebuilds/win32-${arch}/conpty.node`, `prebuilds/win32-${arch}/conpty/conpty.dll`, `prebuilds/win32-${arch}/conpty/OpenConsole.exe`]) {
			assert.ok(files[required], `Missing runtime asset ${required}`);
		}
		for (const [relative, encodedFile] of Object.entries(files)) {
			assert.ok(!path.isAbsolute(relative) && !relative.split(/[\\/]/).includes(".."), `Unsafe runtime path: ${relative}`);
			assert.deepEqual(Buffer.from(encodedFile, "base64"), readFileSync(path.join("node_modules/node-pty", relative)), `Stale or altered ${arch} asset: ${relative}`);
		}
	}
});
