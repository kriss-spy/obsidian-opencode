import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpencodeClient, ExportTooLargeError } from './opencode';
import { spawn } from 'child_process';
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
