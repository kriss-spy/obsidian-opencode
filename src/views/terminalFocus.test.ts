import { describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => ({ ItemView: class {}, Notice: class {}, WorkspaceLeaf: class {} }));
vi.mock('@xterm/xterm', () => ({ Terminal: class {} }));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class {} }));
vi.mock('@xterm/addon-web-links', () => ({ WebLinksAddon: class {} }));
vi.mock('@xterm/addon-canvas', () => ({ CanvasAddon: class {} }));
vi.mock('@xterm/addon-webgl', () => ({ WebglAddon: class {} }));
vi.mock('@xterm/addon-image', () => ({ ImageAddon: class {} }));
import { OpencodeTerminalView } from './opencodeTerminalView';

function focusFixture() {
	const fixture = {
		closing: false,
		terminal: { focus: vi.fn() },
		container: { isConnected: true, clientWidth: 640, clientHeight: 480 },
		app: { workspace: { getActiveViewOfType: vi.fn() } },
	};
	fixture.app.workspace.getActiveViewOfType.mockReturnValue(fixture);
	return {
		fixture,
		focus: () => OpencodeTerminalView.prototype.focusTerminal.call(fixture as unknown as OpencodeTerminalView),
	};
}

describe('terminal input focus', () => {
	it('focuses xterm in the revealed active view', () => {
		const { fixture, focus } = focusFixture();
		focus();
		expect(fixture.terminal.focus).toHaveBeenCalledOnce();
	});

	it('does not take focus back from a note while reveal is finishing', () => {
		const { fixture, focus } = focusFixture();
		fixture.app.workspace.getActiveViewOfType.mockReturnValue(null);
		focus();
		expect(fixture.terminal.focus).not.toHaveBeenCalled();
	});

	it.each(['closing', 'detached', 'collapsed', 'hidden'] as const)('does not focus a %s view', state => {
		const { fixture, focus } = focusFixture();
		if (state === 'closing') fixture.closing = true;
		if (state === 'detached') fixture.container.isConnected = false;
		if (state === 'collapsed') fixture.container.clientWidth = 0;
		if (state === 'hidden') fixture.container.clientHeight = 0;
		focus();
		expect(fixture.terminal.focus).not.toHaveBeenCalled();
	});
});
