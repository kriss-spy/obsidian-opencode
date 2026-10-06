import { describe, it, expect, vi } from 'vitest';
import type { Workspace } from 'obsidian';
import { ViewCoordinator } from './viewCoordinator';

interface MockLeaf {
	id: string;
	type?: string;
	view: { focusTerminal: ReturnType<typeof vi.fn>; containerEl: { contains: ReturnType<typeof vi.fn>; isConnected: boolean; clientWidth: number; clientHeight: number } };
	setViewState: ReturnType<typeof vi.fn>;
	detach: ReturnType<typeof vi.fn>;
}

interface MockWorkspace {
	activeLeaf: MockLeaf | null;
	getActiveViewOfType(): { leaf: MockLeaf } | null;
	containerEl: { ownerDocument: { activeElement: object | null } };
	setActiveLeaf: ReturnType<typeof vi.fn>;
	getLeavesOfType: ReturnType<typeof vi.fn>;
	getRightLeaf: ReturnType<typeof vi.fn>;
	revealLeaf: ReturnType<typeof vi.fn>;
	rightSplit: {
		collapsed: boolean;
		toggle: ReturnType<typeof vi.fn>;
	};
	_leaves: MockLeaf[];
}

const createMockLeaf = (id: string): MockLeaf => ({
	id,
	view: { focusTerminal: vi.fn(), containerEl: { contains: vi.fn().mockReturnValue(false), isConnected: true, clientWidth: 640, clientHeight: 480 } },
	setViewState: vi.fn().mockResolvedValue(undefined),
	detach: vi.fn().mockResolvedValue(undefined),
});

const createMockWorkspace = (): MockWorkspace => {
	const leaves: MockLeaf[] = [];
	return {
		activeLeaf: null,
		getActiveViewOfType() { return this.activeLeaf ? { leaf: this.activeLeaf } : null; },
		containerEl: { ownerDocument: { activeElement: null } },
		setActiveLeaf: vi.fn(),
		getLeavesOfType: vi.fn((type: string): MockLeaf[] => leaves.filter(leaf => leaf.type === type)),
		getRightLeaf: vi.fn(() => {
			const leaf = createMockLeaf('right-leaf');
			leaf.setViewState.mockImplementation((state: { type: string }) => {
				leaf.type = state.type;
				leaves.push(leaf);
			});
			return leaf;
		}),
		revealLeaf: vi.fn(),
		rightSplit: {
			collapsed: false,
			toggle: vi.fn(),
		},
		_leaves: leaves,
	};
};

