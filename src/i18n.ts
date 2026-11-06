// Ukrainian plural forms: 1 карта · 2 карти · 5 карт (21 карта, 22 карти, 25 карт, 11 карт…)
const rules = new Intl.PluralRules("uk");

export type PluralForms = { one: string; few: string; many: string };

export function plural(n: number, forms: PluralForms) {
  const rule = rules.select(n);
  return `${n} ${rule === "one" ? forms.one : rule === "few" ? forms.few : forms.many}`;
}

export const CARDS: PluralForms = { one: "карта", few: "карти", many: "карт" };
export const OFFERS: PluralForms = { one: "пропозиція", few: "пропозиції", many: "пропозицій" };
export const BIDS: PluralForms = { one: "ставка", few: "ставки", many: "ставок" };
export const VERSIONS: PluralForms = { one: "версія", few: "версії", many: "версій" };
// genitive, as in "з 3 файлів" / "з 2 файлів" — after "з" every count takes the genitive plural except 1 ("з 1 файлу")
export const FILES: PluralForms = { one: "файлу", few: "файлів", many: "файлів" };
