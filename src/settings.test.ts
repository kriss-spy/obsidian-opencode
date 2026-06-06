import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS, OpencodePluginSettings } from './settings';

describe('settings', () => {
	it('defaults panelMode to "sidebar"', () => {
		expect(DEFAULT_SETTINGS.panelMode).toBe('sidebar');
	});
});
