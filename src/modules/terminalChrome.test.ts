import { describe, it, expect } from 'vitest';
import { terminalChromeClasses } from './terminalChrome';

describe('terminalChromeClasses', () => {
	it('returns the bottom container class in addition to the base class for bottom mode', () => {
		expect(terminalChromeClasses('bottom')).toEqual([
			'opencode-terminal-container',
			'opencode-terminal-bottom-container',
		]);
	});

	it('returns only the base class for sidebar mode', () => {
		expect(terminalChromeClasses('sidebar')).toEqual(['opencode-terminal-container']);
	});
});
