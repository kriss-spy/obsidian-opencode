import { describe, expect, it, vi } from "vitest";
import type { Editor, MarkdownView } from "obsidian";
import { join, parse } from "node:path";
import { absoluteLineReference, activeLineReferenceCommand, captureLineReference, deliverLineReference } from "./activeLineReference";

describe("active note line references", () => {
	it("converts the cursor and primary selection to inclusive one-based ranges", () => {
		expect(captureLineReference("笔记.md", { line: 4, ch: 3 }, { line: 4, ch: 3 }))
			.toEqual({ filePath: "笔记.md", lineStart: 5, lineEnd: 5 });
		expect(captureLineReference("a.md", { line: 2, ch: 8 }, { line: 6, ch: 0 }).lineEnd).toBe(6);
		expect(captureLineReference("a.md", { line: 2, ch: 8 }, { line: 6, ch: 1 }).lineEnd).toBe(7);
	});

	it("keeps an absolute outside-vault path and resolves notes against the vault", () => {
		const reference = { filePath: "folder/笔记.md", lineStart: 5, lineEnd: 9 };
		const root = parse(process.cwd()).root;
		const vault = join(root, "vault");
		const outside = join(root, "other", "笔记.md");
		expect(absoluteLineReference(reference, vault).filePath).toBe(join(vault, "folder", "笔记.md"));
		expect(absoluteLineReference({ ...reference, filePath: outside }, vault).filePath).toBe(outside);
	});

	it("uses exact bridge ranges for names with spaces and never also pastes", () => {
		const reference = { filePath: "/vault/my 笔记.md", lineStart: 5, lineEnd: 9 };
		const notify = vi.fn(() => true);
		const paste = vi.fn();
		expect(deliverLineReference(reference, { ready: true, notify, paste })).toBe("bridge");
		expect(notify).toHaveBeenCalledWith(reference);
		expect(paste).not.toHaveBeenCalled();
	});

	it("leaves the verified v1/v2 line mention for confirmation without submitting", () => {
		const paste = vi.fn();
		const notify = vi.fn(() => false);
		expect(deliverLineReference({ filePath: "/vault/笔记.md", lineStart: 5, lineEnd: 9 }, { ready: true, notify, paste })).toBe("mention");
		expect(paste).toHaveBeenCalledExactlyOnceWith(" @/vault/笔记.md#5-9");
	});

	it("formats one cursor line and falls back to quoted text for whitespace paths", () => {
		const paste = vi.fn();
		deliverLineReference({ filePath: "/vault/a.md", lineStart: 5, lineEnd: 5 }, { ready: true, paste });
		expect(paste).toHaveBeenLastCalledWith(" @/vault/a.md#5");
		expect(deliverLineReference({ filePath: "/vault/my 笔记.md", lineStart: 5, lineEnd: 9 }, { ready: true, paste })).toBe("text");
		expect(paste).toHaveBeenLastCalledWith(' File "/vault/my 笔记.md" (lines 5-9) ');
		expect(deliverLineReference({ filePath: "/vault/@note.md", lineStart: 5, lineEnd: 5 }, { ready: true, paste })).toBe("text");
		expect(paste).toHaveBeenLastCalledWith(' File "/vault/@note.md" (lines 5) ');
	});

	it("does not send to any transport when the embedded process is unavailable", () => {
		const notify = vi.fn(() => true);
		const paste = vi.fn();
		expect(deliverLineReference({ filePath: "a.md", lineStart: 1, lineEnd: 1 }, { ready: false, notify, paste })).toBe(false);
		expect(notify).not.toHaveBeenCalled();
		expect(paste).not.toHaveBeenCalled();
	});

	it("checks without side effects and captures editor context before reveal", () => {
		const addFileReference = vi.fn(() => "bridge" as const);
		const revealTerminal = vi.fn(async () => { file.path = "other.md"; });
		const findTerminal = vi.fn(() => ({ addFileReference }));
		const notice = vi.fn();
		const command = activeLineReferenceCommand({ findTerminal, revealTerminal, notice });
		const editor = { getCursor: vi.fn((side: string) => side === "from" ? { line: 2, ch: 3 } : { line: 4, ch: 0 }) } as unknown as Editor;
		const file = { path: "active.md", extension: "md" };
		const view = { file } as unknown as MarkdownView;
		expect(command.editorCheckCallback!(true, editor, view)).toBe(true);
		expect(findTerminal).not.toHaveBeenCalled();
		expect(editor.getCursor).not.toHaveBeenCalled();
		expect(command.editorCheckCallback!(false, editor, view)).toBe(true);
		expect(addFileReference).toHaveBeenCalledExactlyOnceWith({ filePath: "active.md", lineStart: 3, lineEnd: 4 });
		expect(revealTerminal).toHaveBeenCalledOnce();
		expect(notice).not.toHaveBeenCalled();
	});

	it("hides for non-Markdown contexts and reports a closed terminal without opening it", () => {
		const revealTerminal = vi.fn(async () => undefined);
		const notice = vi.fn();
		const command = activeLineReferenceCommand({ findTerminal: () => null, revealTerminal, notice });
		const editor = { getCursor: () => ({ line: 0, ch: 0 }) } as unknown as Editor;
		expect(command.editorCheckCallback!(true, editor, { file: null } as unknown as MarkdownView)).toBe(false);
		expect(command.editorCheckCallback!(true, editor, { file: { extension: "pdf" } } as unknown as MarkdownView)).toBe(false);
		command.editorCheckCallback!(false, editor, { file: { extension: "md", path: "a.md" } } as unknown as MarkdownView);
		expect(notice).toHaveBeenCalledWith("Open or restart the OpenCode terminal before adding a line reference.");
		expect(revealTerminal).not.toHaveBeenCalled();
	});
});
