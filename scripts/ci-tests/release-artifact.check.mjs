import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { assets, stageArtifact, verifyArtifact } from "../release-artifact.mjs";

test("packaged files retain their identity across transport and reject changed bytes or commits", () => {
	const root = mkdtempSync(path.join(tmpdir(), "release artifact "));
	try {
		const source = path.join(root, "source"), candidate = path.join(root, "candidate");
		mkdirSync(source);
		for (const name of assets) writeFileSync(path.join(source, name), `fixture ${name}\n`);
		const staged = stageArtifact(source, candidate, "a".repeat(40));
		for (const name of assets) assert.deepEqual(readFileSync(path.join(candidate, name)), readFileSync(path.join(source, name)));
		assert.deepEqual(verifyArtifact(candidate, staged.commit), staged);
		assert.throws(() => verifyArtifact(candidate, "b".repeat(40)), /commit mismatch/);
		for (const name of assets) {
			writeFileSync(path.join(candidate, name), "changed");
			assert.throws(() => verifyArtifact(candidate, staged.commit), /hash mismatch/);
			writeFileSync(path.join(candidate, name), readFileSync(path.join(source, name)));
		}
		rmSync(path.join(candidate, "styles.css"));
		assert.throws(() => verifyArtifact(candidate, staged.commit), /ENOENT/);
		writeFileSync(path.join(source, "styles.css"), "");
		assert.throws(() => stageArtifact(source, candidate, staged.commit), /Empty release asset/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
