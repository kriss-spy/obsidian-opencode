export class SessionState {
	sessionArgs: string[] | null = null;
	sessionCwd: string | null = null;
	pendingPrompt: string | null = null;

	setNewSession(): void {
		this.sessionArgs = [];
		this.sessionCwd = null;
	}

	setContinueLastSession(): void {
		this.sessionArgs = ["-c"];
		this.sessionCwd = null;
	}

	setOpenSession(sessionId: string, directory: string): void {
		this.sessionArgs = ["-s", sessionId];
		this.sessionCwd = directory;
	}

	setPendingPrompt(prompt: string): void {
		this.pendingPrompt = prompt;
	}

	consumeArgs(): { args: string[] | null; cwd: string | null; prompt: string | null } {
		const result = {
			args: this.sessionArgs,
			cwd: this.sessionCwd,
			prompt: this.pendingPrompt,
		};
		this.sessionArgs = null;
		this.sessionCwd = null;
		this.pendingPrompt = null;
		return result;
	}
}
