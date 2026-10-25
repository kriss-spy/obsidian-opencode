import * as path from 'node:path';
import { browser, expect } from '@wdio/globals';

const command = 'opencode:toggle-terminal-tab-maximize';
const stub = path.resolve(`test/fixtures/opencode-stub${process.platform === 'win32' ? '.cmd' : ''}`);

async function geometry() {
	return browser.execute(() => {
		const view = (window as any).app.workspace.getLeavesOfType('opencode-terminal')[0].view;
		const rect = view.containerEl.getBoundingClientRect();
		return { width: rect.width, height: rect.height, cols: view.terminal.cols,
			pid: view.ptySession.ptyProcess.pid, maximized: view.isMaximized,
			focused: document.activeElement === view.terminal.textarea };
	});
}

describe('terminal tab maximize', () => {
	before(async () => {
		await browser.execute(async (executable: string) => {
			const app = (window as any).app;
			const plugin = app.plugins.plugins.opencode;
			plugin.settings.opencodePath = executable;
			await plugin.saveSettings();
			const leaf = app.workspace.getLeaf(false);
			await leaf.openFile(app.vault.getAbstractFileByPath('Smoke.md'));
		}, stub);
		await browser.executeObsidianCommand('opencode:open-terminal');
		await browser.waitUntil(() => browser.execute(() => {
			const view = (window as any).app.workspace.getLeavesOfType('opencode-terminal')[0]?.view;
			return !!view?.ptySession?.ptyProcess?.pid && view.terminal.cols > 0;
		}));
	});

	after(async () => {
		await browser.executeObsidianCommand('opencode:close-terminal');
	});

	it('resizes, preserves the running session, restores its pane, and cleans up on close', async () => {
		const original = await geometry();
		await browser.executeObsidianCommand(command);
		await browser.waitUntil(async () => {
			const current = await geometry();
			return current.maximized && current.width > original.width && current.cols > original.cols && current.focused;
		});
		expect((await geometry()).pid).toBe(original.pid);
		await browser.keys(['M', 'A', 'X', 'Enter']);
		await browser.waitUntil(() => browser.execute(() => {
			const buffer = (window as any).app.workspace.getLeavesOfType('opencode-terminal')[0].view.terminal.buffer.active;
			return Array.from({ length: buffer.length }, (_, i) => buffer.getLine(i)?.translateToString(true)).join('').includes('MAX');
		}));

		await browser.executeObsidianCommand(command);
		await browser.waitUntil(async () => {
			const current = await geometry();
			return !current.maximized && Math.abs(current.width - original.width) < 2 && current.cols === original.cols && current.focused;
		});
		expect((await geometry()).pid).toBe(original.pid);
		await browser.executeObsidianCommand(command);
		await browser.$('.opencode-terminal-restore').click();
		await browser.waitUntil(async () => !(await geometry()).maximized);
		await browser.executeObsidianCommand(command);
		await browser.executeObsidianCommand('opencode:close-terminal');
		await browser.waitUntil(() => browser.execute(() => !document.querySelector('.opencode-terminal-maximized')));
	});
});
