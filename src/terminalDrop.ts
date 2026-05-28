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
            
            // 1. Trigger the context menu
            context.ptyWrite('@');
            
            setTimeout(() => {
                // 2. Type the path to fuzzy search
                context.ptyWrite(filePath);
                
                setTimeout(() => {
                    // 3. Confirm the selection (wait enough time for React/Ink to render the menu)
                    context.ptyWrite('\r');
                    
                    setTimeout(() => {
                        // 4. Add a space after the pill
                        context.ptyWrite(' ');
                        
                        setTimeout(() => {
                            // 5. Move to the next file
                            processNext(index + 1);
                        }, 50);
                    }, 50);
                }, 300); // 300ms is usually enough for local file search to resolve
            }, 50);
        };
        
        processNext(0);
    }
}
