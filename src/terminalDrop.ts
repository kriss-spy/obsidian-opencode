export interface DropContext {
    dragManager?: any;
    dataTransfer?: any;
    ptyWrite: (data: string) => void;
}

export function handleTerminalDrop(context: DropContext): void {
    const filesToProcess: string[] = [];

    if (context.dragManager?.draggable?.type === 'file') {
        if (context.dragManager.draggable.file?.path) {
            filesToProcess.push(context.dragManager.draggable.file.path);
        }
    } else if (context.dragManager?.draggable?.type === 'files') {
        if (Array.isArray(context.dragManager.draggable.files)) {
            context.dragManager.draggable.files.forEach((file: any) => {
                if (file?.path) filesToProcess.push(file.path);
            });
        }
    } else if (context.dataTransfer?.files?.length > 0) {
        for (let i = 0; i < context.dataTransfer.files.length; i++) {
            if (context.dataTransfer.files[i]?.path) {
                filesToProcess.push(context.dataTransfer.files[i].path);
            }
        }
    }

    if (filesToProcess.length > 0) {
        // Just inject the paths with @ and let the user manually confirm them
        // This avoids race conditions where \r submits the prompt prematurely
        const payload = filesToProcess.map(p => `@${p}`).join(' ') + ' ';
        context.ptyWrite(payload);
    }
}
