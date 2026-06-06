import { describe, it, expect } from 'vitest';
import { decideToggleAction, ToggleAction } from './toggleAction';

describe('decideToggleAction', () => {
	it('returns "reveal" when there is no leaf (fresh creation)', () => {
		expect(decideToggleAction({ hasLeaf: false, isCollapsed: false, isFocused: false })).toBe<ToggleAction>('reveal');
	});

	it('returns "reveal" when the leaf exists but is hidden', () => {
		expect(decideToggleAction({ hasLeaf: true, isCollapsed: true, isFocused: false })).toBe<ToggleAction>('reveal');
	});

	it('returns "collapse" when the leaf is shown and focused', () => {
		expect(decideToggleAction({ hasLeaf: true, isCollapsed: false, isFocused: true })).toBe<ToggleAction>('collapse');
	});

	it('returns "focus" when the leaf is shown but not focused', () => {
		expect(decideToggleAction({ hasLeaf: true, isCollapsed: false, isFocused: false })).toBe<ToggleAction>('focus');
	});

	it('returns "reveal" when the leaf exists, is collapsed, and was focused', () => {
		expect(decideToggleAction({ hasLeaf: true, isCollapsed: true, isFocused: true })).toBe<ToggleAction>('reveal');
	});
});
