import { describe, it, expect, vi } from 'vitest';

vi.mock('obsidian', () => ({
	App: class {},
	TFile: class MockTFile {
		path: string;
		name: string;
		constructor() {
			this.path = '';
			this.name = '';
		}
	},
	Notice: class {
		constructor(message: string) {}
	},
	moment: (timestamp: number) => ({
		format: (fmt: string) => '2024-01-01 12:00:00',
	}),
}));

import { SessionExporter } from './sessionExporter';
import { OpencodeSession, OpencodeExport } from '../utils/opencode';
import { TFile } from 'obsidian';

const createMockApp = () => {
	const files: Record<string, any> = {};
	return {
		vault: {
			createFolder: vi.fn().mockResolvedValue(undefined),
			getAbstractFileByPath: vi.fn((path: string) => files[path] || null),
			create: vi.fn().mockImplementation((path: string, content: string) => {
				files[path] = { name: path.split('/').pop(), path, content };
				return Promise.resolve(files[path]);
			}),
			modify: vi.fn().mockResolvedValue(undefined),
		},
	};
};

describe('SessionExporter', () => {
	it('should create a new note for a session', async () => {
		const app = createMockApp() as any;
		const exporter = new SessionExporter(app);

		const session: OpencodeSession = {
			id: 'session-123',
			title: 'Test Session',
			updated: Date.now(),
			created: Date.now(),
			projectId: 'proj-1',
			directory: '/home/user/project',
		};

		const data: OpencodeExport = {
			info: {
				id: 'session-123',
				slug: 'test-session',
				projectID: 'proj-1',
				directory: '/home/user/project',
				path: '/home/user/project',
				title: 'Test Session',
				agent: 'default',
				model: { id: 'gpt-4', providerID: 'openai' },
				version: '1.0',
				summary: { additions: 0, deletions: 0, files: 0 },
				cost: 0.001,
				tokens: { input: 100, output: 50, reasoning: 0 },
				time: { created: Date.now(), updated: Date.now() },
			},
			messages: [
				{
					info: { role: 'user', id: 'msg-1', sessionID: 'session-123', time: { created: Date.now() } },
					parts: [{ type: 'text', text: 'Hello', id: 'part-1', sessionID: 'session-123', messageID: 'msg-1' }],
				},
			],
		};

		await exporter.exportToNote(session, data);

		expect(app.vault.createFolder).toHaveBeenCalledWith('OpenCode');
		expect(app.vault.create).toHaveBeenCalled();
	});

	it('should modify existing note if it already exists', async () => {
		const app = createMockApp() as any;
		const exporter = new SessionExporter(app);

		const existingFile = new (TFile as any)();
		existingFile.path = 'OpenCode/Test_Session.md';
		existingFile.name = 'Test_Session.md';
		app.vault.getAbstractFileByPath.mockReturnValue(existingFile);

		const session: OpencodeSession = {
			id: 'session-123',
			title: 'Test Session',
			updated: Date.now(),
			created: Date.now(),
			projectId: 'proj-1',
			directory: '/home/user/project',
		};

		const data: OpencodeExport = {
			info: {
				id: 'session-123',
				slug: 'test-session',
				projectID: 'proj-1',
				directory: '/home/user/project',
				path: '/home/user/project',
				title: 'Test Session',
				agent: 'default',
				model: { id: 'gpt-4', providerID: 'openai' },
				version: '1.0',
				summary: { additions: 0, deletions: 0, files: 0 },
				cost: 0.001,
				tokens: { input: 100, output: 50, reasoning: 0 },
				time: { created: Date.now(), updated: Date.now() },
			},
			messages: [],
		};

		await exporter.exportToNote(session, data);

		expect(app.vault.modify).toHaveBeenCalledWith(existingFile, expect.any(String));
	});
});
