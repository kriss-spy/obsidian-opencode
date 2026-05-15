export interface OpencodePluginSettings {
	opencodePath: string;
	defaultWorkingDirectory: string;
	terminalFontSize: number;
	terminalFontFamily: string;
	terminalTheme: "dark" | "light";
	autoRestoreSessions: boolean;
	newSessionArgs: string;
}

export const DEFAULT_SETTINGS: OpencodePluginSettings = {
	opencodePath: "opencode",
	defaultWorkingDirectory: "",
	terminalFontSize: 14,
	terminalFontFamily: "monospace",
	terminalTheme: "dark",
	autoRestoreSessions: true,
	newSessionArgs: "",
};
