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
            
            // 1. Send the mention and path together to reliably trigger the TUI menu
            context.ptyWrite(`@${filePath}`);
            
            setTimeout(() => {
                // 2. Use Tab to confirm the mention (Enter might submit the prompt if it arrives late)
                // 500ms delay gives the TUI fuzzy search time to open the menu
                context.ptyWrite('\t');
                
                setTimeout(() => {
                    // 3. Add a space after the pill
                    context.ptyWrite(' ');
                    
                    setTimeout(() => {
                        // 4. Move to the next file
                        processNext(index + 1);
                    }, 50);
                }, 50);
            }, 500); 
        };
        
        processNext(0);
    }
}
