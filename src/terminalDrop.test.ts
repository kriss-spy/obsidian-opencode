import { describe, it, expect, vi } from 'vitest';
import { handleTerminalDrop } from './terminalDrop';

describe('TerminalDropHandler', () => {
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
});
