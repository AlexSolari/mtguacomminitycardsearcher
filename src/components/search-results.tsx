import { Fragment, useState } from "react";
import { AlertTriangle, Crown, ExternalLink, Gavel, Hourglass, ImageOff, Loader2, SearchX, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import {
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
  if (!(ms > 0)) return "ended";
  const m = Math.floor(ms / 60_000);
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  return d > 0 ? `${d}d ${h}h left` : h > 0 ? `${h}h ${m % 60}m left` : `${m}m left`;
}

function AuctionMeta({ auction }: { auction: AuctionInfo }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1">
        <Hourglass className="size-3" />
        {timeLeft(auction.endsAt)}
      </span>
      <span>·</span>
      <span>
        {auction.bids} bid{auction.bids === 1 ? "" : "s"}
      </span>
      {auction.buyNow !== null && (
        <>
          <span>·</span>
          <span>buy now {formatPrice(auction.buyNow)}</span>
        </>
      )}
    </div>
  );
}
const cheapest = (r: SearchResult) => splitMatches(r).min;

export function ShopBadge({ shop, className }: { shop: ShopId; className?: string }) {
  const info = SHOP_INFO[shop];
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs text-muted-foreground", className)}>
      <img src={info.icon} alt="" className="size-4 rounded-sm bg-white/5" loading="lazy" />
      {info.label}
    </span>
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

function ResultTile({ link, best }: { link: CardResult; best: boolean }) {
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
        {best && (
          <span className="absolute left-3.5 top-3.5 inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-[11px] font-semibold text-primary-foreground shadow-lg">
            <Crown className="size-3" />
            Best price
          </span>
        )}
        {link.auction && (
          <span className="absolute left-3.5 top-3.5 inline-flex items-center gap-1 rounded-full bg-black/70 px-2 py-0.5 text-[11px] font-semibold text-white shadow-lg backdrop-blur">
            <Gavel className="size-3" />
            Auction
          </span>
        )}
        <span className="absolute right-3.5 top-3.5 grid size-7 place-items-center rounded-full bg-black/60 text-white opacity-0 backdrop-blur transition group-hover:opacity-100">
          <ExternalLink className="size-3.5" />
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-2 p-3">
        <span className="line-clamp-2 text-sm font-medium leading-snug">{link.name}</span>
        {link.auction && <AuctionMeta auction={link.auction} />}
        <div className="mt-auto flex items-center justify-between gap-2">
          <ShopBadge shop={link.shop} />
          <span className={cn("text-sm font-semibold tabular-nums", best ? "text-primary" : "text-foreground")}>
            {link.auction && (
              <span className="mr-1 text-xs font-normal text-muted-foreground">
                {link.auction.currentBid !== null ? "bid" : "start"}
              </span>
            )}
            {link.price === null ? "—" : formatPrice(link.price)}
          </span>
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

export function CardSection({ result }: { result: SearchResult }) {
  const { exact, auctions, art, other, pricing, min } = splitMatches(result);
  const links = result.links;
  const isBest = (link: CardResult) =>
    links.length > 1 && pricing.includes(link) && link.price !== null && link.price === min;
  const hasExact = exact.length > 0;
  const groups = [
    { key: "exact", label: null, links: exact, dim: false },
    { key: "auctions", label: "Auctions", links: auctions, dim: false },
    { key: "other", label: hasExact ? "Other matches" : "No exact match · similar names", links: other, dim: hasExact },
    { key: "art", label: "Art Series", links: art, dim: hasExact || other.length > 0 },
  ];

  return (
    <section className="flex flex-col gap-4 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <SectionHeader title={result.card}>
        {min !== null && (
          <span>
            from <span className="font-semibold text-primary tabular-nums">{formatPrice(min)}</span>
          </span>
        )}
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums">
          {links.length} offer{links.length === 1 ? "" : "s"}
        </span>
      </SectionHeader>

      {result.errors.map(err => (
        <p key={err} className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertTriangle className="size-4 shrink-0" />
          {err}
        </p>
      ))}

      {links.length === 0 ? (
        <div className="flex items-center gap-3 rounded-xl border border-dashed px-4 py-6 text-sm text-muted-foreground">
          <SearchX className="size-5 shrink-0" />
          Not found in any shop.
        </div>
      ) : (
        groups.map(
          group =>
            group.links.length > 0 && (
              <Fragment key={group.key}>
                {group.label && <GroupDivider label={group.label} count={group.links.length} />}
                <div className={cn(grid, group.dim && "opacity-70 transition-opacity hover:opacity-100")}>
                  {group.links.map(link => (
                    <ResultTile key={link.url} link={link} best={isBest(link)} />
                  ))}
                </div>
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

export function SearchSummary({ results }: { results: SearchResult[] }) {
  const found = results.filter(r => r.links.length > 0);
  const missing = results.filter(r => r.links.length === 0);
  const total = found.reduce((sum, r) => sum + (cheapest(r) ?? 0), 0);
  const offers = results.reduce((sum, r) => sum + r.links.length, 0);

  return (
    <div className="flex flex-col gap-4 rounded-2xl border bg-card/60 p-5 backdrop-blur animate-in fade-in duration-500">
      <div className="grid grid-cols-3 gap-4">
        <Stat label="Found" value={`${found.length} / ${results.length}`} />
        <Stat label="Offers" value={offers} />
        <Stat label="Cheapest total" value={formatPrice(total)} accent />
      </div>
      {missing.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-t pt-4 text-sm">
          <span className="text-muted-foreground">Missing:</span>
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
        <p className="font-display text-lg font-semibold tracking-wide">Your results will appear here</p>
        <p className="text-sm text-muted-foreground">Paste a list of cards and we'll check every shop at once.</p>
      </div>
      <div className="flex flex-wrap justify-center gap-4 pt-2">
        {(Object.keys(SHOP_INFO) as ShopId[]).map(shop => (
          <ShopBadge key={shop} shop={shop} />
        ))}
      </div>
    </div>
  );
}
