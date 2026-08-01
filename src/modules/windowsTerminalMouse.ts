interface TerminalBufferLine {
	translateToString(trimRight?: boolean): string;
}

interface TerminalBuffer {
	length: number;
	viewportY: number;
	getLine(index: number): TerminalBufferLine | undefined;
}

export const CLEAR_PICKER_QUERY = "\x7f".repeat(200);

export function isOpenCodePicker(buffer: TerminalBuffer): boolean {
	for (let index = 0; index < buffer.length; index++) {
		const line = buffer.getLine(index)?.translateToString(true).trim() ?? "";
		if ((line.startsWith("Sessions") || line.startsWith("Select ")) && line.includes("esc")) return true;
	}
	return false;
}

export function pickerTargetAtRow(buffer: TerminalBuffer, visibleRow: number): string {
	return buffer.getLine(buffer.viewportY + visibleRow)
		?.translateToString(true)
		.replace(/[●┃█▀╹]/g, " ")
		.trim()
		.replace(/\s+/g, " ") ?? "";
}
