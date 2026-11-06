import { parseGin, parseGinPrintings } from "../../parsers";
import { isExactMatch, type CardResult } from "../../shops";
import { withQuery, type CardSearcher } from "../card-searcher";
import type { ShopClient } from "../shop-client";

// MTGin's search shows one summary tile per card when it has several printings ("4 версії · від 42 ₴"), linking to
// /cards/oracle/<id>. For exact matches, expand that page into one result per printing (and seller), like Mana Vault.
// If the expansion fails or comes back empty, the summary tile stays.
export class GinCardSearcher implements CardSearcher {
  readonly shop = "gin";

  constructor(private readonly client: ShopClient) {}

  async search(card: string): Promise<CardResult[]> {
    const found = parseGin(await this.client.fetchHtml(withQuery("https://mtgin.kyiv.ua/", { q: card })));
    const expanded = await Promise.all(
      found.map(async l => {
        if (!l.printings || !isExactMatch(l.name, card)) return [l];
        try {
          const printings = parseGinPrintings(await this.client.fetchHtml(l.url));
          return printings.length > 0 ? printings : [l];
        } catch {
          return [l];
        }
      }),
    );
    return expanded.flat();
  }
}
