export interface OpencodePluginSettings {
	opencodePath: string;
	defaultWorkingDirectory: string;
	terminalFontSize: number;
	terminalFontFamily: string;
	newSessionArgs: string;
}

export const DEFAULT_SETTINGS: OpencodePluginSettings = {
	opencodePath: "opencode",
	defaultWorkingDirectory: "",
	terminalFontSize: 14,
	terminalFontFamily: "monospace",
	newSessionArgs: "",
};
