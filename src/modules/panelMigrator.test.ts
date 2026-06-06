import { describe, it, expect, vi } from 'vitest';
import { PanelMigrator } from './panelMigrator';
import { SessionState } from './sessionState';
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
		getLeavesOfType: vi.fn((type: string) => leaves.filter(l => l.viewType === type)),
		getRightLeaf: vi.fn(() => createMockLeaf('right-leaf')),
		getLeaf: vi.fn(() => createMockLeaf('split-leaf')),
		rootSplit: root,
		createLeafInParent: vi.fn((_parent: any, index: number) => {
			const leaf = { ...createMockLeaf(`bottom-${index}`), setViewState: vi.fn().mockResolvedValue(undefined) };
			leaves.push(leaf);
			rootChildren.push(leaf);
			return leaf;
		}),
		revealLeaf: vi.fn(),
		rightSplit: { collapsed: false, toggle: vi.fn() },
		_leaves: leaves,
		_addLeaf: (leaf: any) => { leaves.push(leaf); },
	};
};

const buildMigrator = (mode: 'sidebar' | 'bottom' = 'sidebar') => {
	const workspace = createMockWorkspace();
	const sessionState = new SessionState();
	const viewCoordinator = new ViewCoordinator(workspace as any, {
		terminalViewType: 'opencode-terminal',
		bottomViewType: 'opencode-terminal-bottom',
		conversationViewType: 'opencode-conversations',
		getPanelMode: () => mode,
	});
	const migrator = new PanelMigrator({
		sessionState,
		viewCoordinator,
		terminalViewType: 'opencode-terminal',
		bottomViewType: 'opencode-terminal-bottom',
	});
	return { migrator, sessionState, viewCoordinator, workspace };
};

describe('PanelMigrator', () => {
	it('destroys the sidebar leaf when migrating to "bottom"', async () => {
		const { migrator, workspace } = buildMigrator('sidebar');
		const sidebarLeaf = { ...createMockLeaf('s'), viewType: 'opencode-terminal' };
		workspace._addLeaf(sidebarLeaf);

		await migrator.migrateTo('bottom');

		expect(sidebarLeaf.detach).toHaveBeenCalled();
	});

	it('destroys the bottom leaf when migrating to "sidebar"', async () => {
		const { migrator, workspace } = buildMigrator('bottom');
		const bottomLeaf = { ...createMockLeaf('b'), viewType: 'opencode-terminal-bottom' };
		workspace._addLeaf(bottomLeaf);

		await migrator.migrateTo('sidebar');

		expect(bottomLeaf.detach).toHaveBeenCalled();
	});

	it('replays lastSession onto sessionState', async () => {
		const { migrator, sessionState } = buildMigrator();
		sessionState.setOpenSession('session-x', '/dir-x');
		sessionState.consumeArgs();
		expect(sessionState.sessionArgs).toBeNull();

		await migrator.migrateTo('bottom');

		expect(sessionState.sessionArgs).toEqual(['-s', 'session-x']);
		expect(sessionState.sessionCwd).toBe('/dir-x');
	});

	it('is a no-op for the other leaf when none exists', async () => {
		const { migrator, workspace } = buildMigrator('sidebar');

		await expect(migrator.migrateTo('bottom')).resolves.toBeUndefined();
		expect(workspace.getLeavesOfType('opencode-terminal')).toHaveLength(0);
	});

	it('activates the new-mode terminal view after migration', async () => {
		const { migrator, workspace } = buildMigrator('sidebar');
		const revealSpy = vi.spyOn(workspace, 'revealLeaf');

		await migrator.migrateTo('bottom');

		expect(revealSpy).toHaveBeenCalled();
	});
});

