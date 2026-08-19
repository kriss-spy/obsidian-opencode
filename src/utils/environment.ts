import * as os from "os";
import * as path from "path";

export type EnvironmentVariables = Record<string, string>;

const ENVIRONMENT_VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const COMMON_BIN_DIRS = [".opencode/bin", ".local/bin", "bin"] as const;

export function parseEnvironmentVariables(
	text: string,
	caseInsensitive = process.platform === "win32"
): EnvironmentVariables {
	const entries: Array<[string, string]> = [];
	const names = new Set<string>();

	for (const [index, line] of text.split(/\r?\n/).entries()) {
		if (!line.trim()) continue;
		const separator = line.indexOf("=");
		if (separator < 0) {
			throw new Error(`Line ${index + 1}: expected NAME=value`);
		}
		const name = line.slice(0, separator);
		if (!ENVIRONMENT_VARIABLE_NAME.test(name)) {
			throw new Error(`Line ${index + 1}: invalid environment variable name`);
		}
		const comparableName = caseInsensitive ? name.toLowerCase() : name;
		if (names.has(comparableName)) {
			throw new Error(`Line ${index + 1}: duplicate environment variable ${name}`);
		}
		names.add(comparableName);
		entries.push([name, line.slice(separator + 1)]);
	}

	return Object.fromEntries(entries);
}

export function serializeEnvironmentVariables(variables: EnvironmentVariables): string {
	return Object.entries(variables).map(([name, value]) => `${name}=${value}`).join("\n");
}

export function mergeEnvironmentVariables(
	inherited: NodeJS.ProcessEnv,
	configured: EnvironmentVariables,
	caseInsensitive = process.platform === "win32"
): NodeJS.ProcessEnv {
	const env = { ...inherited };
	for (const [name, value] of Object.entries(configured)) {
		if (caseInsensitive) {
			for (const inheritedName of Object.keys(env)) {
				if (inheritedName.toLowerCase() === name.toLowerCase()) delete env[inheritedName];
			}
		}
		env[name] = value;
	}
	return env;
}

export function createChildEnvironment(
	inherited: NodeJS.ProcessEnv,
	configured: EnvironmentVariables,
	platform = process.platform,
	homeDir = os.homedir()
): NodeJS.ProcessEnv {
	const caseInsensitive = platform === "win32";
	const isPathName = (name: string) => caseInsensitive ? name.toLowerCase() === "path" : name === "PATH";
	const env = mergeEnvironmentVariables(inherited, configured, caseInsensitive);
	const configuredPath = Object.keys(configured).find(isPathName);
	if (configuredPath) {
		if (caseInsensitive && configuredPath !== "PATH") {
			const configuredValue = env[configuredPath];
			for (const name of Object.keys(env)) {
				if (isPathName(name)) delete env[name];
			}
			env.PATH = configuredValue;
		}
		return env;
	}

	const inheritedPath = Object.entries(env).find(([name]) => isPathName(name))?.[1];
	for (const name of Object.keys(env)) {
		if (isPathName(name)) delete env[name];
	}
	const pathApi = platform === "win32" ? path.win32 : path.posix;
	const delimiter = pathApi.delimiter;
	const userDirs = COMMON_BIN_DIRS.map((directory) => pathApi.join(homeDir, directory));
	env.PATH = [...userDirs, ...(inheritedPath ?? "").split(delimiter)].filter(Boolean).join(delimiter);
	return env;
}

export function flatpakEnvironmentArgs(variables: EnvironmentVariables): string[] {
	return Object.entries(variables).map(([name, value]) => `--env=${name}=${value}`);
}
