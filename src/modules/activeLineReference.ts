import type { Command, Editor, EditorPosition } from "obsidian";
import { isAbsolute, join } from "node:path";

export interface FileLineReference {
	filePath: string;
	lineStart: number;
	lineEnd: number;
}

export type ReferenceDelivery = "bridge" | "mention" | "text" | false;

export interface ActiveLineReferenceTarget {
	addFileReference(reference: FileLineReference): ReferenceDelivery;
}

export function absoluteLineReference(reference: FileLineReference, vaultRoot: string): FileLineReference {
	return { ...reference, filePath: isAbsolute(reference.filePath) ? reference.filePath : join(vaultRoot, reference.filePath) };
}

/** Obsidian positions are zero-based; an end at column zero excludes that line. */
export function captureLineReference(filePath: string, from: EditorPosition, to: EditorPosition): FileLineReference {
	const endLine = to.line > from.line && to.ch === 0 ? to.line - 1 : to.line;
	return { filePath, lineStart: from.line + 1, lineEnd: endLine + 1 };
}

export function deliverLineReference(
	reference: FileLineReference,
	context: {
		ready: boolean;
		notify?: (reference: FileLineReference) => boolean;
		paste: (text: string) => void;
	},
): ReferenceDelivery {
	if (!context.ready) return false;
	if (context.notify?.(reference)) return "bridge";
	const range = reference.lineStart === reference.lineEnd
		? String(reference.lineStart)
		: `${reference.lineStart}-${reference.lineEnd}`;
	// Both v1 and v2 autocomplete parse #5-9. #L5-9 is not accepted by the TUI.
	// Whitespace ends an autocomplete query, so preserve these paths as explicit
	// text instead of creating an attachment that points to the wrong note.
	if (/[\s@\x00-\x1f\x7f]/.test(reference.filePath)) {
		context.paste(` File ${JSON.stringify(reference.filePath)} (lines ${range}) `);
		return "text";
	}
	context.paste(` @${reference.filePath}#${range}`);
	return "mention";
}

export function activeLineReferenceCommand(context: {
	findTerminal: () => ActiveLineReferenceTarget | null;
	revealTerminal: () => Promise<void>;
	notice: (message: string) => void;
}): Command {
	return {
		id: "reference-active-line",
		name: "Add active line or selection to terminal",
		editorCheckCallback: (checking, editor: Editor, view) => {
			const file = view.file;
			if (!file || file.extension !== "md") return false;
			if (checking) return true;
			// Capture and deliver before reveal can change the active editor/session.
			const reference = captureLineReference(file.path, editor.getCursor("from"), editor.getCursor("to"));
			const delivered = context.findTerminal()?.addFileReference(reference) ?? false;
			if (!delivered) {
				context.notice("Open or restart the OpenCode terminal before adding a line reference.");
				return true;
			}
			if (delivered === "mention") context.notice("Confirm the file suggestion in OpenCode to attach the line reference.");
			if (delivered === "text") context.notice("Added the file path and line range as text. The editor bridge is unavailable for this path.");
			void context.revealTerminal().catch(() => context.notice("Added the line reference, but could not reveal the OpenCode terminal."));
			return true;
		},
	};
}