describe('ViewCoordinator', () => {
	it('should activate terminal view by creating a new leaf if none exists', async () => {
		const workspace = createMockWorkspace();
		const coordinator = new ViewCoordinator(workspace as unknown as Workspace, {
			terminalViewType: 'opencode-terminal',
			conversationViewType: 'opencode-conversations',
		});

		await coordinator.activateTerminalView();

		expect(workspace.getRightLeaf).toHaveBeenCalledWith(false);
		expect(workspace.revealLeaf).toHaveBeenCalled();
	});

	it('should activate terminal view by reusing existing leaf', async () => {
		const existingLeaf = { ...createMockLeaf('existing'), type: 'opencode-terminal' };
		const workspace = createMockWorkspace();
		workspace._leaves.push(existingLeaf);

		const coordinator = new ViewCoordinator(workspace as unknown as Workspace, {
			terminalViewType: 'opencode-terminal',
			conversationViewType: 'opencode-conversations',
		});

		await coordinator.activateTerminalView();

		expect(workspace.getRightLeaf).not.toHaveBeenCalled();
		expect(workspace.revealLeaf).toHaveBeenCalledWith(existingLeaf);
		expect(existingLeaf.view.focusTerminal).toHaveBeenCalledOnce();
	});

	it('should activate conversation view', async () => {
		const workspace = createMockWorkspace();
		const coordinator = new ViewCoordinator(workspace as unknown as Workspace, {
			terminalViewType: 'opencode-terminal',
			conversationViewType: 'opencode-conversations',
		});

		await coordinator.activateConversationView();

		expect(workspace.getRightLeaf).toHaveBeenCalledWith(false);
		expect(workspace.revealLeaf).toHaveBeenCalled();
	});

	it('should toggle sidebar when not collapsed', async () => {
		const workspace = createMockWorkspace();
		workspace.rightSplit.collapsed = false;
		const coordinator = new ViewCoordinator(workspace as unknown as Workspace, {
			terminalViewType: 'opencode-terminal',
			conversationViewType: 'opencode-conversations',
		});

		await coordinator.toggleTerminalSidebar();

		expect(workspace.rightSplit.toggle).toHaveBeenCalled();
	});

	it('should open terminal when sidebar is collapsed', async () => {
		const workspace = createMockWorkspace();
		workspace.rightSplit.collapsed = true;
		const coordinator = new ViewCoordinator(workspace as unknown as Workspace, {
			terminalViewType: 'opencode-terminal',
			conversationViewType: 'opencode-conversations',
		});

		await coordinator.toggleTerminalSidebar();

		expect(workspace.getRightLeaf).toHaveBeenCalledWith(false);
		expect(workspace.revealLeaf).toHaveBeenCalled();
	});

	it('should restart existing terminal view', async () => {
		const existingLeaf = { ...createMockLeaf('existing'), type: 'opencode-terminal' };
		const workspace = createMockWorkspace();
		workspace._leaves.push(existingLeaf);

		const coordinator = new ViewCoordinator(workspace as unknown as Workspace, {
			terminalViewType: 'opencode-terminal',
			conversationViewType: 'opencode-conversations',
		});

		const restartFn = vi.fn();
		await coordinator.openOrRestartTerminal(restartFn);

		expect(restartFn).toHaveBeenCalled();
		expect(workspace.revealLeaf).toHaveBeenCalledWith(existingLeaf);
		expect(existingLeaf.view.focusTerminal).toHaveBeenCalledOnce();
	});

	it('closes every OpenCode terminal leaf without touching other views', async () => {
		const firstTerminal = { ...createMockLeaf('terminal-1'), type: 'opencode-terminal' };
		const secondTerminal = { ...createMockLeaf('terminal-2'), type: 'opencode-terminal' };
		const conversation = { ...createMockLeaf('conversation'), type: 'opencode-conversations' };
		const workspace = createMockWorkspace();
		workspace._leaves.push(firstTerminal, secondTerminal, conversation);
		const coordinator = new ViewCoordinator(workspace as unknown as Workspace, {
			terminalViewType: 'opencode-terminal',
			conversationViewType: 'opencode-conversations',
		});

		await coordinator.closeTerminal();

		expect(firstTerminal.detach).toHaveBeenCalledOnce();
		expect(secondTerminal.detach).toHaveBeenCalledOnce();
		expect(conversation.detach).not.toHaveBeenCalled();
	});
	it('focuses only after the requested terminal has finished being revealed', async () => {
		const workspace = createMockWorkspace();
		const terminal = { ...createMockLeaf('existing'), type: 'opencode-terminal' };
		workspace._leaves.push(terminal);
		let finishReveal!: () => void;
		workspace.revealLeaf.mockReturnValue(new Promise<void>(resolve => { finishReveal = resolve; }));
		const coordinator = new ViewCoordinator(workspace as unknown as Workspace, {
			terminalViewType: 'opencode-terminal', conversationViewType: 'opencode-conversations',
		});

		const opening = coordinator.activateTerminalView();
		expect(terminal.view.focusTerminal).not.toHaveBeenCalled();
		finishReveal();
		await opening;
		expect(terminal.view.focusTerminal).toHaveBeenCalledOnce();
	});

	it('focuses an expanded terminal but never a collapsed terminal or conversation', async () => {
		const workspace = createMockWorkspace();
		const terminal = { ...createMockLeaf('terminal'), type: 'opencode-terminal' };
		const conversation = { ...createMockLeaf('conversation'), type: 'opencode-conversations' };
		workspace._leaves.push(terminal, conversation);
		const coordinator = new ViewCoordinator(workspace as unknown as Workspace, {
			terminalViewType: 'opencode-terminal', conversationViewType: 'opencode-conversations',
		});
		await coordinator.toggleTerminalSidebar();
		expect(terminal.view.focusTerminal).not.toHaveBeenCalled();
		workspace.rightSplit.collapsed = true;
		await coordinator.toggleTerminalSidebar();
		expect(terminal.view.focusTerminal).toHaveBeenCalledOnce();
		await coordinator.activateConversationView();
		expect(conversation.view.focusTerminal).not.toHaveBeenCalled();
	});

	it('never reveals or focuses again when a slow restart finishes', async () => {
		const workspace = createMockWorkspace();
		const terminal = { ...createMockLeaf('terminal'), type: 'opencode-terminal' };
		workspace._leaves.push(terminal);
		const coordinator = new ViewCoordinator(workspace as unknown as Workspace, {
			terminalViewType: 'opencode-terminal', conversationViewType: 'opencode-conversations',
		});
		let finishRestart!: () => void;
		const restart = vi.fn(() => new Promise<void>(resolve => { finishRestart = resolve; }));
		const restarting = coordinator.openOrRestartTerminal(restart);
		await vi.waitFor(() => expect(restart).toHaveBeenCalledOnce());
		expect(terminal.view.focusTerminal).toHaveBeenCalledOnce();
		workspace.revealLeaf.mockClear();
		terminal.view.focusTerminal.mockClear();
		finishRestart();
		await restarting;
		expect(workspace.revealLeaf).not.toHaveBeenCalled();
		expect(terminal.view.focusTerminal).not.toHaveBeenCalled();
	});

	it('activates an existing sidebar leaf even when reveal does not change the active editor', async () => {
		const workspace = createMockWorkspace();
		const editor = createMockLeaf('editor');
		const terminal = { ...createMockLeaf('terminal'), type: 'opencode-terminal' };
		workspace.activeLeaf = editor;
		workspace._leaves.push(terminal);
		const coordinator = new ViewCoordinator(workspace as unknown as Workspace, {
			terminalViewType: 'opencode-terminal', conversationViewType: 'opencode-conversations',
		});
		await coordinator.activateTerminalView();
		expect(workspace.setActiveLeaf).toHaveBeenCalledWith(terminal, { focus: true });
		expect(terminal.view.focusTerminal).toHaveBeenCalledOnce();
	});

	it.each(['note', 'editor-focus', 'closed', 'collapsed'] as const)('does not focus after %s changes during deferred reveal', async change => {
		const workspace = createMockWorkspace();
		const terminal = { ...createMockLeaf('terminal'), type: 'opencode-terminal' };
		workspace._leaves.push(terminal);
		let finishReveal!: () => void;
		workspace.revealLeaf.mockReturnValue(new Promise<void>(resolve => { finishReveal = resolve; }));
		const coordinator = new ViewCoordinator(workspace as unknown as Workspace, {
			terminalViewType: 'opencode-terminal', conversationViewType: 'opencode-conversations',
		});
		const opening = coordinator.activateTerminalView();
		if (change === 'note') workspace.activeLeaf = createMockLeaf('note');
		if (change === 'editor-focus') workspace.containerEl.ownerDocument.activeElement = {};
		if (change === 'closed') workspace._leaves.length = 0;
		if (change === 'collapsed') terminal.view.containerEl.clientWidth = 0;
		finishReveal();
		await opening;
		expect(workspace.setActiveLeaf).not.toHaveBeenCalled();
		expect(terminal.view.focusTerminal).not.toHaveBeenCalled();
	});

});
