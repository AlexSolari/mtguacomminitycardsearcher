import { parseKartoteka } from "../../parsers";
import type { CardResult } from "../../shops";
import { withQuery, type CardSearcher } from "../card-searcher";
import type { ShopClient } from "../shop-client";

export class KartotekaCardSearcher implements CardSearcher {
  readonly shop = "kartoteka";

  constructor(private readonly client: ShopClient) {}

  async search(card: string): Promise<CardResult[]> {
    return parseKartoteka(await this.client.fetchHtml(withQuery("https://kartoteka.in.ua/ua/search/", { q: card })));
  }
}
