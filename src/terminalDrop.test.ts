import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { handleTerminalDrop } from './terminalDrop';

describe('TerminalDropHandler', () => {
    beforeAll(() => {
        vi.stubGlobal('window', {
            get setTimeout() {
                return setTimeout;
            }
        });
    });
    afterAll(() => {
        vi.unstubAllGlobals();
    });
    it('should inject @filePath and stop (leaving menu open) for a single file', async () => {
        vi.useFakeTimers();
        const ptyWriteMock = vi.fn();
        
        handleTerminalDrop({
            dragManager: { draggable: { type: 'file', file: { path: 'folder/note.md' } } },
            ptyWrite: ptyWriteMock
        });

        expect(ptyWriteMock).toHaveBeenCalledTimes(1);
        expect(ptyWriteMock).toHaveBeenNthCalledWith(1, '@folder/note.md');

        // Fast forward all timers
        await vi.runAllTimersAsync();
        
        // No more writes!
        expect(ptyWriteMock).toHaveBeenCalledTimes(1);

        vi.useRealTimers();
    });

    it('should inject space only between files for multiple files', async () => {
        vi.useFakeTimers();
        const ptyWriteMock = vi.fn();
        
        handleTerminalDrop({
            dragManager: { draggable: { type: 'files', files: [{ path: 'file1.md' }, { path: 'file2.md' }] } },
            ptyWrite: ptyWriteMock
        });

        // File 1
        expect(ptyWriteMock).toHaveBeenNthCalledWith(1, '@file1.md');
        
        // Wait 100ms
        await vi.advanceTimersByTimeAsync(100);
        // Space added because there is another file
        expect(ptyWriteMock).toHaveBeenNthCalledWith(2, ' ');
        
        // Wait 50ms
        await vi.advanceTimersByTimeAsync(50);
        // File 2
        expect(ptyWriteMock).toHaveBeenNthCalledWith(3, '@file2.md');
        
        // Fast forward remaining
        await vi.runAllTimersAsync();
        
        // No more writes! (No trailing space, so menu stays open for file 2)
        expect(ptyWriteMock).toHaveBeenCalledTimes(3);

        vi.useRealTimers();
    });

    it('should call onFileDrop immediately for a single file', () => {
        const onFileDropMock = vi.fn();
        
        handleTerminalDrop({
            dragManager: { draggable: { type: 'file', file: { path: 'folder/note.md' } } },
            onFileDrop: onFileDropMock
        });

        expect(onFileDropMock).toHaveBeenCalledTimes(1);
        expect(onFileDropMock).toHaveBeenCalledWith('folder/note.md');
    });

    it('should stagger onFileDrop calls with ~75ms delay between multi-file drops', async () => {
        vi.useFakeTimers();
        const onFileDropMock = vi.fn();
        
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

        vi.useRealTimers();
    });

    it('should prefer onFileDrop over ptyWrite when both are provided', () => {
        const onFileDropMock = vi.fn();
        const ptyWriteMock = vi.fn();
        
        handleTerminalDrop({
            dragManager: { draggable: { type: 'file', file: { path: 'note.md' } } },
            onFileDrop: onFileDropMock,
            ptyWrite: ptyWriteMock
        });

        expect(onFileDropMock).toHaveBeenCalledTimes(1);
        expect(onFileDropMock).toHaveBeenCalledWith('note.md');
        expect(ptyWriteMock).not.toHaveBeenCalled();
    });

    it('should fall back to dataTransfer.files when dragManager has no draggable', async () => {
        vi.useFakeTimers();
        const onFileDropMock = vi.fn();
        
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

        vi.useRealTimers();
    });

    it('should fall back to dataTransfer.files for ptyWrite when dragManager has no draggable', async () => {
        vi.useFakeTimers();
        const ptyWriteMock = vi.fn();
        
        handleTerminalDrop({
            dragManager: {},
            dataTransfer: {
                files: [
                    { path: 'fallback.md' } as unknown as File
                ]
            } as unknown as DataTransfer,
            ptyWrite: ptyWriteMock
        });

        expect(ptyWriteMock).toHaveBeenCalledTimes(1);
        expect(ptyWriteMock).toHaveBeenNthCalledWith(1, '@fallback.md');

        await vi.runAllTimersAsync();
        expect(ptyWriteMock).toHaveBeenCalledTimes(1);

        vi.useRealTimers();
    });

    it('should ignore dataTransfer files that lack a path property', async () => {
        vi.useFakeTimers();
        const onFileDropMock = vi.fn();
        
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

        vi.useRealTimers();
    });
});
