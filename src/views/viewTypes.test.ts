import { describe, it, expect } from 'vitest';
import {
	OPENCODE_TERMINAL_VIEW_TYPE,
	OPENCODE_TERMINAL_BOTTOM_VIEW_TYPE,
	OPENCODE_CONVERSATION_VIEW_TYPE,
} from './viewTypes';

describe('viewTypes', () => {
	it('exports distinct sidebar and bottom terminal view types', () => {
		expect(typeof OPENCODE_TERMINAL_VIEW_TYPE).toBe('string');
		expect(typeof OPENCODE_TERMINAL_BOTTOM_VIEW_TYPE).toBe('string');
		expect(OPENCODE_TERMINAL_VIEW_TYPE).not.toBe(OPENCODE_TERMINAL_BOTTOM_VIEW_TYPE);
	});

	it('exports a conversation view type distinct from the terminal types', () => {
		expect(typeof OPENCODE_CONVERSATION_VIEW_TYPE).toBe('string');
		expect(OPENCODE_CONVERSATION_VIEW_TYPE).not.toBe(OPENCODE_TERMINAL_VIEW_TYPE);
		expect(OPENCODE_CONVERSATION_VIEW_TYPE).not.toBe(OPENCODE_TERMINAL_BOTTOM_VIEW_TYPE);
	});
});
