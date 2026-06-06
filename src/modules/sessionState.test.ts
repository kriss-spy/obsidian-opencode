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

	it('should consume and clear all state', () => {
		const state = new SessionState();
		state.setOpenSession('session-123', '/path/to/dir');
		state.setPendingPrompt('Hello world');

		const result = state.consumeArgs();

		expect(result.args).toEqual(['-s', 'session-123']);
		expect(result.cwd).toBe('/path/to/dir');
		expect(result.prompt).toBe('Hello world');

		expect(state.sessionArgs).toBeNull();
		expect(state.sessionCwd).toBeNull();
		expect(state.pendingPrompt).toBeNull();
	});

	it('should start with lastSession as null', () => {
		const state = new SessionState();
		expect(state.lastSession).toBeNull();
	});

	it('should capture most recent setOpenSession call in lastSession', () => {
		const state = new SessionState();
		state.setOpenSession('session-123', '/path/to/dir');
		expect(state.lastSession).toEqual({ args: ['-s', 'session-123'], cwd: '/path/to/dir' });
	});

	it('should keep lastSession after consumeArgs clears session state', () => {
		const state = new SessionState();
		state.setOpenSession('session-123', '/path/to/dir');
		state.consumeArgs();
		expect(state.lastSession).toEqual({ args: ['-s', 'session-123'], cwd: '/path/to/dir' });
	});

	it('should update lastSession to the most recent setX call', () => {
		const state = new SessionState();
		state.setOpenSession('session-a', '/dir-a');
		state.setContinueLastSession();
		expect(state.lastSession).toEqual({ args: ['-c'], cwd: null });
	});

	it('should capture newSession args (empty) in lastSession', () => {
		const state = new SessionState();
		state.setNewSession();
		expect(state.lastSession).toEqual({ args: [], cwd: null });
	});

	it('replayLastSession restores lastSession to sessionArgs/sessionCwd for next consume', () => {
		const state = new SessionState();
		state.setOpenSession('session-123', '/path/to/dir');
		state.consumeArgs();
		state.replayLastSession();
		expect(state.sessionArgs).toEqual(['-s', 'session-123']);
		expect(state.sessionCwd).toBe('/path/to/dir');
	});

	it('replayLastSession is a no-op when lastSession is null', () => {
		const state = new SessionState();
		state.replayLastSession();
		expect(state.sessionArgs).toBeNull();
		expect(state.sessionCwd).toBeNull();
	});
});
