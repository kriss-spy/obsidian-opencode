import {
	CliCommandError,
	CliNotFoundError,
	CliPermissionError,
	MalformedCliOutputError,
	UnsupportedCliError,
} from "../utils/opencode";

export function sessionListErrorMessage(error: unknown): string {
	if (error instanceof CliNotFoundError) {
		return "OpenCode could not be found. Set the executable path in plugin settings, then retry.";
	}
	if (error instanceof CliPermissionError) {
		return "OpenCode could not be started because access was denied. Check the executable and sandbox permissions.";
	}
	if (error instanceof UnsupportedCliError) {
		return "Session browsing is not supported by this OpenCode CLI version.";
	}
	if (error instanceof MalformedCliOutputError) {
		return "OpenCode returned invalid session data. Check the configured CLI version and retry.";
	}
	if (error instanceof CliCommandError) {
		return "OpenCode failed while loading sessions. Check the developer console for command details.";
	}
	return "Could not run OpenCode to load sessions.";
}
