import type { PanelMode } from "../settings";

export function terminalChromeClasses(mode: PanelMode): string[] {
	if (mode === "bottom") {
		return ["opencode-terminal-container", "opencode-terminal-bottom-container"];
	}
	return ["opencode-terminal-container"];
}
