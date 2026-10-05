import * as path from 'node:path';
import { browser, expect } from '@wdio/globals';

const stubPath = path.resolve(`test/fixtures/opencode-stub${process.platform === 'win32' ? '.cmd' : ''}`);

async function waitForInputFocus(): Promise<void> {
	await browser.waitUntil(() => browser.execute(() => {
		const leaf = (window as any).app.workspace.getLeavesOfType('opencode-terminal')[0];
		return leaf?.view?.terminal?.textarea === document.activeElement;
	}), { timeoutMsg: 'Opening the terminal did not focus xterm input' });
}

async function focusNote(): Promise<void> {
	await browser.execute(async () => {
		const app = (window as any).app;
		const leaf = app.workspace.getLeavesOfType('markdown')[0] ?? app.workspace.getLeaf(false);
		await leaf.openFile(app.vault.getAbstractFileByPath('Smoke.md'));
		app.workspace.setActiveLeaf(leaf, { focus: true });
		leaf.view.editor.focus();
	});
}

async function terminalPid(): Promise<number | null> {
	return browser.execute(() => (window as any).app.workspace.getLeavesOfType('opencode-terminal')[0]
		?.view?.ptySession?.ptyProcess?.pid ?? null);
}

async function bufferText(): Promise<string> {
	return browser.execute(() => {
		const buffer = (window as any).app.workspace.getLeavesOfType('opencode-terminal')[0]?.view?.terminal?.buffer?.active;
		if (!buffer) return '';
		return Array.from({ length: buffer.length }, (_, index) => buffer.getLine(index)?.translateToString(true) ?? '').join('');
	});
}

async function waitForTerminalText(text: string): Promise<void> {
	try {
		await browser.waitUntil(async () => (await bufferText()).includes(text), {
			timeoutMsg: `Terminal did not render ${JSON.stringify(text)}`,
		});
	} catch (error) {
		const focus = await browser.execute(() => ({
			activeElement: document.activeElement?.className ?? null,
			activeLeafType: (window as any).app.workspace.activeLeaf?.view?.getViewType() ?? null,
		}));
		throw new Error(`${String(error)}\nPID: ${await terminalPid()}\nFocus: ${JSON.stringify(focus)}\nTerminal buffer:\n${await bufferText()}`);
	}
}

describe('[issue #57] terminal focus on explicit opening', function () {
	before(async () => {
		await browser.execute(async (executable: string) => {
			const plugin = (window as any).app.plugins.plugins.opencode;
			plugin.settings.opencodePath = executable;
			plugin.settings.defaultWorkingDirectory = '';
			await plugin.saveSettings();
		}, stubPath);
	});

	beforeEach(async () => {
		await browser.executeObsidianCommand('opencode:close-terminal');
		await browser.waitUntil(() => browser.execute(() =>
			(window as any).app.workspace.getLeavesOfType('opencode-terminal').length === 0));
		await focusNote();
	});

	after(async () => {
		await browser.executeObsidianCommand('opencode:close-terminal');
	});

	it('focuses new and existing terminals through command, ribbon, status, and sidebar expansion', async () => {
		await browser.executeObsidianCommand('opencode:open-terminal');
		await waitForInputFocus();
		await browser.waitUntil(async () => (await bufferText()).includes('OpenCode isolated test stub'));
		await browser.keys(['f', 'o', 'c', 'u', 's', 'Enter']);
		await browser.waitUntil(async () => (await bufferText()).includes('focus'));

		const leafId = await browser.execute(() => (window as any).app.workspace.getLeavesOfType('opencode-terminal')[0].id);
		await focusNote();
		await browser.executeObsidianCommand('opencode:open-terminal');
		await waitForInputFocus();
		await focusNote();
		await browser.$('[aria-label="Opencode terminal"]').click();
		await waitForInputFocus();
		await focusNote();
		await browser.$('.opencode-status').click();
		await waitForInputFocus();
		await browser.executeObsidianCommand('opencode:toggle-terminal-sidebar');
		await focusNote();
		await browser.executeObsidianCommand('opencode:toggle-terminal-sidebar');
		await waitForInputFocus();
		expect(await browser.execute(() => (window as any).app.workspace.getLeavesOfType('opencode-terminal').map((leaf: any) => leaf.id))).toEqual([leafId]);
	});

	it('focuses restarted, new, continued, and restored sessions', async () => {
		await browser.executeObsidianCommand('opencode:open-terminal');
		await waitForInputFocus();
		await browser.waitUntil(async () => (await bufferText()).includes('OpenCode isolated test stub'));
		for (const command of ['opencode:restart-terminal', 'opencode:new-session', 'opencode:continue-last-session']) {
			await focusNote();
			const previousPid = await terminalPid();
			await browser.executeObsidianCommand(command);
			await waitForInputFocus();
			await browser.waitUntil(async () => {
				const pid = await terminalPid();
				return pid !== null && pid !== previousPid && (await bufferText()).includes('OpenCode isolated test stub');
			}, { timeoutMsg: `${command} did not replace the terminal process` });
		}
		await focusNote();
		const previousPid = await terminalPid();
		await browser.execute(async () => {
			const plugin = (window as any).app.plugins.plugins.opencode;
			await plugin.openTerminalWithSession('fixture-session', plugin.vaultRoot);
		});
		await browser.waitUntil(async () => {
			const pid = await terminalPid();
			return pid !== null && pid !== previousPid;
		}, { timeoutMsg: 'Restore did not replace the terminal process' });
		await waitForTerminalText('ARGS:["-s","fixture-session"]');
		await waitForInputFocus();
		// The restored-session fixture deliberately leaves DEC graphics G0
		// enabled to exercise restart reset. Uppercase survives that charset.
		await browser.keys(['R', 'E', 'S', 'T', 'O', 'R', 'E', 'D', 'Enter']);
		await waitForTerminalText('INPUT:"RESTORED');
	});

	it('does not steal note focus after opening, collapsing, or closing', async () => {
		for (const action of ['note', 'collapse', 'close']) {
			await browser.executeObsidianCommand('opencode:open-terminal');
			await waitForInputFocus();
			if (action === 'collapse') await browser.executeObsidianCommand('opencode:toggle-terminal-sidebar');
			if (action === 'close') await browser.executeObsidianCommand('opencode:close-terminal');
			await focusNote();
			// Cross the old onOpen timer boundary while watching the actual editor.
			await browser.pause(750);
			expect(await browser.execute(() => document.activeElement?.classList.contains('cm-content'))).toBe(true);
		}
	});
});
