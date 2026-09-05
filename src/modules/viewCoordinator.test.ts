import { describe, it, expect, vi } from 'vitest';
import type { Workspace } from 'obsidian';
import { ViewCoordinator } from './viewCoordinator';

interface MockLeaf {
	id: string;
	type?: string;
	view: object;
	setViewState: ReturnType<typeof vi.fn>;
}

interface MockWorkspace {
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
	view: {},
	setViewState: vi.fn().mockResolvedValue(undefined),
});

const createMockWorkspace = (): MockWorkspace => {
	const leaves: MockLeaf[] = [];
	return {
		getLeavesOfType: vi.fn((type: string): MockLeaf[] => leaves.filter(leaf => leaf.type === type)),
		getRightLeaf: vi.fn(() => createMockLeaf('right-leaf')),
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
	});

	it('should close every terminal view', async () => {
		const firstLeaf = { ...createMockLeaf('first'), type: 'opencode-terminal', detach: vi.fn() };
		const secondLeaf = { ...createMockLeaf('second'), type: 'opencode-terminal', detach: vi.fn() };
		const workspace = createMockWorkspace();
		workspace._leaves.push(firstLeaf, secondLeaf);
		const coordinator = new ViewCoordinator(workspace as unknown as Workspace, {
			terminalViewType: 'opencode-terminal',
			conversationViewType: 'opencode-conversations',
		});

		await coordinator.closeTerminalViews();

		expect(firstLeaf.detach).toHaveBeenCalledOnce();
		expect(secondLeaf.detach).toHaveBeenCalledOnce();
	});
});
