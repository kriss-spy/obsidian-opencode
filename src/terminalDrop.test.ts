import { describe, it, expect, vi } from 'vitest';
import { handleTerminalDrop } from './terminalDrop';

describe('TerminalDropHandler', () => {
    it('should inject @filePath without Enter when a single internal note is dropped', () => {
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

        // Assert
        expect(ptyWriteMock).toHaveBeenCalledTimes(1);
        expect(ptyWriteMock).toHaveBeenNthCalledWith(1, '@folder/note.md ');
    });

    it('should inject @filePath without Enter when a single external OS file is dropped (dataTransfer)', () => {
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

        // Assert
        expect(ptyWriteMock).toHaveBeenCalledTimes(1);
        expect(ptyWriteMock).toHaveBeenNthCalledWith(1, '@/Users/test/external.txt ');
    });

    it('should inject combined @filePaths separated by spaces without Enter when multiple notes are dropped', () => {
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

        // Assert
        expect(ptyWriteMock).toHaveBeenCalledTimes(1);
        expect(ptyWriteMock).toHaveBeenNthCalledWith(1, '@folder/note1.md @folder/note2.md ');
    });
});
