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

export type OpenCodeCliGeneration = "stable" | "v2";

export function identifyOpenCodeCli(helpOutput: string): OpenCodeCliGeneration | null {
	if (/OpenCode 2\.0 preview command line interface/i.test(helpOutput)) return "v2";
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
			fs.accessSync(candidate, fs.constants.X_OK);
			return candidate;
		} catch {
			continue;
		}
	}
	return null;
}

function nvmBinDirectories(homeDirectory: string, pathApi: typeof path.posix | typeof path.win32): string[] {
	const versionsDirectory = pathApi.join(homeDirectory, ".nvm", "versions", "node");
	try {
		const versions = fs.readdirSync(versionsDirectory, { withFileTypes: true, encoding: "utf8" });
		return versions
			.filter((entry) => entry.isDirectory())
			.sort((left, right) => right.name.localeCompare(left.name, undefined, { numeric: true }))
			.map((entry) => pathApi.join(versionsDirectory, entry.name, "bin"));
	} catch {
		return [];
	}
}

function nvmWindowsVersionDirectories(nvmHome: string, pathApi: typeof path.win32): string[] {
	try {
		const versions = fs.readdirSync(nvmHome, { withFileTypes: true, encoding: "utf8" });
		return versions
			.filter((entry) => entry.isDirectory())
			.sort((left, right) => right.name.localeCompare(left.name, undefined, { numeric: true }))
			.map((entry) => pathApi.join(nvmHome, entry.name));
	} catch {
		return [];
	}
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
	const executable = configuredExecutable === "~"
		? homeDirectory
		: configuredExecutable.startsWith("~/") || configuredExecutable.startsWith("~\\")
			? pathApi.join(homeDirectory, configuredExecutable.slice(2))
			: configuredExecutable || DEFAULT_EXECUTABLE;
	const names = executableNames(executable, platform, environment);

	if (isAbsoluteExecutablePath(executable, platform)) {
		return firstExecutable(names) ?? executable;
	}

	const environmentPath = environment.PATH || (platform === "win32" ? environment.Path : undefined) || "";
	const pathCandidates = environmentPath
		.split(pathApi.delimiter)
		.filter(Boolean)
		.flatMap((directory) => names.map((name) => pathApi.join(directory, name)));
	const fromPath = firstExecutable(pathCandidates);
	if (fromPath) return fromPath;

	const localDirectories = [
		...COMMON_BIN_DIRS.map((directory) => pathApi.join(homeDirectory, directory)),
		...(platform === "win32" && environment.NVM_SYMLINK ? [environment.NVM_SYMLINK] : []),
		...(platform === "win32"
			? environment.NVM_HOME
				? nvmWindowsVersionDirectories(environment.NVM_HOME, path.win32)
				: []
			: nvmBinDirectories(homeDirectory, path.posix)),
	];
	const localCandidates = localDirectories.flatMap((directory) =>
		names.map((name) => pathApi.join(directory, name))
	);
	return firstExecutable(localCandidates) ?? executable;
}
