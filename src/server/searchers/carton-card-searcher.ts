import { parseCarton } from "../../parsers";
import type { CardResult } from "../../shops";
import { withQuery, type CardSearcher } from "../card-searcher";
import type { ShopClient } from "../shop-client";

export class CartonCardSearcher implements CardSearcher {
  readonly shop = "carton";

  constructor(private readonly client: ShopClient) {}

  async search(card: string): Promise<CardResult[]> {
    return parseCarton(await this.client.fetchHtml(withQuery("https://carton.cards/search", { q: card })));
  }
}
