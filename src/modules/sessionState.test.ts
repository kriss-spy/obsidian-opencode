import { describe, it, expect } from 'vitest';
import { SessionState } from './sessionState';

describe('SessionState', () => {
	it('should initialize with null values', () => {
		const state = new SessionState();
		expect(state.sessionArgs).toBeNull();
		expect(state.sessionCwd).toBeNull();
		expect(state.pendingPrompt).toBeNull();
	});

	it('should set new session state', () => {
		const state = new SessionState();
		state.setNewSession();
		expect(state.sessionArgs).toEqual([]);
		expect(state.sessionCwd).toBeNull();
	});

	it('should set continue last session state', () => {
		const state = new SessionState();
		state.setContinueLastSession();
		expect(state.sessionArgs).toEqual(['-c']);
		expect(state.sessionCwd).toBeNull();
	});

	it('should set open session state', () => {
		const state = new SessionState();
		state.setOpenSession('session-123', '/path/to/dir');
		expect(state.sessionArgs).toEqual(['-s', 'session-123']);
		expect(state.sessionCwd).toBe('/path/to/dir');
	});

	it('should set pending prompt', () => {
		const state = new SessionState();
		state.setPendingPrompt('Hello world');
		expect(state.pendingPrompt).toBe('Hello world');
	});

	it('should allow overriding state with new values', () => {
		const state = new SessionState();
		state.setNewSession();
		expect(state.sessionArgs).toEqual([]);

		state.setContinueLastSession();
		expect(state.sessionArgs).toEqual(['-c']);

		state.setOpenSession('session-456', '/other/path');
		expect(state.sessionArgs).toEqual(['-s', 'session-456']);
		expect(state.sessionCwd).toBe('/other/path');
	});
});
