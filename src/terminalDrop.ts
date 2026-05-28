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
            
            // Wait for TUI autocomplete menu to open
            setTimeout(() => {
                // Use Tab instead of Enter to confirm autocomplete safely
                // (Enter submits the prompt if the menu isn't open)
                context.ptyWrite('\t');
                
                setTimeout(() => {
                    // Add a space after the pill so the user can keep typing or drop another file
                    context.ptyWrite(' ');
                    
                    setTimeout(() => {
                        processNext(index + 1);
                    }, 50);
                }, 50);
            }, 300); // Increased delay to ensure TUI has time to search and render the menu
        };
        
        processNext(0);
    }
}
