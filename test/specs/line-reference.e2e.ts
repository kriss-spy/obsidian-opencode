import * as path from "node:path";
import { browser, expect } from "@wdio/globals";
import { WebSocket } from "ws";

const stub = path.resolve(`test/fixtures/opencode-stub${process.platform === "win32" ? ".cmd" : ""}`);

describe("[issue #46] active note line reference command", function () {
	before(async function () {
		await browser.execute(async (executable: string) => {
			const app = (window as any).app;
			const plugin = app.plugins.plugins.opencode;
			plugin.settings.opencodePath = executable;
			plugin.settings.defaultWorkingDirectory = "";
			await plugin.saveSettings();
			await plugin.activateTerminalView();
		}, stub);
		await browser.waitUntil(() => browser.execute(() => {
			const view = (window as any).app.workspace.getLeavesOfType("opencode-terminal")[0]?.view;
			return !!view?.ptySession.getStdin() && (view?.editorServer?.port ?? 0) > 0;
		}), { timeoutMsg: "Embedded terminal did not start" });
	});

	async function selectNote(filePath: string, range = false): Promise<string> {
		return browser.execute(async (notePath: string, selected: boolean) => {
			const app = (window as any).app;
			const leaf = app.workspace.getLeaf(false);
			await leaf.openFile(app.vault.getAbstractFileByPath(notePath));
			app.workspace.setActiveLeaf(leaf, { focus: true });
			if (selected) leaf.view.editor.setSelection({ line: 2, ch: 2 }, { line: 4, ch: 0 });
			else leaf.view.editor.setCursor({ line: 2, ch: 1 });
			return app.plugins.plugins.opencode.vaultRoot;
		}, filePath, range);
	}

	it("delivers the active cursor and selection ranges over the private editor bridge", async function () {
		const port = await browser.execute(() => (window as any).app.workspace.getLeavesOfType("opencode-terminal")[0].view.editorServer.port);
		const socket = new WebSocket(`ws://127.0.0.1:${port}`);
		await new Promise<void>((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
		try {
			for (const selected of [false, true]) {
				const root = await selectNote("Line reference 笔记.md", selected);
				const message = new Promise<string>((resolve, reject) => {
					const timer = setTimeout(() => reject(new Error("Line reference was not delivered")), 5_000);
					socket.once("message", (data) => { clearTimeout(timer); resolve(data.toString()); });
				});
				await browser.executeObsidianCommand("opencode:reference-active-line");
				expect(JSON.parse(await message)).toMatchObject({
					method: "at_mentioned",
					params: { filePath: path.join(root, "Line reference 笔记.md"), lineStart: 3, lineEnd: selected ? 4 : 3 },
				});
			}
		} finally {
			await new Promise<void>((resolve) => { socket.once("close", () => resolve()); socket.close(); });
		}
	});

	it("pastes an ordered, unsubmitted fallback and accurately quotes a path with spaces", async function () {
		for (const note of ["Smoke.md", "Line reference 笔记.md"]) {
			const root = await selectNote(note);
			await browser.execute(() => {
				const view = (window as any).app.workspace.getLeavesOfType("opencode-terminal")[0].view;
				view.referenceTestData = [];
				view.referenceTestSubscription = view.terminal.onData((data: string) => view.referenceTestData.push(data));
			});
			try {
				await browser.executeObsidianCommand("opencode:reference-active-line");
				await browser.waitUntil(() => browser.execute(() => (window as any).app.workspace.getLeavesOfType("opencode-terminal")[0].view.referenceTestData.length > 0));
				const data = await browser.execute(() => (window as any).app.workspace.getLeavesOfType("opencode-terminal")[0].view.referenceTestData.join(""));
				const absolute = path.join(root, note);
				expect(data).toContain(note === "Smoke.md" ? ` @${absolute}#3` : ` File ${JSON.stringify(absolute)} (lines 3) `);
				expect(data).not.toContain("\r");
				expect(data).not.toContain("\n");
				expect(data).not.toContain("\t");
			} finally {
				await browser.execute(() => (window as any).app.workspace.getLeavesOfType("opencode-terminal")[0].view.referenceTestSubscription.dispose());
			}
		}
	});
});
