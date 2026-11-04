import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const assetNames = ["main.js", "manifest.json", "styles.css"];
const readJson = file => JSON.parse(readFileSync(file, "utf8"));

async function getPublic(url, fetchImpl, headers) {
	let response;
	for (let attempt = 0; attempt < 3; attempt++) {
		try {
			response = await fetchImpl(url, { signal: AbortSignal.timeout(30_000), ...(headers ? { headers } : {}) });
			if (response.status !== 429 && response.status < 500) break;
		} catch (error) {
			if (attempt === 2) throw error;
		}
	}
	if (!response?.ok) throw new Error(`Public release request failed (${response?.status ?? "network"}): ${url}`);
	return response;
}

export async function checkPublishedRelease({ root = process.cwd(), repository, fetchImpl = fetch, apiToken } = {}) {
	if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? "")) throw new Error("A GitHub owner/repository is required");
	const manifest = readJson(path.join(root, "manifest.json"));
	const version = manifest.version;
	if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("Stable main requires an x.y.z version");
	const pkg = readJson(path.join(root, "package.json"));
	const lock = readJson(path.join(root, "package-lock.json"));
	if ([pkg.version, lock.version, lock.packages?.[""]?.version].some(value => value !== version)) {
		throw new Error("Stable package, lockfile and manifest versions differ");
	}
	if (readJson(path.join(root, "versions.json"))[version] !== manifest.minAppVersion) {
		throw new Error("Stable compatibility mapping differs from the manifest");
	}
	// Authenticated metadata avoids shared-runner anonymous API limits. Draft flags
	// remain mandatory, and all asset downloads below deliberately omit credentials.
	const apiHeaders = apiToken ? { Authorization: `Bearer ${apiToken}` } : undefined;
	const release = await (await getPublic(`https://api.github.com/repos/${repository}/releases/tags/${version}`, fetchImpl, apiHeaders)).json();
	if (release.draft !== false || release.prerelease !== false || !release.published_at || release.tag_name !== version) {
		throw new Error(`Main must reference a published stable release: ${version}`);
	}
	const hashes = {};
	for (const name of assetNames) {
		const asset = release.assets?.find(asset => asset.name === name);
		if (!asset || asset.state !== "uploaded" || !(asset.size > 0)) throw new Error(`Missing public release asset: ${name}`);
		const url = `https://github.com/${repository}/releases/download/${version}/${name}`;
		const content = Buffer.from(await (await getPublic(url, fetchImpl)).arrayBuffer());
		const local = readFileSync(path.join(root, name));
		if (!content.equals(local)) throw new Error(`Stable distribution differs from public release: ${name}`);
		hashes[name] = createHash("sha256").update(content).digest("hex");
		if (asset.digest && asset.digest !== `sha256:${hashes[name]}`) throw new Error(`Public asset digest differs: ${name}`);
	}
	// Infrastructure may advance on main; runtime source must remain at the public tag.
	try {
		execFileSync("git", ["diff", "--quiet", `refs/tags/${version}`, "--", "src", "esbuild.config.mjs"], { cwd: root });
		const releasedPackage = JSON.parse(execFileSync("git", ["show", `refs/tags/${version}:package.json`], { cwd: root, encoding: "utf8" }));
		if (JSON.stringify(pkg.dependencies) !== JSON.stringify(releasedPackage.dependencies)) throw new Error("Runtime dependencies differ");
	} catch (error) {
		throw new Error(`Stable runtime source/dependencies must match tag ${version}`, { cause: error });
	}
	return { version, repository, sha256: hashes };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	console.log(JSON.stringify(await checkPublishedRelease({ repository: process.argv[2] ?? process.env.GITHUB_REPOSITORY,
		apiToken: process.env.GITHUB_TOKEN }), null, 2));
}
