import { Fragment, useState } from "react";
import {
  AlertTriangle,
  Crown,
  ExternalLink,
  Gavel,
  Hourglass,
  ImageOff,
  Layers,
  Loader2,
  Package,
  SearchX,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { BIDS, CARDS, OFFERS, plural, VERSIONS } from "@/i18n";
import {
  describeError,
  isArtSeries,
  isExactMatch,
  SHOP_INFO,
  type AuctionInfo,
  type CardResult,
  type SearchResult,
  type ShopId,
} from "@/shops";

export const formatPrice = (price: number) => `${price.toLocaleString("uk-UA")} ₴`;

const byPrice = (a: CardResult, b: CardResult) => (a.price ?? Infinity) - (b.price ?? Infinity);
const minPrice = (links: CardResult[]) =>
  links.reduce<number | null>((min, l) => (l.price !== null && (min === null || l.price < min) ? l.price : min), null);

// Groups, each sorted by price: exact matches → auctions → other (fuzzy) matches → Art Series.
// "Best price" / "from" / totals use the first non-empty of exact → other → art, so neither "School Daze"
// (for "Daze") nor a 16 ₴ Art Series card (for "Sol Ring") wins "Best price". Auction bids aren't fixed
// prices, so auctions never count toward pricing.
function splitMatches(r: SearchResult) {
  const auctions = r.links.filter(l => l.auction).sort(byPrice);
  const offers = r.links.filter(l => !l.auction);
  const art = offers.filter(isArtSeries).sort(byPrice);
  const playable = offers.filter(l => !isArtSeries(l));
  const exact = playable.filter(l => isExactMatch(l.name, r.card)).sort(byPrice);
  const other = playable.filter(l => !isExactMatch(l.name, r.card)).sort(byPrice);
  const pricing = exact.length > 0 ? exact : other.length > 0 ? other : art;
  return { exact, auctions, art, other, pricing, min: minPrice(pricing) };
}

function timeLeft(iso: string) {
  const ms = new Date(iso).getTime() - Date.now();
  if (!(ms > 0)) return "завершено";
  const m = Math.floor(ms / 60_000);
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  return d > 0 ? `ще ${d} д ${h} год` : h > 0 ? `ще ${h} год ${m % 60} хв` : `ще ${m} хв`;
}

function AuctionMeta({ auction }: { auction: AuctionInfo }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1">
        <Hourglass className="size-3" />
        {timeLeft(auction.endsAt)}
      </span>
      <span>·</span>
      <span>{plural(auction.bids, BIDS)}</span>
      {auction.buyNow !== null && (
        <>
          <span>·</span>
          <span>викуп {formatPrice(auction.buyNow)}</span>
        </>
      )}
    </div>
  );
}
const cheapest = (r: SearchResult) => splitMatches(r).min;

export function ShopBadge({ shop, className, link }: { shop: ShopId; className?: string; link?: boolean }) {
  const info = SHOP_INFO[shop];
  const content = (
    <>
      <img src={info.icon} alt="" className="size-4 rounded-sm bg-white/5" loading="lazy" />
      {info.label}
    </>
  );
  const base = "inline-flex items-center gap-1.5 text-xs text-muted-foreground";
  // `link` → opens the shop's homepage. Not used inside result tiles: those are already <a>s and links can't nest.
  return link ? (
    <a
      href={info.homepage}
      target="_blank"
      rel="noopener noreferrer"
      title={`${info.label} — ${info.homepage.replace(/^https?:\/\//, "")}`}
      className={cn(base, "transition hover:border-primary/50 hover:text-primary", className)}
    >
      {content}
    </a>
  ) : (
    <span className={cn(base, className)}>{content}</span>
  );
}

function CardImage({ src, alt }: { src: string | null; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <div className="flex size-full flex-col items-center justify-center gap-2 p-4 text-center text-xs text-muted-foreground">
        <ImageOff className="size-6 opacity-60" />
        {alt}
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => setFailed(true)}
      className="size-full rounded-[4.75%/3.5%] object-cover transition duration-500 ease-out group-hover:scale-[1.04]"
    />
  );
}

function Badge({ className, children, title }: { className?: string; children: React.ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold leading-tight shadow-lg", className)}
    >
      {children}
    </span>
  );
}

const discountOf = (link: CardResult) =>
  link.oldPrice && link.price !== null ? Math.round((1 - link.price / link.oldPrice) * 100) || null : null;

