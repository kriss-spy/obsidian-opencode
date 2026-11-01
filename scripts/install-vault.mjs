import { createHash } from "node:crypto";
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const assets = ["main.js", "manifest.json", "styles.css"];
const hash = file => createHash("sha256").update(readFileSync(file)).digest("hex");

export function installVault(source, vault) {
	const manifest = JSON.parse(readFileSync(path.join(source, "manifest.json"), "utf8"));
	if (typeof manifest.id !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(manifest.id)) throw new Error("Invalid plugin id in manifest.json");
	const hashes = Object.fromEntries(assets.map(name => [name, hash(path.join(source, name))]));
	const vaultRoot = realpathSync(vault);
	if (!lstatSync(vaultRoot).isDirectory()) throw new Error("Vault must be an existing directory");
	const plugins = path.join(vaultRoot, ".obsidian", "plugins");
	const target = path.join(plugins, manifest.id);
	const backups = path.join(vaultRoot, ".obsidian", "plugin-backups");
	// Avoid installing through a redirected plugin folder or settings directory.
	for (const directory of [path.join(vaultRoot, ".obsidian"), plugins, target, backups]) {
		if (existsSync(directory) && (lstatSync(directory).isSymbolicLink() || !lstatSync(directory).isDirectory())) {
			throw new Error(`Expected a real directory: ${directory}`);
		}
	}
	mkdirSync(plugins, { recursive: true });
	let backup;
	if (existsSync(target)) {
		const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
		mkdirSync(backups, { recursive: true });
		backup = mkdtempSync(path.join(backups, `${manifest.id}-${timestamp}-`));
		cpSync(target, backup, { recursive: true, dereference: false });
		console.log(`Backed up ${target} to ${backup}`);
	}
	mkdirSync(target, { recursive: true });
	for (const name of assets) {
		const destination = path.join(target, name);
		if (existsSync(destination) && lstatSync(destination).isSymbolicLink()) {
			throw new Error(`Refusing to overwrite symbolic link: ${destination}`);
		}
		cpSync(path.join(source, name), destination);
		if (hash(destination) !== hashes[name]) throw new Error(`Installed hash mismatch: ${name}`);
		console.log(`Installed ${destination} sha256=${hashes[name]}`);
	}
	console.log("Installation verified. Reload the plugin in Obsidian to use this build.");
	return { target, backup, hashes };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	try {
		const args = process.argv.slice(2);
		if (args.length !== 2 || args[0] !== "--vault" || !args[1] || args[1].startsWith("--")) {
			throw new Error("Usage: npm run install:vault -- --vault <path> (run npm run build first)");
		}
		installVault(fileURLToPath(new URL("..", import.meta.url)), path.resolve(args[1]));
	} catch (error) {
		console.error(`Install failed: ${error.message}. Run npm run build before installing.`);
		process.exitCode = 1;
	}
}
