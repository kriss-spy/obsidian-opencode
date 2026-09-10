import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CliNotFoundError, CliPermissionError, IncompatibleCliError, MalformedCliOutputError, OpencodeClient, ExportTooLargeError, UnsupportedCliError } from './opencode';
import { ChildProcess, execFile, spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

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

	it('routes PowerShell script exports through powershell.exe', async () => {
		const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
		const mockProcess = createMockProcess();
		mockSpawn.mockReturnValue(mockProcess.process);

		try {
			const promise = new OpencodeClient('C:\\Users\\test\\opencode.ps1', 'C:\\vault').exportSession('session-1');
			const [, args, options] = mockSpawn.mock.calls[0];
			expect(args).toEqual(['/d', '/s', '/c', expect.stringContaining('OPENCODE_PLUGIN_CMD_0')]);
			expect(options?.env).toMatchObject({
				OPENCODE_PLUGIN_CMD_0: 'powershell.exe',
				OPENCODE_PLUGIN_CMD_1: '-NoLogo',
				OPENCODE_PLUGIN_CMD_5: '-File',
				OPENCODE_PLUGIN_CMD_6: 'C:\\Users\\test\\opencode.ps1',
				OPENCODE_PLUGIN_CMD_7: 'export',
				OPENCODE_PLUGIN_CMD_8: 'session-1',
			});
			mockProcess.emitClose(1);
			await expect(promise).resolves.toBeNull();
		} finally {
			platform.mockRestore();
		}
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
		vi.mocked(fs.statSync).mockReturnValue({ isFile: () => true } as fs.Stats);
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

	it('lists OpenCode v2 sessions through the directory-scoped API', async () => {
		const pages = [{
			data: [{
				id: 'ses_v2',
				title: 'V2 session',
				projectID: 'project-v2',
				location: { directory: '/vault notes' },
				time: { created: 10, updated: 20 },
			}, {
				id: 'ses_v2_child',
				title: 'Child session',
				projectID: 'project-v2',
				parentID: 'ses_v2',
				location: { directory: '/vault notes' },
				time: { created: 11, updated: 12 },
			}],
			cursor: { next: 'next/page' },
		}, {
			data: [{
				id: 'ses_v2_older',
				title: 'Older v2 session',
				projectID: 'project-v2',
				location: { directory: '/vault notes' },
				time: { created: 5, updated: 8 },
			}],
			cursor: {},
		}];
		mockExecFile.mockImplementation((_cmd, _args, _opts, callback) => {
			const page = pages.shift();
			(callback as unknown as (error: null, stdout: string, stderr: string) => void)(
				null,
				JSON.stringify(page),
				'',
			);
			return {} as unknown as ChildProcess;
		});
		const client = new OpencodeClient('opencode2', '/vault notes');

		await expect(client.listSessions('v2')).resolves.toEqual([{
			id: 'ses_v2',
			title: 'V2 session',
			projectId: 'project-v2',
			directory: '/vault notes',
			created: 10,
			updated: 20,
		}, {
			id: 'ses_v2_older',
			title: 'Older v2 session',
			projectId: 'project-v2',
			directory: '/vault notes',
			created: 5,
			updated: 8,
		}]);
		expect(mockExecFile).toHaveBeenNthCalledWith(
			1,
			'opencode2',
			['api', 'get', '/api/session?directory=%2Fvault%20notes&roots=true'],
			expect.objectContaining({ cwd: '/vault notes' }),
			expect.any(Function),
		);
		expect(mockExecFile).toHaveBeenNthCalledWith(
			2,
			'opencode2',
			['api', 'get', '/api/session?directory=%2Fvault%20notes&roots=true&cursor=next%2Fpage'],
			expect.objectContaining({ cwd: '/vault notes' }),
			expect.any(Function),
		);
	});

	it('treats a null OpenCode v2 next cursor as the end of pagination', async () => {
		mockExecResult(JSON.stringify({
			data: [],
			cursor: { next: null, previous: null },
		}), '');

		await expect(new OpencodeClient('opencode2', '/vault').listSessions('v2'))
			.resolves.toEqual([]);
		expect(mockExecFile).toHaveBeenCalledTimes(1);
	});

	it('rejects malformed OpenCode v2 API envelopes', async () => {
		mockExecResult(JSON.stringify({ sessions: [] }), '');

		await expect(new OpencodeClient('opencode2', '/vault').listSessions('v2'))
			.rejects.toBeInstanceOf(MalformedCliOutputError);
	});

	it('uses the shared user-local executable detection when the configured path is empty', async () => {
		const detected = path.join(os.homedir(), '.opencode/bin/opencode');
		vi.mocked(fs.accessSync).mockImplementation((candidate) => {
			if (candidate !== detected) throw new Error('not found');
		});
		mockExecResult('[]', '');

		await new OpencodeClient('', '/vault').listSessions();

		expect(mockExecFile).toHaveBeenCalledWith(
			detected,
			['session', 'list', '--format', 'json'],
			expect.objectContaining({ cwd: '/vault' }),
			expect.any(Function)
		);
	});

	it('passes configured variables without dropping the inherited environment', async () => {
		const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');
		mockExecResult('[]', '');
		const client = new OpencodeClient('opencode', '/tmp', { OPENCODE_CONFIG_DIR: '/tmp/vault', EMPTY: '' });
		try {
			await client.listSessions();
			expect(mockExecFile).toHaveBeenCalledOnce();
			const [file, args, options] = mockExecFile.mock.calls[0];
			expect(file).toBe('opencode');
			expect(args).toEqual(['session', 'list', '--format', 'json']);
			expect(options).toMatchObject({
				env: {
					HOME: process.env.HOME,
					OPENCODE_CONFIG_DIR: '/tmp/vault',
					EMPTY: '',
				},
			});
		} finally {
			platform.mockRestore();
		}
	});

	it('falls back to stderr when stdout is empty (issue #25 repro)', async () => {
		const sessions = [{ id: 'ses_1', title: 't', updated: 1, created: 1, projectId: 'p', directory: '/tmp' }];
		mockExecResult('', JSON.stringify(sessions));
		const client = new OpencodeClient('opencode', '/tmp');
		await expect(client.listSessions()).resolves.toEqual(sessions);
	});

	it('reports empty command output as malformed instead of a genuine empty list', async () => {
		mockExecResult('', '');
		const client = new OpencodeClient('opencode', '/tmp');
		await expect(client.listSessions()).rejects.toBeInstanceOf(MalformedCliOutputError);
	});

	it('throws a typed error when the OpenCode executable cannot be started', async () => {
		mockExecFile.mockImplementation((_cmd, _args, _opts, callback) => {
			const error = Object.assign(new Error('spawn opencode ENOENT'), { code: 'ENOENT' });
			(callback as unknown as (error: Error) => void)(error);
			return {} as unknown as ChildProcess;
		});

		await expect(new OpencodeClient('/missing/opencode', '/vault').listSessions())
			.rejects.toBeInstanceOf(CliNotFoundError);
	});

	it('throws a typed error when the OpenCode executable is not permitted to run', async () => {
		mockExecFile.mockImplementation((_cmd, _args, _opts, callback) => {
			const error = Object.assign(new Error('spawn opencode EACCES'), { code: 'EACCES' });
			(callback as unknown as (error: Error) => void)(error);
			return {} as unknown as ChildProcess;
		});

		await expect(new OpencodeClient('/restricted/opencode', '/vault').listSessions())
			.rejects.toBeInstanceOf(CliPermissionError);
	});

	it('reports an unsupported CLI when session listing fails with an unknown option', async () => {
		mockExecResult('', 'Error: unknown option --format\n');
		const client = new OpencodeClient('opencode', '/tmp');
		await expect(client.listSessions()).rejects.toBeInstanceOf(UnsupportedCliError);
	});

	it('throws a typed error when session output is malformed', async () => {
		mockExecResult('{not-json', '');
		await expect(new OpencodeClient('opencode', '/tmp').listSessions())
			.rejects.toBeInstanceOf(MalformedCliOutputError);
	});

	it('rejects malformed entries inside a session array', async () => {
		mockExecResult('[{}]', '');
		await expect(new OpencodeClient('opencode', '/tmp').listSessions())
			.rejects.toBeInstanceOf(MalformedCliOutputError);
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

	it('classifies a missing executable reported through the Windows command host', async () => {
		const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
		mockExecFile.mockImplementation((_cmd, _args, _opts, callback) => {
			const error = Object.assign(new Error('Command failed'), { code: 1 });
			(callback as unknown as (error: Error, stdout: string, stderr: string) => void)(error, '', 'spawn opencode ENOENT');
			return {} as unknown as ChildProcess;
		});

		try {
			await expect(new OpencodeClient('C:\\missing\\opencode.exe', 'C:\\vault').listSessions())
				.rejects.toBeInstanceOf(CliNotFoundError);
		} finally {
			platform.mockRestore();
		}
	});

	it('routes a configured PowerShell script through powershell.exe', async () => {
		const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
		mockExecResult('[]', '');
		const executable = 'C:\\Users\\test\\opencode.ps1';

		try {
			await new OpencodeClient(executable, 'C:\\vault').listSessions();
			expect(mockExecFile).toHaveBeenCalledWith(
				'node.exe',
				['-e', expect.stringMatching(/\.ps1[\s\S]*powershell\.exe/), 'C:\\vault', executable, 'session', 'list', '--format', 'json'],
				expect.objectContaining({ windowsHide: true }),
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
				}),
				expect.any(Function)
			);
			const options: unknown = mockExecFile.mock.calls[0]?.[2];
			if (typeof options !== 'object' || options === null || !('env' in options)) {
				throw new Error('Expected exec options with an environment');
			}
			const env = (options as Record<string, unknown>).env;
			if (typeof env !== 'object' || env === null) {
				throw new Error('Expected exec environment with PATH');
			}
			const childEnv = env as Record<string, unknown>;
			if (typeof childEnv.PATH !== 'string') throw new Error('Expected exec environment with PATH');
			expect(childEnv.PATH).toContain('C:\\tools');
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

	it('uses the OpenCode v2 API through the Flatpak host bridge', async () => {
		vi.mocked(fs.existsSync).mockReturnValue(true);
		mockExecResult('', '');
		vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ data: [], cursor: {} }));

		await expect(new OpencodeClient('/host/bin/opencode2', '/vault notes').listSessions('v2'))
			.resolves.toEqual([]);
		const shellCommand = mockExecFile.mock.calls[0]?.[1]?.at(-1);
		expect(shellCommand).toContain("'/host/bin/opencode2' 'api' 'get' '/api/session?directory=%2Fvault%20notes&roots=true'");
	});

	it('classifies a missing executable reported by the Flatpak host shell', async () => {
		vi.mocked(fs.existsSync).mockReturnValue(true);
		mockExecFile.mockImplementation((_cmd, _args, _opts, callback) => {
			const error = Object.assign(new Error('Command failed'), { code: 127 });
			(callback as unknown as (error: Error, stdout: string, stderr: string) => void)(error, '', 'sh: opencode: not found');
			return {} as unknown as ChildProcess;
		});

		await expect(new OpencodeClient('opencode', '/vault').listSessions())
			.rejects.toBeInstanceOf(CliNotFoundError);
		const shellCommand = mockExecFile.mock.calls[0]?.[1]?.at(-1);
		expect(shellCommand).not.toContain('2>/dev/null');
	});

	it('forwards configured variables to the Flatpak host', async () => {
		const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');
		vi.mocked(fs.existsSync).mockReturnValue(true);
		mockExecResult('', '');
		vi.mocked(fs.readFileSync).mockReturnValue('[]');
		const client = new OpencodeClient('opencode', '/tmp', {
			OPENCODE_CONFIG_DIR: '/tmp/vault',
			PATH: '/host/configured/bin',
		});
		try {
			await client.listSessions();
			expect(mockExecFile).toHaveBeenCalledWith('flatpak-spawn', [
				'--host',
				'--env=OPENCODE_CONFIG_DIR=/tmp/vault',
				'--env=PATH=/host/configured/bin',
				'sh',
				'-c',
				expect.any(String),
			], expect.any(Object), expect.any(Function));
			const options: unknown = mockExecFile.mock.calls[0]?.[2];
			if (typeof options !== 'object' || options === null || !('env' in options)) {
				throw new Error('Expected Flatpak launch options with an environment');
			}
			const env: unknown = (options as Record<string, unknown>).env;
			if (typeof env !== 'object' || env === null) throw new Error('Expected Flatpak launcher environment');
			const launcherPath = (env as Record<string, unknown>).PATH;
			if (typeof launcherPath !== 'string') throw new Error('Expected Flatpak launcher PATH');
			expect(launcherPath).not.toContain('/host/configured/bin');
		} finally {
			platform.mockRestore();
		}
	});
});

describe('OpencodeClient compatibility', () => {
	const mockExecFile = vi.mocked(execFile);

	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(fs.accessSync).mockImplementation(() => { throw new Error('not found'); });
		vi.mocked(fs.existsSync).mockReturnValue(false);
	});

	it('rejects Codex even though it can run inside the terminal PTY', async () => {
		mockExecFile.mockImplementation((_cmd, _args, _opts, callback) => {
			(callback as unknown as (error: null, stdout: string, stderr: string) => void)(null, 'Codex CLI\nUsage: codex [OPTIONS]', '');
			return {} as unknown as ChildProcess;
		});

		await expect(new OpencodeClient('/usr/bin/codex', '/vault').checkCompatibility())
			.rejects.toBeInstanceOf(IncompatibleCliError);
	});

	it('reports an unsupported help command as an incompatible executable', async () => {
		mockExecFile.mockImplementation((_cmd, _args, _opts, callback) => {
			const error = Object.assign(new Error('unknown option --help'), { code: 1 });
			(callback as unknown as (error: Error, stdout: string, stderr: string) => void)(error, '', 'unknown option --help');
			return {} as unknown as ChildProcess;
		});

		await expect(new OpencodeClient('/usr/bin/other-agent', '/vault').checkCompatibility())
			.rejects.toBeInstanceOf(IncompatibleCliError);
	});

	it.each([
		['stable', 'opencode [project]  start opencode tui'],
		['v2', 'OpenCode 2.0 preview command line interface'],
	] as const)('accepts %s OpenCode help output', async (generation, output) => {
		mockExecFile.mockImplementation((_cmd, _args, _opts, callback) => {
			(callback as unknown as (error: null, stdout: string, stderr: string) => void)(null, output, '');
			return {} as unknown as ChildProcess;
		});

		await expect(new OpencodeClient('opencode', '/vault').checkCompatibility())
			.resolves.toMatchObject({ generation });
	});

	it('probes configured PowerShell wrappers through the Windows command host', async () => {
		const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
		mockExecFile.mockImplementation((_cmd, _args, _opts, callback) => {
			(callback as unknown as (error: null, stdout: string, stderr: string) => void)(null, 'start opencode tui', '');
			return {} as unknown as ChildProcess;
		});
		const wrapper = 'C:\\tools\\opencode-wrapper.ps1';

		try {
			await expect(new OpencodeClient(wrapper, 'C:\\vault').checkCompatibility())
				.resolves.toEqual({ generation: 'stable', executable: wrapper });
			expect(mockExecFile).toHaveBeenCalledWith(
				'node.exe',
				['-e', expect.stringMatching(/\.ps1[\s\S]*powershell\.exe/), 'C:\\vault', wrapper, '--help'],
				expect.objectContaining({ windowsHide: true }),
				expect.any(Function)
			);
		} finally {
			platform.mockRestore();
		}
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
