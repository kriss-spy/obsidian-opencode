import { describe, it, expect, vi } from 'vitest';
import { handleTerminalDrop } from './terminalDrop';

describe('TerminalDropHandler', () => {
    it('should inject @filePath, Tab, and Space sequentially with proper delays', async () => {
        vi.useFakeTimers();
        const ptyWriteMock = vi.fn();
        
        handleTerminalDrop({
            dragManager: { draggable: { type: 'file', file: { path: 'folder/note.md' } } },
            ptyWrite: ptyWriteMock
        });

        // 1. Sends @filePath immediately
        expect(ptyWriteMock).toHaveBeenCalledTimes(1);
        expect(ptyWriteMock).toHaveBeenNthCalledWith(1, '@folder/note.md');

        // 2. Wait 500ms for fuzzy search, sends Tab
        await vi.advanceTimersByTimeAsync(500);
        expect(ptyWriteMock).toHaveBeenCalledTimes(2);
        expect(ptyWriteMock).toHaveBeenNthCalledWith(2, '\t');

        // 3. Wait 50ms, sends space
        await vi.advanceTimersByTimeAsync(50);
        expect(ptyWriteMock).toHaveBeenCalledTimes(3);
        expect(ptyWriteMock).toHaveBeenNthCalledWith(3, ' ');

        vi.useRealTimers();
    });

    it('should process multiple files sequentially', async () => {
        vi.useFakeTimers();
        const ptyWriteMock = vi.fn();
        
        handleTerminalDrop({
            dragManager: { draggable: { type: 'files', files: [{ path: 'file1.md' }, { path: 'file2.md' }] } },
            ptyWrite: ptyWriteMock
        });

        // File 1
        expect(ptyWriteMock).toHaveBeenNthCalledWith(1, '@file1.md');
        await vi.advanceTimersByTimeAsync(500);
        expect(ptyWriteMock).toHaveBeenNthCalledWith(2, '\t');
        await vi.advanceTimersByTimeAsync(50);
        expect(ptyWriteMock).toHaveBeenNthCalledWith(3, ' ');

        // File 2 starts after 50ms
        await vi.advanceTimersByTimeAsync(50);
        expect(ptyWriteMock).toHaveBeenNthCalledWith(4, '@file2.md');
        await vi.advanceTimersByTimeAsync(500);
        expect(ptyWriteMock).toHaveBeenNthCalledWith(5, '\t');
        await vi.advanceTimersByTimeAsync(50);
        expect(ptyWriteMock).toHaveBeenNthCalledWith(6, ' ');

        vi.useRealTimers();
    });
});
