export type EnvironmentVariables = Record<string, string>;

const ENVIRONMENT_VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

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

export function flatpakEnvironmentArgs(variables: EnvironmentVariables): string[] {
	return Object.entries(variables).map(([name, value]) => `--env=${name}=${value}`);
}
