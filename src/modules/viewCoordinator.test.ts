import { describe, it, expect, vi } from 'vitest';
import { ViewCoordinator } from './viewCoordinator';

const createMockLeaf = (id: string) => ({
	id,
	view: {},
	setViewState: vi.fn().mockResolvedValue(undefined),
	detach: vi.fn(),
});

const createMockWorkspace = () => {
	const leaves: any[] = [];
	const rootChildren: any[] = [];
	const root = {
		direction: 'vertical' as 'vertical' | 'horizontal',
		children: rootChildren,
		setDirection: vi.fn((d: 'vertical' | 'horizontal') => { root.direction = d; }),
		containerEl: { classList: { add: vi.fn(), remove: vi.fn() } },
	};
	return {
		getLeavesOfType: vi.fn((type: string) => leaves.filter(l => l.viewType === type || l.type === type)),
		getRightLeaf: vi.fn(() => createMockLeaf('right-leaf')),
		getLeaf: vi.fn((split: string) => createMockLeaf(split === 'split' ? 'split-leaf' : 'tab-leaf')),
		rootSplit: root,
		createLeafInParent: vi.fn((_parent: any, index: number) => {
			const leaf = { ...createMockLeaf(`bottom-${index}`), setViewState: vi.fn().mockResolvedValue(undefined) };
			leaves.push(leaf);
			rootChildren.push(leaf);
			return leaf;
		}),
		revealLeaf: vi.fn(),
		activeLeaf: null as any,
		rightSplit: {
			collapsed: false,
			toggle: vi.fn(),
		},
		_leaves: leaves,
		_rootChildren: rootChildren,
		_addLeaf: (leaf: any) => { leaves.push(leaf); },
	};
};

const baseConfig = (overrides: Partial<{
	terminalViewType: string;
	bottomViewType: string;
	conversationViewType: string;
	getPanelMode: () => 'sidebar' | 'bottom';
}> = {}) => ({
	terminalViewType: 'opencode-terminal',
	bottomViewType: 'opencode-terminal-bottom',
	conversationViewType: 'opencode-conversations',
	getPanelMode: () => 'sidebar' as const,
	...overrides,
});

