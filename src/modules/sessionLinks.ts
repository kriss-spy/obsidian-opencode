import * as path from "node:path";

export interface SessionLink {
	id: string;
	directory: string;
}

export function validateSessionLink(session: SessionLink): SessionLink {
	if (!/^ses_[\w-]+$/.test(session.id)) throw new Error("The session link has an invalid session ID.");
	if (!session.directory || [...session.directory].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
		|| !(path.posix.isAbsolute(session.directory) || path.win32.isAbsolute(session.directory))) {
		throw new Error("The session link needs an absolute working directory.");
	}
	return session;
}

export function createSessionUrl(vault: string, session: SessionLink): string {
	validateSessionLink(session);
	return `obsidian://opencode?vault=${encodeURIComponent(vault)}&session=${encodeURIComponent(session.id)}&directory=${encodeURIComponent(session.directory)}`;
}

// Obsidian routes to the target vault and consumes the vault parameter before
// invoking protocol handlers. Only check it when supplied by a direct caller.
export function parseSessionParams(params: Record<string, string>, vault: string): SessionLink {
	if (params.vault !== undefined && params.vault.toLowerCase() !== vault.toLowerCase()) {
		throw new Error("This session link belongs to a different vault.");
	}
	return validateSessionLink({ id: params.session ?? "", directory: params.directory ?? "" });
}

export async function copySessionUrl(
	vault: string,
	session: SessionLink,
	write: (url: string) => Promise<void>,
	notice: (message: string) => void,
): Promise<void> {
	try {
		await write(createSessionUrl(vault, session));
		notice("Session link copied");
	} catch {
		notice("Unable to copy the session link. Check clipboard access and try again.");
	}
}
