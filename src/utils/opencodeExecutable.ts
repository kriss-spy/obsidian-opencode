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

export function resolveOpencodeExecutable(
	configuredPath: string,
	options: ExecutableResolutionOptions = {}
): string {
	const platform = options.platform ?? process.platform;
	const environment = options.environment ?? process.env;
	const pathApi = platform === "win32" ? path.win32 : path.posix;
	const executable = configuredPath.trim() || DEFAULT_EXECUTABLE;
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

	const homeDirectory = options.homeDirectory ?? os.homedir();
	const localCandidates = COMMON_BIN_DIRS.flatMap((directory) =>
		names.map((name) => pathApi.join(homeDirectory, directory, name))
	);
	return firstExecutable(localCandidates) ?? executable;
}
