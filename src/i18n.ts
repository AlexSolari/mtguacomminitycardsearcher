// Ukrainian plural forms: 1 карта · 2 карти · 5 карт (21 карта, 22 карти, 25 карт, 11 карт…)
const rules = new Intl.PluralRules('uk');

export type PluralForms = { one: string; few: string; many: string };

export function plural(n: number, forms: PluralForms) {
    const rule = rules.select(n);
    return `${n} ${rule === 'one' ? forms.one : rule === 'few' ? forms.few : forms.many}`;
}

export const CARDS: PluralForms = { one: 'карта', few: 'карти', many: 'карт' };
export const OFFERS: PluralForms = {
    one: 'пропозиція',
    few: 'пропозиції',
    many: 'пропозицій'
};
export const BIDS: PluralForms = {
    one: 'ставка',
    few: 'ставки',
    many: 'ставок'
};
// A search refused for going over the server's limit (HTTP 429), shown after "Не вдалося виконати пошук: ".
// `retryAfter` is the response's Retry-After header, in seconds.
export function tooManySearches(retryAfter: string | null) {
    const seconds = Number(retryAfter);
    if (!Number.isFinite(seconds) || seconds <= 0)
        return 'забагато пошуків, спробуйте трохи пізніше';
    const wait =
        seconds < 90
            ? `${Math.ceil(seconds)} с`
            : `${Math.ceil(seconds / 60)} хв`;
    return `забагато пошуків, спробуйте ще раз за ${wait}`;
}

// genitive, as in "з 3 файлів" / "з 2 файлів" — after "з" every count takes the genitive plural except 1 ("з 1 файлу")
export const FILES: PluralForms = {
    one: 'файлу',
    few: 'файлів',
    many: 'файлів'
};
export const LISTS: PluralForms = {
    one: 'список',
    few: 'списки',
    many: 'списків'
};
// genitive, as in "не більше 10 списків" / "не більше 1 списку"
export const LISTS_GENITIVE: PluralForms = {
    one: 'списку',
    few: 'списків',
    many: 'списків'
};
