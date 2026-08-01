import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpencodeClient, ExportTooLargeError } from './opencode';
import { ChildProcess, execFile, spawn } from 'child_process';
import * as fs from 'fs';

vi.mock('obsidian', () => ({
	Notice: class {
		constructor(_message: string) {}
	},
}));

vi.mock('child_process', () => ({
	execFile: vi.fn(),
	spawn: vi.fn(),
}));

vi.mock('fs', () => ({
	accessSync: vi.fn(() => { throw new Error('not found'); }),
	constants: { X_OK: 1 },
	statSync: vi.fn(),
	readFileSync: vi.fn(),
	unlinkSync: vi.fn(),
	existsSync: vi.fn().mockReturnValue(false),
}));

describe('OpencodeClient export with large sessions', () => {
	const mockSpawn = vi.mocked(spawn);

	function createMockProcess(): { process: ChildProcess; emitClose: (code: number) => void } {
		let closeHandler: ((code: number) => void) | undefined;
		const process = {
			stderr: { on: vi.fn() },
			on: vi.fn((event: string, handler: (code: number) => void) => {
				if (event === 'close') closeHandler = handler;
			}),
		};
		return {
			process: process as unknown as ChildProcess,
			emitClose: (code: number) => closeHandler?.(code),
		};
	}

	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('should throw ExportTooLargeError when temp file exceeds maxBytes', async () => {
		const mockProcess = createMockProcess();

		mockSpawn.mockReturnValue(mockProcess.process);
		vi.mocked(fs.statSync).mockReturnValue({ size: 201 * 1024 * 1024 } as unknown as fs.Stats);

		const client = new OpencodeClient('opencode', '/tmp');

		const promise = client.exportSession('large-session');

		mockProcess.emitClose(0);

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

		const mockProcess = createMockProcess();

		mockSpawn.mockReturnValue(mockProcess.process);
		vi.mocked(fs.statSync).mockReturnValue({ size: 1000 } as unknown as fs.Stats);
		vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockData));

		const client = new OpencodeClient('opencode', '/tmp');
		const promise = client.exportSession('small-session');

		mockProcess.emitClose(0);

		const result = await promise;
		expect(result).toEqual(mockData);
		expect(fs.unlinkSync).toHaveBeenCalled();
	});

	it('should return null on non-JSON output', async () => {
		const mockProcess = createMockProcess();

		mockSpawn.mockReturnValue(mockProcess.process);
		vi.mocked(fs.statSync).mockReturnValue({ size: 100 } as unknown as fs.Stats);
		vi.mocked(fs.readFileSync).mockReturnValue('not valid json');

		const client = new OpencodeClient('opencode', '/tmp');
		const promise = client.exportSession('bad-session');

		mockProcess.emitClose(0);

		const result = await promise;
		expect(result).toBeNull();
		expect(fs.unlinkSync).toHaveBeenCalled();
	});
});

