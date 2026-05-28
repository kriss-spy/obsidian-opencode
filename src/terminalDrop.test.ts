import { describe, it, expect, vi } from 'vitest';
import { handleTerminalDrop } from './terminalDrop';

describe('TerminalDropHandler', () => {
    it('should inject @, path, Enter, and Space sequentially with proper delays for a single file', async () => {
        vi.useFakeTimers();
        const ptyWriteMock = vi.fn();
        
        handleTerminalDrop({
            dragManager: { draggable: { type: 'file', file: { path: 'folder/note.md' } } },
            ptyWrite: ptyWriteMock
        });

        // 1. Sends @ immediately
        expect(ptyWriteMock).toHaveBeenCalledTimes(1);
        expect(ptyWriteMock).toHaveBeenNthCalledWith(1, '@');

        // 2. Wait 50ms, sends path
        await vi.advanceTimersByTimeAsync(50);
        expect(ptyWriteMock).toHaveBeenCalledTimes(2);
        expect(ptyWriteMock).toHaveBeenNthCalledWith(2, 'folder/note.md');

        // 3. Wait 300ms for fuzzy search, sends Enter
        await vi.advanceTimersByTimeAsync(300);
        expect(ptyWriteMock).toHaveBeenCalledTimes(3);
        expect(ptyWriteMock).toHaveBeenNthCalledWith(3, '\r');

        // 4. Wait 50ms, sends space
        await vi.advanceTimersByTimeAsync(50);
        expect(ptyWriteMock).toHaveBeenCalledTimes(4);
        expect(ptyWriteMock).toHaveBeenNthCalledWith(4, ' ');

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
        expect(ptyWriteMock).toHaveBeenNthCalledWith(1, '@');
        await vi.advanceTimersByTimeAsync(50);
        expect(ptyWriteMock).toHaveBeenNthCalledWith(2, 'file1.md');
        await vi.advanceTimersByTimeAsync(300);
        expect(ptyWriteMock).toHaveBeenNthCalledWith(3, '\r');
        await vi.advanceTimersByTimeAsync(50);
        expect(ptyWriteMock).toHaveBeenNthCalledWith(4, ' ');

        // File 2 starts after 50ms
        await vi.advanceTimersByTimeAsync(50);
        expect(ptyWriteMock).toHaveBeenNthCalledWith(5, '@');
        await vi.advanceTimersByTimeAsync(50);
        expect(ptyWriteMock).toHaveBeenNthCalledWith(6, 'file2.md');
        await vi.advanceTimersByTimeAsync(300);
        expect(ptyWriteMock).toHaveBeenNthCalledWith(7, '\r');
        await vi.advanceTimersByTimeAsync(50);
        expect(ptyWriteMock).toHaveBeenNthCalledWith(8, ' ');

        vi.useRealTimers();
    });
});
