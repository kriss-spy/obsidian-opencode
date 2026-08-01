import { describe, it, expect } from 'vitest';
import { normalizeVaultPath } from './path';

describe('normalizeVaultPath', () => {
    it('should keep an already-relative path as-is', () => {
        expect(normalizeVaultPath('folder/note.md', '/home/user/vault')).toBe('folder/note.md');
    });

    it('should convert an absolute path inside the vault to relative', () => {
        expect(normalizeVaultPath('/home/user/vault/folder/note.md', '/home/user/vault')).toBe('folder/note.md');
    });

    it('should use Obsidian separators for a native relative path', () => {
        const vaultRoot = process.platform === 'win32' ? 'C:\\vault' : '/vault';
        const filePath = process.platform === 'win32' ? 'C:\\vault\\folder\\note.md' : '/vault/folder/note.md';
        expect(normalizeVaultPath(filePath, vaultRoot)).toBe('folder/note.md');
    });

    it('should preserve an absolute path outside the vault', () => {
        expect(normalizeVaultPath('/home/other/file.md', '/home/user/vault')).toBe('/home/other/file.md');
    });
});
