import { useState } from 'react';
import { DeckFileError, deckFileToCards } from '@/deckfile';
import { formatCardList, parseCardList, type CardEntry } from '@/decklist';
import { CARDS, FILES, plural } from '@/i18n';

export type ImportNote = { ok: boolean; text: string };

// Reads dropped/uploaded deck files in the browser and hands over the cards they contain, with counts.
// `note` reports what happened ("Імпортовано 60 карт з deck.txt") until `clearNote` is called.
export function useDeckImport(onCards: (cards: CardEntry[]) => void) {
    const [note, setNote] = useState<ImportNote | null>(null);

    async function importFiles(fileList: FileList | File[]) {
        const files = Array.from(fileList);
        const cards: CardEntry[] = [];
        const problems: string[] = [];
        for (const file of files) {
            try {
                cards.push(...(await deckFileToCards(file)));
            } catch (err) {
                problems.push(
                    err instanceof DeckFileError
                        ? err.message
                        : `${file.name}: не вдалося прочитати файл`
                );
            }
        }
        // a card in several files adds up
        const unique = parseCardList(formatCardList(cards)).cards;
        if (unique.length > 0) onCards(unique);

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
