import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const assets = ["main.js", "manifest.json", "styles.css"];

export function inspectArtifact(directory) {
	return Object.fromEntries(assets.map(name => {
		const content = readFileSync(path.join(directory, name));
		if (!content.length) throw new Error(`Empty release asset: ${name}`);
		return [name, createHash("sha256").update(content).digest("hex")];
	}));
}

export function verifyArtifact(directory, expectedCommit) {
	const evidence = JSON.parse(readFileSync(path.join(directory, "artifact.json"), "utf8"));
	if (!evidence.commit || (expectedCommit && evidence.commit !== expectedCommit)) {
		throw new Error("Release artifact commit mismatch");
	}
	const actual = inspectArtifact(directory);
	for (const name of assets) {
		if (actual[name] !== evidence.sha256?.[name]) throw new Error(`Release artifact hash mismatch: ${name}`);
	}
	return evidence;
}

export function stageArtifact(source, destination, commit) {
	if (!commit) throw new Error("An exact source commit is required");
	// Read every source before writing so a missing/empty asset cannot produce evidence.
	const sha256 = inspectArtifact(source);
	mkdirSync(destination, { recursive: true });
	for (const name of assets) copyFileSync(path.join(source, name), path.join(destination, name));
	writeFileSync(path.join(destination, "artifact.json"), JSON.stringify({ commit, sha256 }, null, 2) + "\n");
	return verifyArtifact(destination, commit);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const [command, directory, commit] = process.argv.slice(2);
	if (!directory || !["stage", "verify"].includes(command)) {
		throw new Error("Usage: node scripts/release-artifact.mjs stage|verify DIRECTORY COMMIT");
	}
	console.log(JSON.stringify(command === "stage"
		? stageArtifact(process.cwd(), directory, commit)
		: verifyArtifact(directory, commit), null, 2));
}
