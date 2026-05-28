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
        const processNext = (index: number) => {
            if (index >= filesToProcess.length) return;
            
            const filePath = filesToProcess[index];
            context.ptyWrite(`@${filePath}`);
            
            setTimeout(() => {
                // If there is a next file, insert a space so they don't stick together.
                // We DO NOT inject a space (or Enter/Tab) after the LAST file.
                // This guarantees the TUI mention menu stays OPEN for the user to manually confirm.
                if (index < filesToProcess.length - 1) {
                    context.ptyWrite(' ');
                }
                
                setTimeout(() => {
                    processNext(index + 1);
                }, 50);
            }, 100);
        };
        
        processNext(0);
    }
}
