export type OpencodeStatus =
	| { kind: "idle"; tooltip: "OpenCode is idle" }
	| { kind: "running"; tooltip: "OpenCode is working" }
	| { kind: "touched"; tooltip: "OpenCode changed this note" };

export interface OpencodeStatusSession {
	id: string;
	directory: string;
	files: string[];
	running: boolean;
}

export interface OpencodeActiveSession {
	id: string;
	directory: string;
}

export interface OpencodeActivityClient {
	listActiveSessions(): Promise<OpencodeActiveSession[]>;
	listRecentlyUpdatedSessions?(): Promise<OpencodeActiveSession[]>;
	listSessionChangedFiles(sessionId: string): Promise<string[]>;
}

export class OpencodeActivitySource {
	private active = new Map<string, OpencodeStatusSession>();
	private recent: OpencodeStatusSession[] = [];
	private readonly touched = new Map<string, string[]>();

	constructor(
		private readonly client: OpencodeActivityClient,
		private readonly scopeDirectory?: string,
	) {}

	async read(): Promise<OpencodeStatusSession[]> {
		const [activeResult, recentResult] = await Promise.all([
			this.client.listActiveSessions(),
			this.client.listRecentlyUpdatedSessions?.() ?? Promise.resolve([]),
		]);
		const inScope = (session: OpencodeActiveSession) =>
			!this.scopeDirectory || directoriesOverlap(this.scopeDirectory, session.directory);
		const activeSessions = activeResult.filter(inScope);
		const recentlyUpdated = recentResult.filter(inScope);
		const nextActive = new Map<string, OpencodeStatusSession>();

		for (const session of activeSessions) {
			const previousFiles = this.touched.get(session.id) ?? [];
			const files = mergeFiles(previousFiles, await this.changedFiles(session.id, previousFiles));
			this.touched.set(session.id, files);
			nextActive.set(session.id, {
				...session,
				files,
				running: true,
			});
		}

		const completed = new Map<string, OpencodeStatusSession>();
		for (const session of Array.from(this.active.values()).filter((item) => !nextActive.has(item.id))) {
			completed.set(session.id, { ...session, running: false });
		}
		for (const session of recentlyUpdated) {
			if (!nextActive.has(session.id) && !completed.has(session.id)) {
				completed.set(session.id, { ...session, files: this.touched.get(session.id) ?? [], running: false });
			}
		}
		for (const session of completed.values()) {
			session.files = mergeFiles(session.files, await this.changedFiles(session.id, session.files));
			this.touched.set(session.id, session.files);
		}

		this.active = nextActive;
		const touchedCompleted = Array.from(completed.values()).filter((session) => session.files.length > 0);
		if (touchedCompleted.length > 0) this.recent = touchedCompleted;
		if (nextActive.size > 0) {
			return [
				...Array.from(nextActive.values()),
				...this.recent.filter((session) => !nextActive.has(session.id) && session.files.length > 0),
			];
		}
		return this.recent;
	}

	private async changedFiles(sessionId: string, fallback: string[]): Promise<string[]> {
		try {
			return await this.client.listSessionChangedFiles(sessionId);
		} catch {
			return fallback;
		}
	}
}

function mergeFiles(previous: string[], current: string[]): string[] {
	return Array.from(new Set([...previous, ...current]));
}

function directoriesOverlap(left: string, right: string): boolean {
	return isSameOrInside(left, right) || isSameOrInside(right, left);
}

function isSameOrInside(parent: string, candidate: string): boolean {
	const relative = path.relative(path.resolve(parent), path.resolve(candidate));
	return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

export class OpencodeStatusTracker {
	private sessions: OpencodeStatusSession[] = [];
	private activeFile: string | null = null;

	get status(): OpencodeStatus {
		if (this.activeFile && this.sessions.some((session) => session.files.some((file) => {
			const absoluteFile = path.isAbsolute(file) ? path.normalize(file) : path.resolve(session.directory, file);
			return absoluteFile === path.normalize(this.activeFile!);
		}))) {
			return { kind: "touched", tooltip: "OpenCode changed this note" };
		}
		return this.sessions.some((session) => session.running)
			? { kind: "running", tooltip: "OpenCode is working" }
			: { kind: "idle", tooltip: "OpenCode is idle" };
	}

	updateSessions(sessions: OpencodeStatusSession[]): void {
		this.sessions = sessions;
	}

	updateActiveFile(file: string | null): void {
		this.activeFile = file;
	}
}
import * as path from "node:path";