// Price with its qualifier ("від" / "ставка" / "старт") and, for discounts, the struck-through old price.
function PriceBlock({ link, best }: { link: CardResult; best: boolean }) {
  return (
    <span className="flex flex-col items-end leading-tight">
      {link.oldPrice !== undefined && (
        <span className="text-xs text-muted-foreground line-through tabular-nums">{formatPrice(link.oldPrice)}</span>
      )}
      <span className={cn("whitespace-nowrap text-sm font-semibold tabular-nums", best ? "text-primary" : "text-foreground")}>
        {(link.auction || link.fromPrice) && (
          <span className="mr-1 text-xs font-normal text-muted-foreground">
            {link.auction ? (link.auction.currentBid !== null ? "ставка" : "старт") : "від"}
          </span>
        )}
        {link.price === null ? "—" : formatPrice(link.price)}
      </span>
    </span>
  );
}

const FOIL_BADGE = "bg-[linear-gradient(110deg,#f0abfc,#93c5fd_35%,#86efac_60%,#fde68a)] tracking-wider text-slate-900";

// Table view: one compact row per offer; the whole row is a link.
function ResultTable({ links, isBest }: { links: CardResult[]; isBest: (l: CardResult) => boolean }) {
  return (
    <div className="overflow-x-auto rounded-xl border bg-card/60 backdrop-blur-sm">
      <table className="w-full min-w-160 text-sm">
        <thead>
          <tr className="border-b text-left text-xs uppercase tracking-wider text-muted-foreground">
            <th className="w-14 py-2.5 pl-3 font-medium" />
            <th className="px-3 py-2.5 font-medium">Карта</th>
            <th className="px-3 py-2.5 font-medium">Деталі</th>
            <th className="px-3 py-2.5 font-medium">Магазин</th>
            <th className="px-3 py-2.5 text-right font-medium">Наявність</th>
            <th className="py-2.5 pl-3 pr-4 text-right font-medium">Ціна</th>
          </tr>
        </thead>
        <tbody>
          {links.map(link => {
            const best = isBest(link);
            const discount = discountOf(link);
            const open = () => window.open(link.url, "_blank", "noopener,noreferrer");
            return (
              <tr
                key={link.url}
                onClick={open}
                className={cn(
                  "group cursor-pointer border-b transition-colors last:border-0 hover:bg-primary/5",
                  best && "bg-primary/[0.07]",
                )}
              >
                <td className="py-1.5 pl-3">
                  <div className="aspect-488/680 w-9 overflow-hidden rounded-sm bg-muted">
                    {link.image && <img src={link.image} alt="" loading="lazy" className="size-full object-cover" />}
                  </div>
                </td>
                <td className="px-3 py-1.5">
                  {/* real link for keyboard / middle-click / copy-link; the row click covers the rest */}
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={e => e.stopPropagation()}
                    className="font-medium leading-snug group-hover:text-primary group-hover:underline"
                  >
                    {link.name}
                  </a>
                  {link.auction && (
                    <div className="mt-0.5">
                      <AuctionMeta auction={link.auction} />
                    </div>
                  )}
                </td>
                <td className="px-3 py-1.5">
                  <div className="flex flex-wrap items-center gap-1">
                    {best && (
                      <Badge className="bg-primary text-primary-foreground shadow-none">
                        <Crown className="size-3" />
                        Найкраща
                      </Badge>
                    )}
                    {link.auction && (
                      <Badge className="bg-muted text-foreground shadow-none">
                        <Gavel className="size-3" />
                        Аукціон
                      </Badge>
                    )}
                    {link.foil && <Badge className={cn(FOIL_BADGE, "shadow-none")}>FOIL</Badge>}
                    {discount !== null && <Badge className="bg-rose-600 text-white shadow-none">−{discount}%</Badge>}
                    {link.language && (
                      <Badge className="border border-border bg-transparent font-mono text-foreground shadow-none" title="Мова">
                        {link.language}
                      </Badge>
                    )}
                    {link.condition && (
                      <Badge className="bg-sky-600/90 text-white shadow-none" title="Стан">
                        {link.condition}
                      </Badge>
                    )}
                  </div>
                </td>
                <td className="px-3 py-1.5">
                  <ShopBadge shop={link.shop} className="whitespace-nowrap" />
                </td>
                <td className="whitespace-nowrap px-3 py-1.5 text-right text-xs text-muted-foreground">
                  {link.stock !== undefined && <span className="text-emerald-400">{link.stock} шт.</span>}
                  {link.printings && <div>{plural(link.printings, VERSIONS)}</div>}
                  {link.stock === undefined && !link.printings && "—"}
                </td>
                <td className="py-1.5 pl-3 pr-4">
                  <PriceBlock link={link} best={best} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ResultTile({ link, best }: { link: CardResult; best: boolean }) {
  const discount = discountOf(link);
  return (
    <a
      href={link.url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-xl border bg-card/60 backdrop-blur-sm transition duration-300 ease-out",
        "hover:-translate-y-1 hover:border-primary/40 hover:bg-card hover:shadow-[0_18px_40px_-16px] hover:shadow-primary/25",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        best && "border-primary/35 ring-1 ring-primary/20",
      )}
    >
      <div className="relative aspect-488/680 p-2 pb-0">
        <div className="size-full overflow-hidden rounded-[4.75%/3.5%] bg-muted">
          <CardImage src={link.image} alt={link.name} />
        </div>
        {/* left: status + finish/discount badges, stacked */}
        <div className="absolute left-3.5 top-3.5 flex flex-col items-start gap-1">
          {best && (
            <Badge className="bg-primary text-primary-foreground">
              <Crown className="size-3" />
              Найкраща ціна
            </Badge>
          )}
          {link.auction && (
            <Badge className="bg-black/70 text-white backdrop-blur">
              <Gavel className="size-3" />
              Аукціон
            </Badge>
          )}
          {link.foil && (
            <Badge className={FOIL_BADGE}>
              FOIL
            </Badge>
          )}
          {discount !== null && <Badge className="bg-rose-600 text-white">−{discount}%</Badge>}
        </div>
        {/* right: language + condition */}
        {(link.language || link.condition) && (
          <div className="absolute right-3.5 top-3.5 flex flex-col items-end gap-1">
            {link.language && (
              <Badge className="border border-white/25 bg-black/70 font-mono tracking-wide text-white backdrop-blur" title="Мова">
                {link.language}
              </Badge>
            )}
            {link.condition && (
              <Badge className="bg-sky-600/90 text-white" title="Стан">
                {link.condition}
              </Badge>
            )}
          </div>
        )}
        <span className="absolute bottom-1.5 right-3.5 grid size-7 place-items-center rounded-full bg-black/60 text-white opacity-0 backdrop-blur transition group-hover:opacity-100">
          <ExternalLink className="size-3.5" />
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-2 p-3">
        <span className="line-clamp-2 text-sm font-medium leading-snug">{link.name}</span>
        {link.auction && <AuctionMeta auction={link.auction} />}
        {(link.stock !== undefined || link.printings) && (
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            {link.stock !== undefined && (
              <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-emerald-400">
                <Package className="size-3" />
                {link.stock} шт. в наявності
              </span>
            )}
            {link.printings && (
              <span className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-muted-foreground">
                <Layers className="size-3" />
                {plural(link.printings, VERSIONS)}
              </span>
            )}
          </div>
        )}
        <div className="mt-auto flex items-end justify-between gap-2">
          <ShopBadge shop={link.shop} />
          <PriceBlock link={link} best={best} />
        </div>
      </div>
    </a>
  );
}

function SectionHeader({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b pb-3">
      <h2 className="font-display text-xl font-semibold tracking-wide">{title}</h2>
      <div className="flex items-center gap-3 text-sm text-muted-foreground">{children}</div>
    </div>
  );
}

const grid = "grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4";

function GroupDivider({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-center gap-3 pt-2 text-xs uppercase tracking-wider text-muted-foreground">
      <span>{label}</span>
      <span className="rounded-full bg-muted px-2 py-0.5 tabular-nums normal-case tracking-normal">{count}</span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

export type ResultsView = "grid" | "table";

export function CardSection({ result, view = "grid" }: { result: SearchResult; view?: ResultsView }) {
  const { exact, auctions, art, other, pricing, min } = splitMatches(result);
  const links = result.links;
  const isBest = (link: CardResult) =>
    links.length > 1 && pricing.includes(link) && link.price !== null && link.price === min;
  const hasExact = exact.length > 0;
  const groups = [
    { key: "exact", label: null, links: exact, dim: false },
    { key: "auctions", label: "Аукціони", links: auctions, dim: false },
    { key: "other", label: hasExact ? "Інші збіги" : "Точних збігів немає · схожі назви", links: other, dim: hasExact },
    { key: "art", label: "Art Series", links: art, dim: hasExact || other.length > 0 },
  ];

  return (
    <section className="flex flex-col gap-4 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <SectionHeader title={result.card}>
        {min !== null && (
          <span>
            від <span className="font-semibold text-primary tabular-nums">{formatPrice(min)}</span>
          </span>
        )}
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums">{plural(links.length, OFFERS)}</span>
      </SectionHeader>

      {result.errors.map(err => (
        <p key={err.shop ?? "request"} className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertTriangle className="size-4 shrink-0" />
          {describeError(err)}
        </p>
      ))}

      {links.length === 0 ? (
        result.errors.length === 0 && <div className="flex items-center gap-3 rounded-xl border border-dashed px-4 py-6 text-sm text-muted-foreground">
          <SearchX className="size-5 shrink-0" />
          Не знайдено в жодному магазині.
        </div>
      ) : (
        groups.map(
          group =>
            group.links.length > 0 && (
              <Fragment key={group.key}>
                {group.label && <GroupDivider label={group.label} count={group.links.length} />}
                {view === "table" ? (
                  <div className={cn(group.dim && "opacity-70 transition-opacity hover:opacity-100")}>
                    <ResultTable links={group.links} isBest={isBest} />
                  </div>
                ) : (
                  <div className={cn(grid, group.dim && "opacity-70 transition-opacity hover:opacity-100")}>
                    {group.links.map(link => (
                      <ResultTile key={link.url} link={link} best={isBest(link)} />
                    ))}
                  </div>
                )}
              </Fragment>
            ),
        )
      )}
    </section>
  );
}

export function CardSectionSkeleton({ name }: { name: string }) {
  return (
    <section className="flex flex-col gap-4">
      <SectionHeader title={name}>
        <Loader2 className="size-4 animate-spin" />
      </SectionHeader>
      <div className={grid}>
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="flex flex-col gap-3 rounded-xl border bg-card/40 p-2" style={{ animationDelay: `${i * 120}ms` }}>
            <div className="aspect-488/680 animate-pulse rounded-lg bg-muted" />
            <div className="h-3.5 w-3/4 animate-pulse rounded bg-muted" />
            <div className="mb-1 h-3 w-1/2 animate-pulse rounded bg-muted" />
          </div>
        ))}
      </div>
    </section>
  );
}

function Stat({ label, value, accent }: { label: string; value: React.ReactNode; accent?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className={cn("text-2xl font-semibold tabular-nums", accent && "text-primary")}>{value}</span>
    </div>
  );
}

// `results` = cards finished so far; `total` = cards in the search. Updates live as per-card requests return.
export function SearchSummary({ results, total: cardCount }: { results: SearchResult[]; total: number }) {
  const found = results.filter(r => r.links.length > 0);
  const missing = results.filter(r => r.links.length === 0 && r.errors.length === 0);
  const total = found.reduce((sum, r) => sum + (cheapest(r) ?? 0), 0);
  const offers = results.reduce((sum, r) => sum + r.links.length, 0);
  const remaining = cardCount - results.length;
  // shop → number of cards whose search failed there
  const failedShops = new Map<ShopId, number>();
  for (const r of results)
    for (const e of r.errors) if (e.shop) failedShops.set(e.shop, (failedShops.get(e.shop) ?? 0) + 1);

  return (
    <div className="flex flex-col gap-4 rounded-2xl border bg-card/60 p-5 backdrop-blur animate-in fade-in duration-500">
      <div className="grid grid-cols-3 gap-4">
        <Stat label="Знайдено" value={`${found.length} / ${cardCount}`} />
        <Stat label="Пропозиції" value={offers} />
        <Stat label="Мінімальна сума" value={formatPrice(total)} accent />
      </div>
      {remaining > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            Шукаємо ще {plural(remaining, CARDS)}…
          </div>
          <div className="h-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out"
              style={{ width: `${(results.length / cardCount) * 100}%` }}
            />
          </div>
        </div>
      )}
      {failedShops.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-t pt-4 text-sm">
          <AlertTriangle className="size-4 shrink-0 text-destructive" />
          <span className="text-muted-foreground">Пошук не вдався в магазинах:</span>
          {[...failedShops].map(([shop, count]) => (
            <span key={shop} className="rounded-full border border-destructive/30 bg-destructive/10 px-2.5 py-0.5 text-xs text-destructive">
              {SHOP_INFO[shop].label} · {plural(count, CARDS)}
            </span>
          ))}
        </div>
      )}
      {missing.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-t pt-4 text-sm">
          <span className="text-muted-foreground">Не знайдено:</span>
          {missing.map(r => (
            <span key={r.card} className="rounded-full border border-destructive/30 bg-destructive/10 px-2.5 py-0.5 text-xs text-destructive">
              {r.card}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function EmptyState() {
  return (
    <div className="flex min-h-80 flex-col items-center justify-center gap-4 rounded-2xl border border-dashed bg-card/20 p-10 text-center">
      <div className="grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary ring-1 ring-primary/20">
        <Sparkles className="size-7" />
      </div>
      <div className="flex flex-col gap-1">
        <p className="font-display text-lg font-semibold tracking-wide">Тут з'являться результати</p>
        <p className="text-sm text-muted-foreground">Вставте список карт — і ми перевіримо всі магазини одразу.</p>
      </div>
      <div className="flex flex-wrap justify-center gap-4 pt-2">
        {(Object.keys(SHOP_INFO) as ShopId[]).map(shop => (
          <ShopBadge key={shop} shop={shop} link />
        ))}
      </div>
    </div>
  );
}
