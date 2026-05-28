import { describe, it, expect, vi } from 'vitest';
import { handleTerminalDrop } from './terminalDrop';

describe('TerminalDropHandler', () => {
    it('should inject @filePath, Tab, and Space when a single internal note is dropped', async () => {
        vi.useFakeTimers();

        // Arrange
        const ptyWriteMock = vi.fn();
        
        // Mock Obsidian's drag manager for a single file
        const mockDragManager = {
            draggable: {
                type: 'file',
                file: { path: 'folder/note.md' }
            }
        };

        // Act
        handleTerminalDrop({
            dragManager: mockDragManager,
            dataTransfer: null,
            ptyWrite: ptyWriteMock
        });

        // Assert immediately after drop
        expect(ptyWriteMock).toHaveBeenCalledTimes(1);
        expect(ptyWriteMock).toHaveBeenNthCalledWith(1, '@folder/note.md');

        // Advance time to trigger Tab
        await vi.advanceTimersByTimeAsync(300);

        expect(ptyWriteMock).toHaveBeenCalledTimes(2);
        expect(ptyWriteMock).toHaveBeenNthCalledWith(2, '\t');
        
        // Advance time to trigger Space
        await vi.advanceTimersByTimeAsync(50);
        
        expect(ptyWriteMock).toHaveBeenCalledTimes(3);
        expect(ptyWriteMock).toHaveBeenNthCalledWith(3, ' ');

        vi.useRealTimers();
    });

    it('should inject @filePath, Tab, and Space when a single external OS file is dropped (dataTransfer)', async () => {
        vi.useFakeTimers();
        const ptyWriteMock = vi.fn();

        // No internal Obsidian file
        const mockDragManager = {};
        
        // Mock external OS file drop
        const mockDataTransfer = {
            files: [
                { path: '/Users/test/external.txt' }
            ]
        };

        // Act
        handleTerminalDrop({
            dragManager: mockDragManager,
            dataTransfer: mockDataTransfer,
            ptyWrite: ptyWriteMock
        });

        // Assert immediately after drop
        expect(ptyWriteMock).toHaveBeenCalledTimes(1);
        expect(ptyWriteMock).toHaveBeenNthCalledWith(1, '@/Users/test/external.txt');

        // Advance time to trigger Tab
        await vi.advanceTimersByTimeAsync(300);

        expect(ptyWriteMock).toHaveBeenCalledTimes(2);
        expect(ptyWriteMock).toHaveBeenNthCalledWith(2, '\t');
        
        // Advance time to trigger Space
        await vi.advanceTimersByTimeAsync(50);
        
        expect(ptyWriteMock).toHaveBeenCalledTimes(3);
        expect(ptyWriteMock).toHaveBeenNthCalledWith(3, ' ');

        vi.useRealTimers();
    });

    it('should inject @filePath, Tab, and Space sequentially with delays when multiple internal notes are dropped', async () => {
        vi.useFakeTimers();
        const ptyWriteMock = vi.fn();

        const mockDragManager = {
            draggable: {
                type: 'files',
                files: [
                    { path: 'folder/note1.md' },
                    { path: 'folder/note2.md' }
                ]
            }
        };

        // Act
        handleTerminalDrop({
            dragManager: mockDragManager,
            dataTransfer: null,
            ptyWrite: ptyWriteMock
        });

        // First file is injected immediately
        expect(ptyWriteMock).toHaveBeenCalledTimes(1);
        expect(ptyWriteMock).toHaveBeenNthCalledWith(1, '@folder/note1.md');

        // Advance for first Tab
        await vi.advanceTimersByTimeAsync(300);
        expect(ptyWriteMock).toHaveBeenCalledTimes(2);
        expect(ptyWriteMock).toHaveBeenNthCalledWith(2, '\t');
        
        // Advance for first Space
        await vi.advanceTimersByTimeAsync(50);
        expect(ptyWriteMock).toHaveBeenCalledTimes(3);
        expect(ptyWriteMock).toHaveBeenNthCalledWith(3, ' ');

        // Advance for second file injection
        await vi.advanceTimersByTimeAsync(50);
        expect(ptyWriteMock).toHaveBeenCalledTimes(4);
        expect(ptyWriteMock).toHaveBeenNthCalledWith(4, '@folder/note2.md');

        // Advance for second Tab
        await vi.advanceTimersByTimeAsync(300);
        expect(ptyWriteMock).toHaveBeenCalledTimes(5);
        expect(ptyWriteMock).toHaveBeenNthCalledWith(5, '\t');
        
        // Advance for second Space
        await vi.advanceTimersByTimeAsync(50);
        expect(ptyWriteMock).toHaveBeenCalledTimes(6);
        expect(ptyWriteMock).toHaveBeenNthCalledWith(6, ' ');

        vi.useRealTimers();
    });
});
