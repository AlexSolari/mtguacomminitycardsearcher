import { normalize, type SearchResult } from "../shops";
import type { CardSearcher } from "./card-searcher";

// Searches every shop for every card. A failing shop doesn't fail the card — it's reported in `errors`.
export class CardSearchService {
  constructor(private readonly searchers: CardSearcher[]) {}

  search(cards: string[]): Promise<SearchResult[]> {
    return Promise.all(cards.map(card => this.searchCard(card)));
  }

  private async searchCard(card: string): Promise<SearchResult> {
    const shops = await Promise.all(
      this.searchers.map(async searcher => {
        try {
          return { links: await searcher.search(card), error: null };
        } catch (err) {
          console.error(`[${searcher.shop}] search for "${card}" failed:`, err);
          return { links: [], error: { shop: searcher.shop, message: (err as Error).message } };
        }
      }),
    );
    // Shop searches are fuzzy (e.g. "sol ring" also hits "Soldier of the Grey Host") — keep only names containing the query.
    const query = normalize(card);
    return {
      card,
      links: shops.flatMap(s => s.links).filter(l => normalize(l.name).includes(query)),
      errors: shops.flatMap(s => (s.error ? [s.error] : [])),
    };
  }
}
