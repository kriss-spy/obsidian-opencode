import { PtySession } from "./ptySession";

export class PtySessionRegistry {
	private readonly sessions = new Set<PtySession>();

	register(session: PtySession): PtySession {
		this.sessions.add(session);
		return session;
	}

	async close(session: PtySession): Promise<void> {
		this.sessions.delete(session);
		await session.kill();
	}

	async closeAll(): Promise<void> {
		const sessions = Array.from(this.sessions);
		this.sessions.clear();
		await Promise.all(sessions.map((session) => session.kill()));
	}
}