describe('ViewCoordinator', () => {
	it('should activate terminal view by creating a new leaf if none exists', async () => {
		const workspace = createMockWorkspace();
		const coordinator = new ViewCoordinator(workspace as any, baseConfig());

		await coordinator.activateTerminalView();

		expect(workspace.getRightLeaf).toHaveBeenCalledWith(false);
		expect(workspace.revealLeaf).toHaveBeenCalled();
	});

	it('should activate terminal view by reusing existing leaf', async () => {
		const existingLeaf = { ...createMockLeaf('existing'), viewType: 'opencode-terminal' };
		const workspace = createMockWorkspace();
		workspace._addLeaf(existingLeaf);

		const coordinator = new ViewCoordinator(workspace as any, baseConfig());

		await coordinator.activateTerminalView();

		expect(workspace.getRightLeaf).not.toHaveBeenCalled();
		expect(workspace.revealLeaf).toHaveBeenCalledWith(existingLeaf);
	});

	it('should activate conversation view', async () => {
		const workspace = createMockWorkspace();
		const coordinator = new ViewCoordinator(workspace as any, baseConfig());

		await coordinator.activateConversationView();

		expect(workspace.getRightLeaf).toHaveBeenCalledWith(false);
		expect(workspace.revealLeaf).toHaveBeenCalled();
	});

	describe('panelMode dispatch', () => {
		it('should create a bottom leaf when getPanelMode returns "bottom"', async () => {
			const workspace = createMockWorkspace();
			const coordinator = new ViewCoordinator(workspace as any, baseConfig({
				getPanelMode: () => 'bottom',
			}));

			await coordinator.activateTerminalView();

			expect(workspace.createLeafInParent).toHaveBeenCalled();
			expect(workspace.getRightLeaf).not.toHaveBeenCalled();
			expect(workspace.revealLeaf).toHaveBeenCalled();
			expect(workspace.rootSplit.setDirection).toHaveBeenCalledWith('horizontal');
		});

		it('should reuse an existing bottom leaf when getPanelMode returns "bottom"', async () => {
			const existingBottom = { ...createMockLeaf('bottom-existing'), viewType: 'opencode-terminal-bottom' };
			const workspace = createMockWorkspace();
			workspace._addLeaf(existingBottom);

			const coordinator = new ViewCoordinator(workspace as any, baseConfig({
				getPanelMode: () => 'bottom',
			}));

			await coordinator.activateTerminalView();

			expect(workspace.getLeaf).not.toHaveBeenCalled();
			expect(workspace.revealLeaf).toHaveBeenCalledWith(existingBottom);
		});
	});

	describe('getActiveTerminalLeaf', () => {
		it('returns the sidebar terminal leaf when present', () => {
			const sidebar = { ...createMockLeaf('s'), viewType: 'opencode-terminal' };
			const bottom = { ...createMockLeaf('b'), viewType: 'opencode-terminal-bottom' };
			const workspace = createMockWorkspace();
			workspace._addLeaf(sidebar);
			workspace._addLeaf(bottom);

			const coordinator = new ViewCoordinator(workspace as any, baseConfig());

			expect(coordinator.getActiveTerminalLeaf()).toBe(sidebar);
		});

		it('returns the bottom terminal leaf when only the bottom exists', () => {
			const bottom = { ...createMockLeaf('b'), viewType: 'opencode-terminal-bottom' };
			const workspace = createMockWorkspace();
			workspace._addLeaf(bottom);

			const coordinator = new ViewCoordinator(workspace as any, baseConfig());

			expect(coordinator.getActiveTerminalLeaf()).toBe(bottom);
		});

		it('returns null when neither leaf exists', () => {
			const workspace = createMockWorkspace();
			const coordinator = new ViewCoordinator(workspace as any, baseConfig());

			expect(coordinator.getActiveTerminalLeaf()).toBeNull();
		});
	});

	describe('toggleTerminal', () => {
		it('creates a sidebar leaf in the active mode when none exists', async () => {
			const workspace = createMockWorkspace();
			const coordinator = new ViewCoordinator(workspace as any, baseConfig());

			await coordinator.toggleTerminal();

			expect(workspace.getRightLeaf).toHaveBeenCalled();
		});

		it('creates a bottom leaf in the active mode when none exists and panelMode=bottom', async () => {
			const workspace = createMockWorkspace();
			const coordinator = new ViewCoordinator(workspace as any, baseConfig({
				getPanelMode: () => 'bottom',
			}));

			await coordinator.toggleTerminal();

			expect(workspace.createLeafInParent).toHaveBeenCalled();
		});

		it('expands a collapsed right sidebar when the sidebar leaf exists', async () => {
			const sidebarLeaf = { ...createMockLeaf('s'), viewType: 'opencode-terminal' };
			const workspace = createMockWorkspace();
			workspace._addLeaf(sidebarLeaf);
			workspace.rightSplit.collapsed = true;
			const coordinator = new ViewCoordinator(workspace as any, baseConfig());

			await coordinator.toggleTerminal();

			expect(workspace.revealLeaf).toHaveBeenCalledWith(sidebarLeaf);
		});

		it('collapses the right sidebar when the sidebar leaf is shown and focused', async () => {
			const sidebarLeaf = { ...createMockLeaf('s'), viewType: 'opencode-terminal' };
			const workspace = createMockWorkspace();
			workspace._addLeaf(sidebarLeaf);
			workspace.rightSplit.collapsed = false;
			workspace.activeLeaf = sidebarLeaf;
			const coordinator = new ViewCoordinator(workspace as any, baseConfig());

			await coordinator.toggleTerminal();

			expect(workspace.rightSplit.toggle).toHaveBeenCalled();
		});

		it('focuses the sidebar leaf when it is shown but not focused', async () => {
			const sidebarLeaf = { ...createMockLeaf('s'), viewType: 'opencode-terminal' };
			const otherLeaf = { ...createMockLeaf('o'), viewType: 'markdown' };
			const workspace = createMockWorkspace();
			workspace._addLeaf(sidebarLeaf);
			workspace.rightSplit.collapsed = false;
			workspace.activeLeaf = otherLeaf;
			const coordinator = new ViewCoordinator(workspace as any, baseConfig());

			await coordinator.toggleTerminal();

			expect(workspace.revealLeaf).toHaveBeenCalledWith(sidebarLeaf);
			expect(workspace.rightSplit.toggle).not.toHaveBeenCalled();
		});

		it('focuses a bottom leaf that is shown but not focused (does not toggle the right split)', async () => {
			const bottomLeaf = { ...createMockLeaf('b'), viewType: 'opencode-terminal-bottom', focusTerminal: vi.fn() };
			const otherLeaf = { ...createMockLeaf('o'), viewType: 'markdown' };
			const workspace = createMockWorkspace();
			workspace._addLeaf(bottomLeaf);
			workspace.activeLeaf = otherLeaf;
			const coordinator = new ViewCoordinator(workspace as any, baseConfig());

			await coordinator.toggleTerminal();

			expect(workspace.revealLeaf).toHaveBeenCalledWith(bottomLeaf);
		});

		it('collapses a focused bottom leaf by adding the collapsed class to its container', async () => {
			const bottomLeaf = {
				...createMockLeaf('b'),
				viewType: 'opencode-terminal-bottom',
				view: { containerEl: { classList: { add: vi.fn(), remove: vi.fn(), contains: vi.fn(() => false) } } },
			};
			const workspace = createMockWorkspace();
			workspace._addLeaf(bottomLeaf);
			workspace.activeLeaf = bottomLeaf;
			const coordinator = new ViewCoordinator(workspace as any, baseConfig());

			await coordinator.toggleTerminal();

			expect(bottomLeaf.view.containerEl.classList.add).toHaveBeenCalledWith('opencode-terminal-collapsed');
		});

		it('reveals a collapsed bottom leaf by removing the collapsed class and focusing', async () => {
			const bottomLeaf = {
				...createMockLeaf('b'),
				viewType: 'opencode-terminal-bottom',
				view: { containerEl: { classList: { add: vi.fn(), remove: vi.fn(), contains: vi.fn(() => true) } } },
			};
			const workspace = createMockWorkspace();
			workspace._addLeaf(bottomLeaf);
			const coordinator = new ViewCoordinator(workspace as any, baseConfig());

			await coordinator.toggleTerminal();

			expect(bottomLeaf.view.containerEl.classList.remove).toHaveBeenCalledWith('opencode-terminal-collapsed');
			expect(workspace.revealLeaf).toHaveBeenCalledWith(bottomLeaf);
		});
	});

	describe('destroyLeaf', () => {
		it('detaches all leaves of the given view type', () => {
			const a = { ...createMockLeaf('a'), viewType: 'opencode-terminal' };
			const b = { ...createMockLeaf('b'), viewType: 'opencode-terminal' };
			const other = { ...createMockLeaf('c'), viewType: 'opencode-conversations' };
			const workspace = createMockWorkspace();
			workspace._addLeaf(a);
			workspace._addLeaf(b);
			workspace._addLeaf(other);

			const coordinator = new ViewCoordinator(workspace as any, baseConfig());

			coordinator.destroyLeaf('opencode-terminal');

			expect(a.detach).toHaveBeenCalled();
			expect(b.detach).toHaveBeenCalled();
			expect(other.detach).not.toHaveBeenCalled();
		});

		it('does nothing when no leaf of the given type exists', () => {
			const workspace = createMockWorkspace();
			const coordinator = new ViewCoordinator(workspace as any, baseConfig());

			expect(() => coordinator.destroyLeaf('opencode-terminal')).not.toThrow();
		});
	});
});
