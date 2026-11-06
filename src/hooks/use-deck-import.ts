import { useState } from 'react';
import { DeckFileError, deckFileToNames } from '@/deckfile';
import { parseCardList } from '@/decklist';
import { CARDS, FILES, plural } from '@/i18n';

export type ImportNote = { ok: boolean; text: string };

// Reads dropped/uploaded deck files in the browser and hands over the unique card names they contain.
// `note` reports what happened ("Імпортовано 60 карт з deck.txt") until `clearNote` is called.
export function useDeckImport(onNames: (names: string[]) => void) {
    const [note, setNote] = useState<ImportNote | null>(null);

    async function importFiles(fileList: FileList | File[]) {
        const files = Array.from(fileList);
        const names: string[] = [];
        const problems: string[] = [];
        for (const file of files) {
            try {
                names.push(...(await deckFileToNames(file)));
            } catch (err) {
                problems.push(
                    err instanceof DeckFileError
                        ? err.message
                        : `${file.name}: не вдалося прочитати файл`
                );
            }
        }
        const unique = parseCardList(names.join('\n')).names;
        if (unique.length > 0) onNames(unique);

        const source =
            files.length === 1 ? files[0]!.name : plural(files.length, FILES);
        if (unique.length > 0)
            setNote({
                ok: true,
                text:
                    `Імпортовано ${plural(unique.length, CARDS)} з ${source}` +
                    (problems.length ? ` · ${problems.join('; ')}` : '')
            });
        else
            setNote({
                ok: false,
                text: problems.length
                    ? problems.join('; ')
                    : `У ${source} не знайдено карт`
            });
    }

    return { note, clearNote: () => setNote(null), importFiles };
}
