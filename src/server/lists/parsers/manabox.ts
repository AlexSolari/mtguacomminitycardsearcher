import { decodeEntities } from '../../parsers/helpers';
import {
    mergeRows,
    toUsd,
    type Finish,
    type ListCard,
    type ParsedList
} from '../list-card';

// manabox.app/decks/<id>: a deck shared from the ManaBox app. The page is server-rendered Astro, and the deck
// is the props of its "Main" island: HTML-escaped JSON in Astro's encoding, where every value is a
// [type, value] pair (0 = plain value, 1 = array of pairs):
//
//   <astro-island … component-export="Main" … props="{&quot;deck&quot;:[0,{
//     &quot;name&quot;:[0,&quot;Sell list v.2&quot;],&quot;editDate&quot;:[0,1794775247806],
//     &quot;cards&quot;:[1,[[0,{&quot;name&quot;:[0,&quot;Agatha of the Vile Cauldron&quot;],&quot;quantity&quot;:[0,1],
//       &quot;variant&quot;:[0,&quot;Normal&quot;],&quot;setId&quot;:[0,&quot;woe&quot;],&quot;collectorNumber&quot;:[0,&quot;199&quot;],
//       &quot;pricing&quot;:[0,{&quot;tcgplayer&quot;:[0,{&quot;value&quot;:[0,9.5600004196167]}], …}],
//       &quot;images&quot;:[1,[[0,{&quot;imageUrlNormal&quot;:[0,&quot;https://cards.scryfall.io/normal/front/d/6/d6c48f07-….jpg?1783915073&quot;]}]]]
//     }], …]]}]}" …>
//
// `variant` is the finish ("Normal", "Foil"), and `pricing` is for that finish: a foil row has the foil price.
// The image's path holds the printing's Scryfall id. A page without the island or its deck (a redesign) is null.
const ISLAND = /<astro-island\b[^>]*>/g;
const SCRYFALL_ID =
    /^https:\/\/cards\.scryfall\.io\/[a-z_]+\/[a-z]+\/[0-9a-f]\/[0-9a-f]\/([0-9a-f-]{36})\./;

// Astro's [type, value] pairs → plain values. Types other than values and arrays (dates, maps, URLs…) hold
// nothing the parser reads.
const revive = (pair: unknown): unknown => {
    if (!Array.isArray(pair)) return undefined;
    const [type, value] = pair;
    if (type === 1) return Array.isArray(value) ? value.map(revive) : [];
    if (type !== 0) return undefined;
    return value && typeof value === 'object' && !Array.isArray(value)
        ? reviveObject(value)
        : value;
};
const reviveObject = (o: object) =>
    Object.fromEntries(Object.entries(o).map(([k, v]) => [k, revive(v)]));

// The Main island's props, revived; exported for the fixture script, which cuts them down.
export function manaboxProps(html: string): any {
    for (const [tag] of html.matchAll(ISLAND)) {
        if (!tag.includes('component-export="Main"')) continue;
        const props = tag.match(/\bprops="([^"]*)"/)?.[1];
        try {
            return props
                ? reviveObject(JSON.parse(decodeEntities(props)))
                : null;
        } catch {
            return null;
        }
    }
    return null;
}

// "Normal" and "Foil" are what shared decks show; "Etched" is a guess at how ManaBox names the third finish
const finish = (variant: unknown): Finish =>
    typeof variant !== 'string'
        ? 'nonfoil'
        : /etched/i.test(variant)
          ? 'etched'
          : /foil/i.test(variant)
            ? 'foil'
            : 'nonfoil';

function toCard(c: any): ListCard | null {
    const name = typeof c?.name === 'string' ? c.name.trim() : '';
    const quantity = c?.quantity;
    if (!name || !Number.isInteger(quantity) || quantity < 1) return null;
    const image: unknown = c.images?.[0]?.imageUrlNormal;
    const scryfallId =
        typeof image === 'string' ? image.match(SCRYFALL_ID)?.[1] : undefined;
    const price = toUsd(c.pricing?.tcgplayer?.value);
    return {
        name,
        quantity,
        finish: finish(c.variant),
        ...(typeof c.setId === 'string' && { set: c.setId.toLowerCase() }),
        ...(typeof c.collectorNumber === 'string' && {
            collectorNumber: c.collectorNumber
        }),
        ...(scryfallId && { scryfallId, image: image as string }),
        ...(price !== undefined && { usd: price })
    };
}

export function parseManabox(html: string): ParsedList | null {
    const deck = manaboxProps(html)?.deck;
    if (!deck || !Array.isArray(deck.cards)) return null;
    // a malformed row is skipped, not the whole list
    const cards = deck.cards.flatMap((c: unknown) => toCard(c) ?? []);
    return {
        ...(typeof deck.name === 'string' &&
            deck.name.trim() && { title: deck.name.trim() }),
        ...(Number.isFinite(deck.editDate) && { editedAt: deck.editDate }),
        cards: mergeRows(cards)
    };
}
