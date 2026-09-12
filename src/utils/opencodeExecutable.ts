import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const DEFAULT_EXECUTABLE = "opencode";
const COMMON_BIN_DIRS = [".opencode/bin", ".local/bin", "bin"] as const;

export interface ExecutableResolutionOptions {
	platform?: NodeJS.Platform;
	environment?: NodeJS.ProcessEnv;
	homeDirectory?: string;
}

export type OpenCodeCliGeneration = "stable" | "v2-preview" | "v2";

export function identifyOpenCodeCli(helpOutput: string): OpenCodeCliGeneration | null {
	// Prefer the formal v2 signature. Preview remains a distinct fallback because
	// its session export command differs from the formal CLI.
	if (/\bOpenCode command line interface\b/i.test(helpOutput)) return "v2";
	if (/OpenCode 2\.0 preview command line interface/i.test(helpOutput)) return "v2-preview";
	if (/start opencode tui/i.test(helpOutput)) return "stable";
	return null;
}

export function isAbsoluteExecutablePath(executable: string, platform: NodeJS.Platform = process.platform): boolean {
	return (platform === "win32" ? path.win32 : path.posix).isAbsolute(executable);
}

function executableNames(executable: string, platform: NodeJS.Platform, environment: NodeJS.ProcessEnv): string[] {
	if (platform !== "win32" || path.win32.extname(executable)) return [executable];
	const extensions = (environment.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean);
	return extensions.map((extension) => `${executable}${extension}`);
}

function firstExecutable(candidates: string[]): string | null {
	for (const candidate of candidates) {
		try {
			if (!fs.statSync(candidate).isFile()) continue;
			fs.accessSync(candidate, fs.constants.X_OK);
			return candidate;
		} catch {
			continue;
		}
	}
	return null;
}

export function findExecutableOnPath(
	executable: string,
	options: Pick<ExecutableResolutionOptions, "platform" | "environment"> = {}
): string | null {
	const platform = options.platform ?? process.platform;
	const environment = options.environment ?? process.env;
	const pathApi = platform === "win32" ? path.win32 : path.posix;
	const names = executableNames(executable, platform, environment);
	if (isAbsoluteExecutablePath(executable, platform)) return firstExecutable(names);

	const environmentPath = environment.PATH || (platform === "win32" ? environment.Path : undefined) || "";
	const candidates = environmentPath
		.split(pathApi.delimiter)
		.filter(Boolean)
		.flatMap((directory) => names.map((name) => pathApi.join(directory, name)));
	return firstExecutable(candidates);
}

function versionDirectories(versionsDirectory: string, pathApi: typeof path.posix): string[] {
	try {
		const versions = fs.readdirSync(versionsDirectory, { withFileTypes: true, encoding: "utf8" });
		return versions
			.filter((entry) => entry.isDirectory())
			.sort((left, right) => right.name.localeCompare(left.name, undefined, { numeric: true }))
			.map((entry) => pathApi.join(versionsDirectory, entry.name));
	} catch {
		return [];
	}
}

function nvmBinDirectories(homeDirectory: string): string[] {
	const versionsDirectory = path.posix.join(homeDirectory, ".nvm", "versions", "node");
	return versionDirectories(versionsDirectory, path.posix)
		.map((directory) => path.posix.join(directory, "bin"));
}

export function resolveOpencodeExecutable(
	configuredPath: string,
	options: ExecutableResolutionOptions = {}
): string {
	const platform = options.platform ?? process.platform;
	const environment = options.environment ?? process.env;
	const pathApi = platform === "win32" ? path.win32 : path.posix;
	const homeDirectory = options.homeDirectory ?? os.homedir();
	const configuredExecutable = configuredPath.trim();
	const executable = configuredExecutable.startsWith("~/") || configuredExecutable.startsWith("~\\")
			? pathApi.join(homeDirectory, configuredExecutable.slice(2))
			: configuredExecutable || DEFAULT_EXECUTABLE;
	const names = executableNames(executable, platform, environment);

	if (isAbsoluteExecutablePath(executable, platform)) {
		return findExecutableOnPath(executable, { platform, environment }) ?? executable;
	}

	const fromPath = findExecutableOnPath(executable, { platform, environment });
	if (fromPath) return fromPath;

	const localDirectories = [
		...COMMON_BIN_DIRS.map((directory) => pathApi.join(homeDirectory, directory)),
		...(platform === "win32" && environment.NVM_SYMLINK ? [environment.NVM_SYMLINK] : []),
		...(platform === "win32"
			? environment.NVM_HOME
				? versionDirectories(environment.NVM_HOME, path.win32)
				: []
			: nvmBinDirectories(homeDirectory)),
	];
	const localCandidates = localDirectories.flatMap((directory) =>
		names.map((name) => pathApi.join(directory, name))
	);
	return firstExecutable(localCandidates) ?? executable;
}
