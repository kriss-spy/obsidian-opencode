import { describe, it, expect, vi } from 'vitest';
import { ViewCoordinator } from './viewCoordinator';

const createMockLeaf = (id: string) => ({
	id,
	view: {},
	setViewState: vi.fn().mockResolvedValue(undefined),
});

const createMockWorkspace = () => {
	const leaves: any[] = [];
	return {
		getLeavesOfType: vi.fn((type: string) => leaves.filter(l => l.type === type)),
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
		const coordinator = new ViewCoordinator(workspace as any, {
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

		const coordinator = new ViewCoordinator(workspace as any, {
			terminalViewType: 'opencode-terminal',
			conversationViewType: 'opencode-conversations',
		});

		await coordinator.activateTerminalView();

		expect(workspace.getRightLeaf).not.toHaveBeenCalled();
		expect(workspace.revealLeaf).toHaveBeenCalledWith(existingLeaf);
	});

	it('should activate conversation view', async () => {
		const workspace = createMockWorkspace();
		const coordinator = new ViewCoordinator(workspace as any, {
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
		const coordinator = new ViewCoordinator(workspace as any, {
			terminalViewType: 'opencode-terminal',
			conversationViewType: 'opencode-conversations',
		});

		await coordinator.toggleTerminalSidebar();

		expect(workspace.rightSplit.toggle).toHaveBeenCalled();
	});

	it('should open terminal when sidebar is collapsed', async () => {
		const workspace = createMockWorkspace();
		workspace.rightSplit.collapsed = true;
		const coordinator = new ViewCoordinator(workspace as any, {
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

		const coordinator = new ViewCoordinator(workspace as any, {
			terminalViewType: 'opencode-terminal',
			conversationViewType: 'opencode-conversations',
		});

		const restartFn = vi.fn();
		await coordinator.openOrRestartTerminal(restartFn);

		expect(restartFn).toHaveBeenCalled();
		expect(workspace.revealLeaf).toHaveBeenCalledWith(existingLeaf);
	});
});
