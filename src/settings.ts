import type { EnvironmentVariables } from "./utils/environment";

export interface OpencodePluginSettings {
	opencodePath: string;
	defaultWorkingDirectory: string;
	environmentVariables: EnvironmentVariables;
	terminalFontSize: number;
	terminalFontFamily: string;
	newSessionArgs: string;
}

export const DEFAULT_SETTINGS: OpencodePluginSettings = {
	opencodePath: "opencode",
	defaultWorkingDirectory: "",
	environmentVariables: {},
	terminalFontSize: 14,
	terminalFontFamily: "monospace",
	newSessionArgs: "",
};
