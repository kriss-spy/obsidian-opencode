interface DraggableFile {
    path?: string;
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
    onFileDrop?: (filePath: string) => void;
}

function isDragManagerDraggable(val: unknown): val is DragManagerDraggable {
    return typeof val === 'object' && val !== null;
}

export function handleTerminalDrop(context: DropContext): void {
    const filesToProcess: string[] = [];

    const dragMgr = context.dragManager;
    const draggable = dragMgr && isDragManagerDraggable(dragMgr.draggable) ? dragMgr.draggable : undefined;

    if (draggable?.type === 'file') {
        if (draggable.file?.path) {
            filesToProcess.push(draggable.file.path);
        }
    } else if (draggable?.type === 'files') {
        if (Array.isArray(draggable.files)) {
            for (const file of draggable.files) {
                if (file?.path) filesToProcess.push(file.path);
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

    // New WebSocket-based path: stagger messages so the TUI can render each mention
    if (context.onFileDrop) {
        const sendNext = (index: number) => {
            if (index >= filesToProcess.length) return;
            context.onFileDrop!(filesToProcess[index]);
            if (index < filesToProcess.length - 1) {
                window.setTimeout(() => sendNext(index + 1), 75);
            }
        };
        sendNext(0);
        return;
    }

    // Legacy terminal keystroke injection path
    if (!context.terminalInput) return;

    const processNext = (index: number) => {
        if (index >= filesToProcess.length) return;
        
        const filePath = filesToProcess[index];
        context.terminalInput!(`@${filePath}`);
        
        window.setTimeout(() => {
            // If there is a next file, insert a space so they don't stick together.
            // We DO NOT inject a space (or Enter/Tab) after the LAST file.
            // This guarantees the TUI mention menu stays OPEN for the user to manually confirm.
            if (index < filesToProcess.length - 1) {
                context.terminalInput!(' ');
            }
            
            window.setTimeout(() => {
                processNext(index + 1);
            }, 50);
        }, 100);
    };
    
    processNext(0);
}
