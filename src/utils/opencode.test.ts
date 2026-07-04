import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpencodeClient, ExportTooLargeError } from './opencode';
import { execFile, spawn } from 'child_process';
import * as fs from 'fs';

vi.mock('obsidian', () => ({
	Notice: class {
		constructor(message: string) {}
	},
}));

vi.mock('child_process', () => ({
	execFile: vi.fn(),
	spawn: vi.fn(),
}));

vi.mock('fs', () => ({
	statSync: vi.fn(),
	readFileSync: vi.fn(),
	unlinkSync: vi.fn(),
	existsSync: vi.fn().mockReturnValue(false),
}));

describe('OpencodeClient export with large sessions', () => {
	const mockSpawn = spawn as unknown as ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('should throw ExportTooLargeError when temp file exceeds maxBytes', async () => {
		const mockStderr = {
			on: vi.fn(),
		};
		const mockProcess = {
			stderr: mockStderr,
			on: vi.fn(),
		};

		mockSpawn.mockReturnValue(mockProcess);
		vi.mocked(fs.statSync).mockReturnValue({ size: 201 * 1024 * 1024 } as any);

		const client = new OpencodeClient('opencode', '/tmp');

		const promise = client.exportSession('large-session');

		const closeHandler = mockProcess.on.mock.calls.find((call: any) => call[0] === 'close')?.[1];
		expect(closeHandler).toBeDefined();
		closeHandler(0);

		await expect(promise).rejects.toBeInstanceOf(ExportTooLargeError);
		expect(fs.unlinkSync).toHaveBeenCalled();
	});

	it('should successfully export from temp file', async () => {
		const mockData = {
			info: {
				id: 'session-123',
				slug: 'test',
				projectID: 'proj-1',
				directory: '/tmp',
				path: '/tmp',
				title: 'Test',
				agent: 'default',
				model: { id: 'gpt-4', providerID: 'openai' },
				version: '1.0',
				summary: { additions: 0, deletions: 0, files: 0 },
				cost: 0,
				tokens: { input: 0, output: 0, reasoning: 0 },
				time: { created: Date.now(), updated: Date.now() },
			},
			messages: [],
		};

		const mockStderr = {
			on: vi.fn(),
		};
		const mockProcess = {
			stderr: mockStderr,
			on: vi.fn(),
		};

		mockSpawn.mockReturnValue(mockProcess);
		vi.mocked(fs.statSync).mockReturnValue({ size: 1000 } as any);
		vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockData));

		const client = new OpencodeClient('opencode', '/tmp');
		const promise = client.exportSession('small-session');

		const closeHandler = mockProcess.on.mock.calls.find((call: any) => call[0] === 'close')?.[1];
		closeHandler(0);

		const result = await promise;
		expect(result).toEqual(mockData);
		expect(fs.unlinkSync).toHaveBeenCalled();
	});

	it('should return null on non-JSON output', async () => {
		const mockStderr = {
			on: vi.fn(),
		};
		const mockProcess = {
			stderr: mockStderr,
			on: vi.fn(),
		};

		mockSpawn.mockReturnValue(mockProcess);
		vi.mocked(fs.statSync).mockReturnValue({ size: 100 } as any);
		vi.mocked(fs.readFileSync).mockReturnValue('not valid json');

		const client = new OpencodeClient('opencode', '/tmp');
		const promise = client.exportSession('bad-session');

		const closeHandler = mockProcess.on.mock.calls.find((call: any) => call[0] === 'close')?.[1];
		closeHandler(0);

		const result = await promise;
		expect(result).toBeNull();
		expect(fs.unlinkSync).toHaveBeenCalled();
	});
});

describe('OpencodeClient listSessions', () => {
	const mockExecFile = execFile as unknown as ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(fs.existsSync).mockReturnValue(false);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('parses sessions from stdout', async () => {
		const sessions = [{ id: 'ses_1', title: 't', updated: 1, created: 1, projectId: 'p', directory: '/tmp' }];
		mockExecFile.mockImplementation((_cmd, _args, _opts, cb) => cb(null, JSON.stringify(sessions), ''));
		const client = new OpencodeClient('opencode', '/tmp');
		await expect(client.listSessions()).resolves.toEqual(sessions);
	});

	it('falls back to stderr when stdout is empty (issue #25 repro)', async () => {
		const sessions = [{ id: 'ses_1', title: 't', updated: 1, created: 1, projectId: 'p', directory: '/tmp' }];
		mockExecFile.mockImplementation((_cmd, _args, _opts, cb) => cb(null, '', JSON.stringify(sessions)));
		const client = new OpencodeClient('opencode', '/tmp');
		await expect(client.listSessions()).resolves.toEqual(sessions);
	});

	it('returns [] when stdout and stderr are both empty instead of crashing JSON.parse', async () => {
		mockExecFile.mockImplementation((_cmd, _args, _opts, cb) => cb(null, '', ''));
		const client = new OpencodeClient('opencode', '/tmp');
		await expect(client.listSessions()).resolves.toEqual([]);
	});

	it('returns [] when stderr is non-JSON noise and stdout is empty', async () => {
		mockExecFile.mockImplementation((_cmd, _args, _opts, cb) => cb(null, '', 'Error: unknown option --format\n'));
		const client = new OpencodeClient('opencode', '/tmp');
		await expect(client.listSessions()).resolves.toEqual([]);
	});

	it('reads from a temp file under flatpak (handles flatpak-spawn swallowing stdout)', async () => {
		vi.mocked(fs.existsSync).mockReturnValue(true);
		const sessions = [{ id: 'ses_2', title: 't2', updated: 2, created: 2, projectId: 'p2', directory: '/tmp' }];
		// flatpak-spawn invocation succeeds; JSON is read from the temp file.
		mockExecFile.mockImplementation((_cmd, _args, _opts, cb) => cb(null, '', ''));
		vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(sessions));
		const client = new OpencodeClient('opencode', '/tmp');
		await expect(client.listSessions()).resolves.toEqual(sessions);
		expect(fs.unlinkSync).toHaveBeenCalled();
	});
});
