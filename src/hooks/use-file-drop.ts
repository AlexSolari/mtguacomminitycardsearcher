import { useEffect, useRef, useState, type DragEvent } from 'react';

const hasFiles = (e: DragEvent) => e.dataTransfer.types.includes('Files');

// Accept files dropped onto one element: spread `handlers` onto it and show a drop hint while `dragging`.
// Dropped text (not files) is left alone, so e.g. a textarea still inserts it as usual.
export function useFileDrop(onFiles: (files: FileList) => void) {
    const depth = useRef(0); // dragenter/leave fire for every child element; count to know when we truly left
    const [dragging, setDragging] = useState(false);

    const handlers = {
        onDragEnter(e: DragEvent) {
            if (!hasFiles(e)) return;
            e.preventDefault();
            depth.current++;
            setDragging(true);
        },
        onDragOver(e: DragEvent) {
            if (!hasFiles(e)) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
        },
        onDragLeave(e: DragEvent) {
            if (!hasFiles(e)) return;
            if (--depth.current <= 0) setDragging(false);
        },
        onDrop(e: DragEvent) {
            if (!hasFiles(e)) return;
            e.preventDefault();
            depth.current = 0;
            setDragging(false);
            onFiles(e.dataTransfer.files);
        }
    };

    return { dragging, handlers };
}

// A file dropped anywhere outside a drop zone would make the browser navigate to it — swallow those drops.
export function usePreventFileDropNavigation() {
    useEffect(() => {
        const block = (e: globalThis.DragEvent) => {
            if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
        };
        window.addEventListener('dragover', block);
        window.addEventListener('drop', block);
        return () => {
            window.removeEventListener('dragover', block);
            window.removeEventListener('drop', block);
        };
    }, []);
}