describe('OpencodeClient listSessions', () => {
	const mockExecFile = vi.mocked(execFile);
	const mockExecResult = (stdout: string, stderr: string): void => {
		mockExecFile.mockImplementation((_cmd, _args, _opts, callback) => {
			const typedCallback = callback as unknown as (
				error: Error | null,
				stdout: string,
				stderr: string
			) => void;
			typedCallback(null, stdout, stderr);
			return {} as unknown as ChildProcess;
		});
	};

	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(fs.accessSync).mockImplementation(() => { throw new Error('not found'); });
		vi.mocked(fs.existsSync).mockReturnValue(false);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('parses sessions from stdout', async () => {
		const sessions = [{ id: 'ses_1', title: 't', updated: 1, created: 1, projectId: 'p', directory: '/tmp' }];
		mockExecResult(JSON.stringify(sessions), '');
		const client = new OpencodeClient('opencode', '/tmp');
		await expect(client.listSessions()).resolves.toEqual(sessions);
	});

	it('falls back to stderr when stdout is empty (issue #25 repro)', async () => {
		const sessions = [{ id: 'ses_1', title: 't', updated: 1, created: 1, projectId: 'p', directory: '/tmp' }];
		mockExecResult('', JSON.stringify(sessions));
		const client = new OpencodeClient('opencode', '/tmp');
		await expect(client.listSessions()).resolves.toEqual(sessions);
	});

	it('returns [] when stdout and stderr are both empty instead of crashing JSON.parse', async () => {
		mockExecResult('', '');
		const client = new OpencodeClient('opencode', '/tmp');
		await expect(client.listSessions()).resolves.toEqual([]);
	});

	it('returns [] when stderr is non-JSON noise and stdout is empty', async () => {
		mockExecResult('', 'Error: unknown option --format\n');
		const client = new OpencodeClient('opencode', '/tmp');
		await expect(client.listSessions()).resolves.toEqual([]);
	});

	it('passes Windows command tokens through the isolated Node host', async () => {
		const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
		const sessions = [{ id: 'ses_1', title: 't', updated: 1, created: 1, projectId: 'p', directory: 'C:\\vault' }];
		mockExecResult(JSON.stringify(sessions), '');
		const executable = 'C:\\percent%PATH%\\opencode.cmd';

		try {
			const client = new OpencodeClient(executable, 'C:\\vault');
			await expect(client.listSessions()).resolves.toEqual(sessions);
			expect(mockExecFile).toHaveBeenCalledWith(
				'node.exe',
				['-e', expect.stringContaining('OPENCODE_PLUGIN_CMD_'), 'C:\\vault', executable, 'session', 'list', '--format', 'json'],
				expect.objectContaining({
					windowsHide: true,
				}),
				expect.any(Function)
			);
		} finally {
			platform.mockRestore();
		}
	});

	it('resolves a bare Windows executable before launching it', async () => {
		const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
		const oldPath = process.env.PATH;
		const oldPathExt = process.env.PATHEXT;
		delete process.env.PATH;
		process.env.Path = 'C:\\tools';
		process.env.PATHEXT = '.EXE';
		vi.mocked(fs.accessSync).mockImplementation((candidate) => {
			if (String(candidate).toLowerCase() !== 'c:\\tools\\opencode.exe') throw new Error('not found');
		});
		const sessions = [{ id: 'ses_1', title: 't', updated: 1, created: 1, projectId: 'p', directory: 'C:\\vault' }];
		mockExecResult(JSON.stringify(sessions), '');

		try {
			const client = new OpencodeClient('opencode', 'C:\\vault');
			await expect(client.listSessions()).resolves.toEqual(sessions);
			expect(mockExecFile).toHaveBeenCalledWith(
				'node.exe',
				['-e', expect.any(String), 'C:\\vault', 'C:\\tools\\opencode.EXE', 'session', 'list', '--format', 'json'],
				expect.objectContaining({
					windowsHide: true,
					env: expect.objectContaining({ PATH: expect.stringContaining('C:\\tools') }),
				}),
				expect.any(Function)
			);
		} finally {
			delete process.env.Path;
			process.env.PATH = oldPath;
			process.env.PATHEXT = oldPathExt;
			platform.mockRestore();
		}
	});

	it('reads from a temp file under flatpak (handles flatpak-spawn swallowing stdout)', async () => {
		vi.mocked(fs.existsSync).mockReturnValue(true);
		const sessions = [{ id: 'ses_2', title: 't2', updated: 2, created: 2, projectId: 'p2', directory: '/tmp' }];
		// flatpak-spawn invocation succeeds; JSON is read from the temp file.
		mockExecResult('', '');
		vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(sessions));
		const client = new OpencodeClient('opencode', '/tmp');
		await expect(client.listSessions()).resolves.toEqual(sessions);
		expect(fs.unlinkSync).toHaveBeenCalled();
	});
});

describe('OpencodeClient deleteSession', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('rejects unsafe session IDs before invoking a Windows shell', async () => {
		const client = new OpencodeClient('opencode', 'C:\\vault');
		await expect(client.deleteSession('safe" & echo INJECTED')).resolves.toBe(false);
		expect(execFile).not.toHaveBeenCalled();
	});
});
