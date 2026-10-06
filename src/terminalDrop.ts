interface DraggableFile {
    path?: string;
    children?: unknown[];
}

interface DragManagerDraggable {
    type?: string;
    file?: DraggableFile;
    files?: DraggableFile[];
}

export interface DropContext {
    dragManager?: { draggable?: unknown };
    dataTransfer?: DataTransfer | null;
    terminalInput?: (data: string) => void;
    terminalPaste?: (text: string) => void;
    onFileDrop?: (filePath: string) => boolean;
}

function isDragManagerDraggable(val: unknown): val is DragManagerDraggable {
    return typeof val === 'object' && val !== null;
}

export function handleTerminalDrop(context: DropContext): void {
    const filesToProcess: string[] = [];
    const addPath = (file: DraggableFile | undefined, folder = false) => {
        if (!file?.path) return;
        const directory = folder || Array.isArray(file.children);
        filesToProcess.push(directory ? file.path.replace(/\/+$/, '') + '/' : file.path);
    };

    const dragMgr = context.dragManager;
    const draggable = dragMgr && isDragManagerDraggable(dragMgr.draggable) ? dragMgr.draggable : undefined;

    if (draggable?.type === 'file' || draggable?.type === 'folder') {
        addPath(draggable.file, draggable.type === 'folder');
    } else if (draggable?.type === 'files') {
        if (Array.isArray(draggable.files)) {
            for (const file of draggable.files) {
                addPath(file);
            }
        }
    } else if (context.dataTransfer?.files && context.dataTransfer.files.length > 0) {
        for (let i = 0; i < context.dataTransfer.files.length; i++) {
            const file = context.dataTransfer.files[i] as unknown as { path?: string };
            if (file?.path) {
                filesToProcess.push(file.path);
            }
        }
    }

    if (filesToProcess.length === 0) return;

    const processTerminalDrop = (index: number) => {
        if (index >= filesToProcess.length) return;

        const filePath = filesToProcess[index];
        if (filePath.endsWith('/')) {
            // Folders are plain prompt text. Padding separates existing text and
            // subsequent file mentions; paste keeps whitespace in names intact.
            context.terminalPaste?.(` ${filePath} `);
        } else {
            context.terminalInput?.(`@${filePath}`);
        }

        window.setTimeout(() => {
            // If there is a next file, insert a space so they don't stick together.
            // We DO NOT inject a space (or Enter/Tab) after the LAST file.
            // This guarantees the TUI mention menu stays OPEN for the user to manually confirm.
            if (!filePath.endsWith('/') && index < filesToProcess.length - 1) {
                context.terminalInput?.(' ');
            }

            window.setTimeout(() => {
                processTerminalDrop(index + 1);
            }, 50);
        }, 100);
    };

    // New WebSocket-based path: stagger messages so the TUI can render each mention
    if (context.onFileDrop) {
        const sendNext = (index: number) => {
            if (index >= filesToProcess.length) return;
            const filePath = filesToProcess[index];
            if (filePath.endsWith('/')) {
                context.terminalPaste?.(` ${filePath} `);
                if (index < filesToProcess.length - 1) {
                    window.setTimeout(() => sendNext(index + 1), 75);
                }
                return;
            }
            const queued = context.onFileDrop?.(filePath) ?? false;
            if (!queued) {
                processTerminalDrop(index);
                return;
            }
            if (index < filesToProcess.length - 1) {
                window.setTimeout(() => sendNext(index + 1), 75);
            }
        };
        sendNext(0);
        return;
    }

    // Legacy terminal keystroke injection path
    if (!context.terminalInput && !context.terminalPaste) return;
    processTerminalDrop(0);
}
