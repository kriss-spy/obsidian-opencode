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
	return {
		getLeavesOfType: vi.fn((type: string) => leaves.filter(l => l.viewType === type)),
		getRightLeaf: vi.fn(() => createMockLeaf('right-leaf')),
		getLeaf: vi.fn(() => createMockLeaf('split-leaf')),
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
