import { useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Link2Off, Loader2, Search, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { CardSection, CardSectionSkeleton, EmptyState, SearchSummary, ShopBadge } from "@/components/search-results";
import { SHOP_INFO, type SearchResult, type ShopId } from "./shops";
import { parseCardList } from "./decklist";
import { CARDS, plural } from "./i18n";
import "./index.css";

// One entry per searched card, in list order. Each card is fetched by its own request, so sections fill in
// as soon as their card is done instead of waiting for the slowest one.
type Entry = { card: string; result: SearchResult | null };

async function searchCard(card: string, signal: AbortSignal): Promise<SearchResult> {
  try {
    const res = await fetch("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cards: [card] }),
      signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { results: SearchResult[] };
    return data.results[0] ?? { card, links: [], errors: [] };
  } catch (err) {
    if (signal.aborted) throw err;
    console.error(`search for "${card}" failed`, err);
    return { card, links: [], errors: [`Не вдалося виконати пошук: ${(err as Error).message}`] };
  }
}

export function App() {
  const [text, setText] = useState("");
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const searchRef = useRef<AbortController | null>(null);

  const { names: cardNames, links } = parseCardList(text);
  const submitting = entries?.some(e => e.result === null) ?? false;
  const finished = entries?.flatMap(e => (e.result ? [e.result] : [])) ?? [];

  function search() {
    if (cardNames.length === 0 || submitting) return;

    searchRef.current?.abort(); // drop any responses still in flight from a previous search
    const controller = new AbortController();
    searchRef.current = controller;

    setEntries(cardNames.map(card => ({ card, result: null })));
    cardNames.forEach((card, i) => {
      searchCard(card, controller.signal)
        .then(result => {
          if (controller.signal.aborted) return;
          setEntries(prev => prev && prev.map((e, j) => (j === i ? { ...e, result } : e)));
        })
        .catch(() => {}); // aborted
    });
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
          <h1 className="font-display text-2xl font-bold leading-tight tracking-wide sm:text-3xl lg:text-4xl">
            MTG UA Community <span className="text-primary">Card Searcher</span>
          </h1>
        </div>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-2 text-muted-foreground">
          Порівнюємо ціни в магазинах
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
                Список карт
              </label>
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums text-muted-foreground">
                {plural(cardNames.length, CARDS)}
              </span>
            </div>
            <Textarea
              id="card-list"
              value={text}
              onChange={e => setText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={"Lightning Bolt\nCounterspell\n\n…або вставте експорт колоди:\n4 Demonic Tutor\n1 Sol Ring (C21) 263"}
              spellCheck={false}
              className="min-h-64 max-h-[55vh] resize-none bg-background/50 font-mono text-sm leading-relaxed"
            />
            {links.length > 0 && (
              <div className="flex gap-2 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2.5 text-xs leading-relaxed text-foreground">
                <Link2Off className="mt-0.5 size-4 shrink-0 text-primary" />
                <p>
                  Посилання на колоди не імпортуються напряму — MTGGoldfish блокує автоматичний доступ. На сторінці
                  колоди скористайтеся кнопкою <b>Copy</b> / <b>Download</b> (текст, Arena або MTGO) і вставте список
                  сюди. {links.length === 1 ? "Посилання пропущено." : "Посилання пропущені."}
                </p>
              </div>
            )}
            <Button
              type="submit"
              disabled={submitting || cardNames.length === 0}
              className="h-11 bg-linear-to-r from-primary to-amber-500 font-semibold shadow-lg shadow-primary/20 transition hover:brightness-110"
            >
              {submitting ? <Loader2 className="animate-spin" /> : <Search />}
              {submitting ? "Шукаємо…" : "Шукати в магазинах"}
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              Назви або список колоди (MTGGoldfish, Arena, MTGO) ·{" "}
              <kbd className="rounded border bg-muted px-1.5 py-0.5 font-sans text-[10px]">Ctrl</kbd> +{" "}
              <kbd className="rounded border bg-muted px-1.5 py-0.5 font-sans text-[10px]">Enter</kbd> — пошук
            </p>
          </form>
        </aside>

        <div className="flex min-w-0 flex-col gap-10">
          {entries ? (
            <>
              <SearchSummary results={finished} total={entries.length} />
              {entries.map(entry =>
                entry.result ? (
                  <CardSection key={entry.card} result={entry.result} />
                ) : (
                  <CardSectionSkeleton key={entry.card} name={entry.card} />
                ),
              )}
            </>
          ) : (
            <EmptyState />
          )}
        </div>
      </main>
    </div>
  );
}

export default App;
