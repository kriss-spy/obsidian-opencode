export type PanelMode = "sidebar" | "bottom";

export interface OpencodePluginSettings {
	opencodePath: string;
	defaultWorkingDirectory: string;
	terminalFontSize: number;
	terminalFontFamily: string;
	newSessionArgs: string;
	panelMode: PanelMode;
}

export const DEFAULT_SETTINGS: OpencodePluginSettings = {
	opencodePath: "opencode",
	defaultWorkingDirectory: "",
	terminalFontSize: 14,
	terminalFontFamily: "monospace",
	newSessionArgs: "",
	panelMode: "sidebar",
};