describe('PanelMigrator.openInMode', () => {
	const buildMigrator = (mode: 'sidebar' | 'bottom' = 'sidebar') => {
		const workspace = createMockWorkspace();
		const sessionState = new SessionState();
		const viewCoordinator = new ViewCoordinator(workspace as any, {
			terminalViewType: 'opencode-terminal',
			bottomViewType: 'opencode-terminal-bottom',
			conversationViewType: 'opencode-conversations',
			getPanelMode: () => mode,
		});
		return {
			migrator: new PanelMigrator({
				sessionState,
				viewCoordinator,
				terminalViewType: 'opencode-terminal',
				bottomViewType: 'opencode-terminal-bottom',
			}),
			sessionState,
			viewCoordinator,
			workspace,
		};
	};

	it('focuses the existing bottom leaf without replaying or destroying the sidebar', async () => {
		const { migrator, sessionState, workspace } = buildMigrator('sidebar');
		const bottomLeaf = { ...createMockLeaf('b'), viewType: 'opencode-terminal-bottom' };
		const sidebarLeaf = { ...createMockLeaf('s'), viewType: 'opencode-terminal' };
		workspace._addLeaf(bottomLeaf);
		workspace._addLeaf(sidebarLeaf);
		sessionState.setOpenSession('session-x', '/dir-x');
		sessionState.consumeArgs();

		await migrator.openInMode('bottom');

		expect(workspace.revealLeaf).toHaveBeenCalledWith(bottomLeaf);
		expect(sidebarLeaf.detach).not.toHaveBeenCalled();
		expect(sessionState.sessionArgs).toBeNull();
	});

	it('focuses the existing sidebar leaf without replaying or destroying the bottom', async () => {
		const { migrator, sessionState, workspace } = buildMigrator('bottom');
		const sidebarLeaf = { ...createMockLeaf('s'), viewType: 'opencode-terminal' };
		const bottomLeaf = { ...createMockLeaf('b'), viewType: 'opencode-terminal-bottom' };
		workspace._addLeaf(sidebarLeaf);
		workspace._addLeaf(bottomLeaf);
		sessionState.setOpenSession('session-x', '/dir-x');
		sessionState.consumeArgs();

		await migrator.openInMode('sidebar');

		expect(workspace.revealLeaf).toHaveBeenCalledWith(sidebarLeaf);
		expect(bottomLeaf.detach).not.toHaveBeenCalled();
		expect(sessionState.sessionArgs).toBeNull();
	});

	it('destroys the sidebar leaf, replays lastSession, and opens a new bottom leaf', async () => {
		const { migrator, sessionState, workspace } = buildMigrator('sidebar');
		const sidebarLeaf = { ...createMockLeaf('s'), viewType: 'opencode-terminal' };
		workspace._addLeaf(sidebarLeaf);
		sessionState.setOpenSession('session-x', '/dir-x');
		sessionState.consumeArgs();

		await migrator.openInMode('bottom');

		expect(sidebarLeaf.detach).toHaveBeenCalled();
		expect(sessionState.sessionArgs).toEqual(['-s', 'session-x']);
		expect(sessionState.sessionCwd).toBe('/dir-x');
		expect(workspace.createLeafInParent).toHaveBeenCalled();
	});

	it('destroys the bottom leaf, replays lastSession, and opens a new sidebar leaf', async () => {
		const { migrator, sessionState, workspace } = buildMigrator('bottom');
		const bottomLeaf = { ...createMockLeaf('b'), viewType: 'opencode-terminal-bottom' };
		workspace._addLeaf(bottomLeaf);
		sessionState.setOpenSession('session-x', '/dir-x');
		sessionState.consumeArgs();

		await migrator.openInMode('sidebar');

		expect(bottomLeaf.detach).toHaveBeenCalled();
		expect(sessionState.sessionArgs).toEqual(['-s', 'session-x']);
		expect(workspace.getRightLeaf).toHaveBeenCalled();
	});

	it('creates a new leaf when neither exists, with lastSession replayed if available', async () => {
		const { migrator, sessionState, workspace } = buildMigrator('sidebar');
		sessionState.setOpenSession('session-x', '/dir-x');
		sessionState.consumeArgs();

		await migrator.openInMode('bottom');

		expect(sessionState.sessionArgs).toEqual(['-s', 'session-x']);
		expect(workspace.createLeafInParent).toHaveBeenCalled();
	});
});
