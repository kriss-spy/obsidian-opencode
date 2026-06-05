import { EditorSuggest, Editor, EditorPosition, EditorSuggestTriggerInfo, EditorSuggestContext, TFile } from "obsidian";
import OpencodePlugin from "./main";

interface OpencodeSuggestion {
	label: string;
	description: string;
}

export class OpencodeEditorSuggest extends EditorSuggest<OpencodeSuggestion> {
	private plugin: OpencodePlugin;

	constructor(plugin: OpencodePlugin) {
		super(plugin.app);
		this.plugin = plugin;
	}

	onTrigger(cursor: EditorPosition, editor: Editor, file: TFile | null): EditorSuggestTriggerInfo | null {
		const line = editor.getLine(cursor.line);
		const textBeforeCursor = line.substring(0, cursor.ch);
		const match = textBeforeCursor.match(/@opencode\s(.*)$/);
		if (match) {
			return {
				start: { line: cursor.line, ch: cursor.ch - match[0].length },
				end: cursor,
				query: match[1],
			};
		}
		return null;
	}

	getSuggestions(context: EditorSuggestContext): OpencodeSuggestion[] {
		return [
			{
				label: "Send to OpenCode",
				description: context.query || "Type your prompt...",
			},
		];
	}

	renderSuggestion(suggestion: OpencodeSuggestion, el: HTMLElement): void {
		el.createEl("div", { cls: "opencode-suggest-title", text: suggestion.label });
		if (suggestion.description) {
			el.createEl("small", { cls: "opencode-suggest-desc", text: suggestion.description });
		}
	}

	selectSuggestion(suggestion: OpencodeSuggestion, evt: MouseEvent | KeyboardEvent): void {
		const context = this.context;
		if (!context) return;

		const { editor, start, end } = context;
		const fullLine = editor.getLine(start.line);
		const beforeTrigger = fullLine.substring(0, start.ch);
		const afterTrigger = fullLine.substring(end.ch);

		// Extract the prompt text (what was typed after @opencode)
		const promptText = fullLine.substring(start.ch, end.ch).replace(/^@opencode\s*/, "").trim();

		// Replace the @opencode line with just the prompt text (remove @opencode prefix)
		const replacement = beforeTrigger.trimEnd() + afterTrigger;
		editor.replaceRange(replacement, { line: start.line, ch: 0 }, { line: start.line, ch: fullLine.length });

		// Store the prompt and trigger a new session
		if (promptText) {
			this.plugin.pendingPrompt = promptText;
			void this.plugin.newSession();
		}

		this.close();
	}
}
