import * as path from "path";

/**
 * Normalize a dropped file path relative to the vault root.
 * - If the path is already relative, return it as-is.
 * - If the path is absolute and inside the vault, return the vault-relative path.
 * - If the path is absolute and outside the vault, return the absolute path unchanged.
 */
export function normalizeVaultPath(filePath: string, vaultRoot: string): string {
	if (!path.isAbsolute(filePath)) {
		return filePath;
	}

	const relative = path.relative(vaultRoot, filePath);

	// If relative starts with ".." or is itself absolute (Windows cross-drive),
	// the file lives outside the vault.
	if (relative.startsWith("..") || path.isAbsolute(relative)) {
		return filePath;
	}

	return relative.split(path.sep).join("/");
}
