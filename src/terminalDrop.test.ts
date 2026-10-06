import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { handleTerminalDrop } from './terminalDrop';

describe('TerminalDropHandler', () => {
    beforeAll(() => {
        vi.stubGlobal('window', {
            get setTimeout() {
                return setTimeout;
            }
        });
    });
    beforeEach(() => vi.useFakeTimers());
    afterEach(async () => {
        try { await vi.runAllTimersAsync(); }
        finally { vi.useRealTimers(); }
    });
    afterAll(() => {
        vi.unstubAllGlobals();
    });
    it('should inject @filePath and stop (leaving menu open) for a single file', async () => {
        const terminalInputMock = vi.fn();
        
        handleTerminalDrop({
            dragManager: { draggable: { type: 'file', file: { path: 'folder/note.md' } } },
            terminalInput: terminalInputMock
        });

        expect(terminalInputMock).toHaveBeenCalledTimes(1);
        expect(terminalInputMock).toHaveBeenNthCalledWith(1, '@folder/note.md');

        // Fast forward all timers
        await vi.runAllTimersAsync();
        
        // No more writes!
        expect(terminalInputMock).toHaveBeenCalledTimes(1);

    });

    it('pastes a folder as plain text even with a connected editor bridge', () => {
        const onFileDrop = vi.fn(() => true), terminalInput = vi.fn(), terminalPaste = vi.fn();
        handleTerminalDrop({ dragManager: { draggable: { type: 'folder', file: { path: 'extracurricular/ACG/anime', children: [{ path: 'extracurricular/ACG/anime/a.md' }] } } }, onFileDrop, terminalInput, terminalPaste });
        expect(terminalPaste).toHaveBeenCalledExactlyOnceWith(' extracurricular/ACG/anime/ ');
        expect(onFileDrop).not.toHaveBeenCalled();
        expect(terminalInput).not.toHaveBeenCalled();
    });
    it('pastes a folder with exactly one trailing slash without an editor bridge', async () => {
        const terminalPaste = vi.fn();
        handleTerminalDrop({ dragManager: { draggable: { type: 'folder', file: { path: 'research/' } } }, terminalPaste });
        await vi.runAllTimersAsync();
        expect(terminalPaste).toHaveBeenCalledExactlyOnceWith(' research/ ');
    });
    it('preserves spaces and Unicode in pasted folder names', async () => {
        const terminalPaste = vi.fn();
        handleTerminalDrop({ dragManager: { draggable: { type: 'folder', file: { path: 'Research 笔记/my folder' } } }, terminalPaste });
        await vi.runAllTimersAsync();
        expect(terminalPaste).toHaveBeenCalledExactlyOnceWith(' Research 笔记/my folder/ ');
    });
    it('keeps mixed folder text and file line mentions in selection order', async () => {
        const delivered: string[] = [];
        handleTerminalDrop({ dragManager: { draggable: { type: 'files', files: [
            { path: 'Notes', children: [] }, { path: 'a.md' }, { path: 'Other 笔记', children: [] }, { path: 'b.md' },
        ] } }, onFileDrop: path => { delivered.push(`file:${path}`); return true; }, terminalPaste: text => delivered.push(text) });
        await vi.runAllTimersAsync();
        expect(delivered).toEqual([' Notes/ ', 'file:a.md', ' Other 笔记/ ', 'file:b.md']);
    });
    it('keeps folders as plain text after the file bridge disconnects', async () => {
        const delivered: string[] = [];
        const onFileDrop = vi.fn<(path: string) => boolean>().mockReturnValueOnce(true).mockReturnValue(false);
        handleTerminalDrop({ dragManager: { draggable: { type: 'files', files: [
            { path: 'a.md' }, { path: 'b.md' }, { path: 'Notes', children: [] }, { path: 'Research 笔记', children: [] },
        ] } }, onFileDrop, terminalInput: text => delivered.push(text), terminalPaste: text => delivered.push(text) });
        await vi.runAllTimersAsync();
        expect(delivered).toEqual(['@b.md', ' ', ' Notes/ ', ' Research 笔记/ ']);
        expect(onFileDrop.mock.calls.map(([path]) => path)).toEqual(['a.md', 'b.md']);
    });
    it('should inject space only between files for multiple files', async () => {
        const terminalInputMock = vi.fn();
        
        handleTerminalDrop({
            dragManager: { draggable: { type: 'files', files: [{ path: 'file1.md' }, { path: 'file2.md' }] } },
            terminalInput: terminalInputMock
        });

        // File 1
        expect(terminalInputMock).toHaveBeenNthCalledWith(1, '@file1.md');
        
        // Wait 100ms
        await vi.advanceTimersByTimeAsync(100);
        // Space added because there is another file
        expect(terminalInputMock).toHaveBeenNthCalledWith(2, ' ');
        
        // Wait 50ms
        await vi.advanceTimersByTimeAsync(50);
        // File 2
        expect(terminalInputMock).toHaveBeenNthCalledWith(3, '@file2.md');
        
        // Fast forward remaining
        await vi.runAllTimersAsync();
        
        // No more writes! (No trailing space, so menu stays open for file 2)
        expect(terminalInputMock).toHaveBeenCalledTimes(3);

    });

    it('should call onFileDrop immediately for a single file', () => {
        const onFileDropMock = vi.fn(() => true);
        
        handleTerminalDrop({
            dragManager: { draggable: { type: 'file', file: { path: 'folder/note.md' } } },
            onFileDrop: onFileDropMock
        });

        expect(onFileDropMock).toHaveBeenCalledTimes(1);
        expect(onFileDropMock).toHaveBeenCalledWith('folder/note.md');
    });

    it('should stagger onFileDrop calls with ~75ms delay between multi-file drops', async () => {
        const onFileDropMock = vi.fn(() => true);
        
        handleTerminalDrop({
            dragManager: { draggable: { type: 'files', files: [{ path: 'a.md' }, { path: 'b.md' }, { path: 'c.md' }] } },
            onFileDrop: onFileDropMock
        });

        // First file fires immediately
        expect(onFileDropMock).toHaveBeenCalledTimes(1);
        expect(onFileDropMock).toHaveBeenNthCalledWith(1, 'a.md');

        // Advance 75ms — second file
        await vi.advanceTimersByTimeAsync(75);
        expect(onFileDropMock).toHaveBeenCalledTimes(2);
        expect(onFileDropMock).toHaveBeenNthCalledWith(2, 'b.md');

        // Advance another 75ms — third file
        await vi.advanceTimersByTimeAsync(75);
        expect(onFileDropMock).toHaveBeenCalledTimes(3);
        expect(onFileDropMock).toHaveBeenNthCalledWith(3, 'c.md');

        // Fast forward remaining timers
        await vi.runAllTimersAsync();
        expect(onFileDropMock).toHaveBeenCalledTimes(3);

    });

    it('should prefer onFileDrop over terminalInput when both are provided', () => {
        const onFileDropMock = vi.fn(() => true);
        const terminalInputMock = vi.fn();
        
        handleTerminalDrop({
            dragManager: { draggable: { type: 'file', file: { path: 'note.md' } } },
            onFileDrop: onFileDropMock,
            terminalInput: terminalInputMock
        });

        expect(onFileDropMock).toHaveBeenCalledTimes(1);
        expect(onFileDropMock).toHaveBeenCalledWith('note.md');
        expect(terminalInputMock).not.toHaveBeenCalled();
    });

    it('should fall back to terminal input when WebSocket queueing is unavailable', () => {
        const onFileDropMock = vi.fn(() => false);
        const terminalInputMock = vi.fn();

        handleTerminalDrop({
            dragManager: { draggable: { type: 'file', file: { path: 'note.md' } } },
            onFileDrop: onFileDropMock,
            terminalInput: terminalInputMock
        });

        expect(onFileDropMock).toHaveBeenCalledWith('note.md');
        expect(terminalInputMock).toHaveBeenCalledWith('@note.md');
    });

    it('should fall back for the current and remaining files when the client disconnects mid-drop', async () => {
        const onFileDropMock = vi.fn()
            .mockReturnValueOnce(true)
            .mockReturnValueOnce(false);
        const terminalInputMock = vi.fn();

        handleTerminalDrop({
            dragManager: {
                draggable: {
                    type: 'files',
                    files: [{ path: 'a.md' }, { path: 'b.md' }, { path: 'c.md' }]
                }
            },
            onFileDrop: onFileDropMock,
            terminalInput: terminalInputMock
        });

        expect(onFileDropMock).toHaveBeenCalledWith('a.md');
        expect(terminalInputMock).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(75);
        expect(onFileDropMock).toHaveBeenNthCalledWith(2, 'b.md');
        expect(terminalInputMock).toHaveBeenNthCalledWith(1, '@b.md');

        await vi.advanceTimersByTimeAsync(100);
        expect(terminalInputMock).toHaveBeenNthCalledWith(2, ' ');

        await vi.advanceTimersByTimeAsync(50);
        expect(terminalInputMock).toHaveBeenNthCalledWith(3, '@c.md');
        expect(onFileDropMock).toHaveBeenCalledTimes(2);

    });

    it('should fall back to dataTransfer.files when dragManager has no draggable', async () => {
        const onFileDropMock = vi.fn(() => true);
        
        handleTerminalDrop({
            dragManager: {},
            dataTransfer: {
                files: [
                    { path: '/home/user/vault/external.md' } as unknown as File,
                    { path: '/home/user/vault/another.md' } as unknown as File
                ]
            } as unknown as DataTransfer,
            onFileDrop: onFileDropMock
        });

        expect(onFileDropMock).toHaveBeenCalledTimes(1);
        expect(onFileDropMock).toHaveBeenNthCalledWith(1, '/home/user/vault/external.md');

        await vi.advanceTimersByTimeAsync(75);
        expect(onFileDropMock).toHaveBeenCalledTimes(2);
        expect(onFileDropMock).toHaveBeenNthCalledWith(2, '/home/user/vault/another.md');

    });

    it('should fall back to dataTransfer.files for terminalInput when dragManager has no draggable', async () => {
        const terminalInputMock = vi.fn();
        
        handleTerminalDrop({
            dragManager: {},
            dataTransfer: {
                files: [
                    { path: 'fallback.md' } as unknown as File
                ]
            } as unknown as DataTransfer,
            terminalInput: terminalInputMock
        });

        expect(terminalInputMock).toHaveBeenCalledTimes(1);
        expect(terminalInputMock).toHaveBeenNthCalledWith(1, '@fallback.md');

        await vi.runAllTimersAsync();
        expect(terminalInputMock).toHaveBeenCalledTimes(1);

    });

    it('should ignore dataTransfer files that lack a path property', async () => {
        const onFileDropMock = vi.fn(() => true);
        
        handleTerminalDrop({
            dragManager: {},
            dataTransfer: {
                files: [
                    { path: 'valid.md' } as unknown as File,
                    { name: 'invalid.html' } as unknown as File,
                    { path: 'also-valid.md' } as unknown as File
                ]
            } as unknown as DataTransfer,
            onFileDrop: onFileDropMock
        });

        expect(onFileDropMock).toHaveBeenCalledTimes(1);
        expect(onFileDropMock).toHaveBeenNthCalledWith(1, 'valid.md');

        await vi.advanceTimersByTimeAsync(75);
        expect(onFileDropMock).toHaveBeenCalledTimes(2);
        expect(onFileDropMock).toHaveBeenNthCalledWith(2, 'also-valid.md');

    });
});
