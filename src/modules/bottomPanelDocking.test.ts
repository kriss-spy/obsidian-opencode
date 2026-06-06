import { describe, it, expect, vi } from 'vitest';
import { BottomPanelDocking } from './bottomPanelDocking';

const createMockRoot = (initialDirection: 'vertical' | 'horizontal' = 'vertical') => {
	const children: any[] = [];
	const root: any = {
		direction: initialDirection,
		children,
		setDirection: vi.fn((d: 'vertical' | 'horizontal') => {
			root.direction = d;
		}),
		containerEl: {
			classList: {
				add: vi.fn(),
				remove: vi.fn(),
			},
		},
	};
	return root;
};

const createMockWorkspace = (root: any) => {
	const leaves: any[] = [];
	return {
		getLeavesOfType: vi.fn((type: string) => leaves.filter(l => l.viewType === type)),
		revealLeaf: vi.fn(),
		rootSplit: root,
		createLeafInParent: vi.fn((_parent: any, index: number) => {
			const leaf = { id: `leaf-${index}`, setViewState: vi.fn().mockResolvedValue(undefined), detach: vi.fn() };
			leaves.push(leaf);
			root.children.push(leaf);
			return leaf;
		}),
		_leaves: leaves,
	};
};

describe('BottomPanelDocking', () => {
	it('starts inactive and leaves the root direction untouched', () => {
		const root = createMockRoot('vertical');
		const workspace = createMockWorkspace(root);
		const docking = new BottomPanelDocking(workspace as any);

		expect(docking.isActive()).toBe(false);
		expect(root.setDirection).not.toHaveBeenCalled();
	});

	it('enter() flips the root split to horizontal and remembers the original direction', () => {
		const root = createMockRoot('vertical');
		const workspace = createMockWorkspace(root);
		const docking = new BottomPanelDocking(workspace as any);

		docking.enter();

		expect(docking.isActive()).toBe(true);
		expect(root.direction).toBe('horizontal');
		expect(root.setDirection).toHaveBeenCalledWith('horizontal');
	});

	it('enter() is a no-op when already active (idempotent)', () => {
		const root = createMockRoot('vertical');
		const workspace = createMockWorkspace(root);
		const docking = new BottomPanelDocking(workspace as any);

		docking.enter();
		docking.enter();

		expect(root.setDirection).toHaveBeenCalledTimes(1);
	});

	it('maybeExit() restores the original direction when the root has no other children', () => {
		const root = createMockRoot('vertical');
		const workspace = createMockWorkspace(root);
		const docking = new BottomPanelDocking(workspace as any);

		docking.enter();
		expect(root.direction).toBe('horizontal');

		docking.maybeExit();

		expect(root.direction).toBe('vertical');
		expect(docking.isActive()).toBe(false);
	});

	it('maybeExit() does NOT restore the direction when other root children exist', () => {
		const root = createMockRoot('vertical');
		const workspace = createMockWorkspace(root);
		const docking = new BottomPanelDocking(workspace as any);

		docking.enter();
		root.children.push({ id: 'user-leaf' });

		docking.maybeExit();

		expect(root.direction).toBe('horizontal');
		expect(docking.isActive()).toBe(true);
	});

	it('maybeExit() is a no-op when never entered', () => {
		const root = createMockRoot('vertical');
		const workspace = createMockWorkspace(root);
		const docking = new BottomPanelDocking(workspace as any);

		docking.maybeExit();

		expect(root.setDirection).not.toHaveBeenCalled();
	});

	it('createBottomLeaf() appends a leaf to the root via createLeafInParent', () => {
		const root = createMockRoot('vertical');
		const workspace = createMockWorkspace(root);
		const docking = new BottomPanelDocking(workspace as any);

		const leaf = docking.createBottomLeaf();

		expect(workspace.createLeafInParent).toHaveBeenCalledWith(root, 0);
		expect(leaf).toBeDefined();
		expect(root.children).toContain(leaf);
	});

	it('falls back to direct property mutation when setDirection is missing', () => {
		const root: any = {
			direction: 'vertical',
			children: [],
			containerEl: { classList: { add: vi.fn(), remove: vi.fn() } },
		};
		const workspace = createMockWorkspace(root);
		const docking = new BottomPanelDocking(workspace as any);

		docking.enter();

		expect(root.direction).toBe('horizontal');
		expect(root.containerEl.classList.remove).toHaveBeenCalledWith('mod-vertical');
		expect(root.containerEl.classList.add).toHaveBeenCalledWith('mod-horizontal');
	});
});
