import { describe, expect, test } from 'bun:test';
import { CardIndex } from '@/server/scryfall/card-index';

const index = new CardIndex([
    'Sol Ring',
    'Opt',
    'Æther Vial',
    "Lim-Dûl's Vault",
    'Lightning Bolt',
    [
        'Emeritus of Conflict // Lightning Bolt',
        'Emeritus of Conflict',
        'Lightning Bolt'
    ],
    [
        'Delver of Secrets // Insectile Aberration',
        'Delver of Secrets',
        'Insectile Aberration'
    ],
    "Delver's Torch",
    [
        'Fatehold Chronologist // Peer Review',
        'Fatehold Chronologist',
        'Peer Review'
    ],
    ['Semester Foreseer // Peer Review', 'Semester Foreseer', 'Peer Review'],
    'Clear the Mind',
    'Clear, the Mind',
    'Overlord of the Balemurk',
    'Ragavan, Nimble Pilferer',
    'Rashmi and Ragavan',
    'Chimney Goyf',
    'Altar of the Goyf',
    'Sword of Fire and Ice',
    'Sword of Fire and Ice and War and Peace',
    'Jace Beleren',
    'Jace, the Mind Sculptor',
    'Brainstorm',
    'Greasefang, Okiba Boss',
    'Chatterfang, Squirrel General',
    ['Bonecrusher Giant // Stomp', 'Bonecrusher Giant', 'Stomp'],
    'Gale Force',
    'Gate Force'
]);
const find = (typed: string) => index.find(typed)?.name;

describe('CardIndex', () => {
    test('finds a name ignoring case, punctuation and accents', () => {
        expect(find('sol ring')).toBe('Sol Ring');
        expect(find('aether vial')).toBe('Æther Vial');
        expect(find('lim dul s vault')).toBe("Lim-Dûl's Vault");
        expect(find('OPT')).toBe('Opt');
    });

    test('finds a card by either face, with its faces', () => {
        const delver = index.find('Insectile Aberration');
        expect(delver).toEqual({
            name: 'Delver of Secrets // Insectile Aberration',
            card_faces: [
                { name: 'Delver of Secrets' },
                { name: 'Insectile Aberration' }
            ]
        });
        expect(index.find('delver of secrets')).toBe(delver!);
    });

    test('a name that is also another card’s face is the card of that name', () => {
        expect(index.find('Lightning Bolt')).toEqual({
            name: 'Lightning Bolt'
        });
    });

    test('a face of several cards, with no card of its own, is left to Scryfall', () => {
        expect(find('Peer Review')).toBeUndefined();
    });

    test('names differing only in punctuation are one name', () => {
        expect(find('clear the mind')).toBe('Clear the Mind');
    });

    test('finds a name by the start of some of its words, in order', () => {
        expect(find('overlord balemurk')).toBe('Overlord of the Balemurk');
        expect(find('balemurk')).toBe('Overlord of the Balemurk');
        expect(find('jace mind sculpt')).toBe('Jace, the Mind Sculptor');
        expect(find('delver secrets')).toBe(
            'Delver of Secrets // Insectile Aberration'
        );
        expect(find('balemurk overlord')).toBeUndefined();
    });

    test('prefers the names starting with the first word typed', () => {
        expect(find('ragavan')).toBe('Ragavan, Nimble Pilferer');
        // neither starts with it
        expect(find('goyf')).toBeUndefined();
    });

    test('prefers a name the other matches only add words to', () => {
        expect(find('sword of fire ice')).toBe('Sword of Fire and Ice');
        // not the shortest Jace: the other doesn't start with "Jace Beleren"
        expect(find('jace')).toBeUndefined();
        expect(find('delver')).toBeUndefined();
    });

    test('finds a name by pieces of its words, in order, if typed more than one', () => {
        expect(find('fang boss')).toBe('Greasefang, Okiba Boss');
        expect(find('crusher giant')).toBe('Bonecrusher Giant // Stomp');
        // in both names
        expect(find('fang s')).toBeUndefined();
        // a single piece fits too many names to guess from
        expect(find('fang')).toBeUndefined();
        expect(find('boss fang')).toBeUndefined();
    });

    test('corrects a typo or two', () => {
        expect(find('lightnig bolt')).toBe('Lightning Bolt');
        expect(find('brainstrom')).toBe('Brainstorm');
        expect(find('Solr Rign')).toBe('Sol Ring');
        expect(find('jace teh mind sculptro')).toBe('Jace, the Mind Sculptor');
    });

    test('leaves to Scryfall more typos, ties, short or unknown names', () => {
        expect(find('lgihtnign blot')).toBeUndefined();
        // a typo from both
        expect(find('Gave Force')).toBeUndefined();
        expect(find('otp')).toBeUndefined();
        expect(find('Сол Ринг')).toBeUndefined();
        expect(find('')).toBeUndefined();
        expect(find('!!!')).toBeUndefined();
    });

    test('loads the names the server ships with', async () => {
        const { index, cards, source } = await CardIndex.load();
        expect(cards).toBeGreaterThan(30_000);
        expect(source).toContain('oracle-cards');
        expect(index.find('Sol Ring')?.name).toBe('Sol Ring');
        expect(index.find('Bonecrusher Giant')?.name).toBe(
            'Bonecrusher Giant // Stomp'
        );
    });
});
