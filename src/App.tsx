import { useState, type FormEvent, type KeyboardEvent } from "react";
import { AlertTriangle, Link2Off, Loader2, Search, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { CardSection, CardSectionSkeleton, EmptyState, SearchSummary, ShopBadge } from "@/components/search-results";
import { SHOP_INFO, type SearchResult, type ShopId } from "./shops";
import { parseCardList } from "./decklist";
import "./index.css";

export function App() {
  const [text, setText] = useState("");
  const [pending, setPending] = useState<string[] | null>(null);
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { names: cardNames, links } = parseCardList(text);
  const submitting = pending !== null;

  async function search() {
    if (cardNames.length === 0 || submitting) return;

    setPending(cardNames);
    setError(null);
    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cards: cardNames }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { results: SearchResult[] };
      setResults(data.results);
    } catch (err) {
      console.error("search failed", err);
      setError(`Search failed: ${(err as Error).message}`);
    } finally {
      setPending(null);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    search();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      search();
    }
  }

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-10 px-4 py-10 sm:px-6 lg:py-14">
      <header className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <div className="grid size-11 place-items-center rounded-xl bg-linear-to-br from-primary to-amber-600 text-primary-foreground shadow-lg shadow-primary/20">
            <Sparkles className="size-5" />
          </div>
          <h1 className="font-display text-3xl font-bold tracking-wide sm:text-4xl">
            Card <span className="text-primary">Searcher</span>
          </h1>
        </div>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-2 text-muted-foreground">
          Compare prices across
          {(Object.keys(SHOP_INFO) as ShopId[]).map(shop => (
            <ShopBadge key={shop} shop={shop} className="rounded-full border bg-card/60 px-2.5 py-1 text-foreground" />
          ))}
        </p>
      </header>

      <main className="grid items-start gap-8 lg:grid-cols-[340px_1fr]">
        <aside className="lg:sticky lg:top-8">
          <form
            onSubmit={handleSubmit}
            className="flex flex-col gap-4 rounded-2xl border bg-card/60 p-5 shadow-2xl shadow-black/30 backdrop-blur"
          >
            <div className="flex items-center justify-between">
              <label htmlFor="card-list" className="text-sm font-semibold">
                Card list
              </label>
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums text-muted-foreground">
                {cardNames.length} card{cardNames.length === 1 ? "" : "s"}
              </span>
            </div>
            <Textarea
              id="card-list"
              value={text}
              onChange={e => setText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={"Lightning Bolt\nCounterspell\n\n…or paste a decklist export:\n4 Demonic Tutor\n1 Sol Ring (C21) 263"}
              spellCheck={false}
              className="min-h-64 max-h-[55vh] resize-none bg-background/50 font-mono text-sm leading-relaxed"
            />
            {links.length > 0 && (
              <div className="flex gap-2 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2.5 text-xs leading-relaxed text-foreground">
                <Link2Off className="mt-0.5 size-4 shrink-0 text-primary" />
                <p>
                  Deck links can't be imported directly — MTGGoldfish blocks automated access. On the deck page, use
                  the <b>Copy</b> / <b>Download</b> (text, Arena or MTGO) option and paste the list here instead.{" "}
                  {links.length === 1 ? "The link is" : "Links are"} ignored.
                </p>
              </div>
            )}
            <Button
              type="submit"
              disabled={submitting || cardNames.length === 0}
              className="h-11 bg-linear-to-r from-primary to-amber-500 font-semibold shadow-lg shadow-primary/20 transition hover:brightness-110"
            >
              {submitting ? <Loader2 className="animate-spin" /> : <Search />}
              {submitting ? "Searching…" : "Search shops"}
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              Names or a decklist (MTGGoldfish, Arena, MTGO) ·{" "}
              <kbd className="rounded border bg-muted px-1.5 py-0.5 font-sans text-[10px]">Ctrl</kbd> +{" "}
              <kbd className="rounded border bg-muted px-1.5 py-0.5 font-sans text-[10px]">Enter</kbd> to search
            </p>
          </form>
        </aside>

        <div className="flex min-w-0 flex-col gap-10">
          {error && (
            <p className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              <AlertTriangle className="size-4 shrink-0" />
              {error}
            </p>
          )}

          {pending ? (
            pending.map(name => <CardSectionSkeleton key={name} name={name} />)
          ) : results ? (
            <>
              <SearchSummary results={results} />
              {results.map(result => (
                <CardSection key={result.card} result={result} />
              ))}
            </>
          ) : (
            !error && <EmptyState />
          )}
        </div>
      </main>
    </div>
  );
}

export default App;
