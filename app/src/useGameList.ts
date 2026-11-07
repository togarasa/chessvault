import { useState } from "react";
import { listGames, searchGames } from "./api";
import { DEFAULT_ORDER, nextOrder } from "./columns";
import { Filter } from "./filter";
import { GameSummary, Order, SortColumn } from "./types";

const PAGE_SIZE = 200;

/// The game list: the games loaded so far, how they are sorted and searched, and loading more.
/// `run` reports a failed request in the status bar.
export function useGameList(run: (action: () => Promise<void>) => Promise<void>) {
  const [games, setGames] = useState<GameSummary[]>([]);
  const [order, setOrder] = useState<Order>(DEFAULT_ORDER);
  /// The search the list shows, or null for all games.
  const [filter, setFilter] = useState<Filter | null>(null);
  /// Whether the database may have more games than the list has loaded.
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  function fetch(find: Filter | null, sort: Order, limit: number, offset: number) {
    return find ? searchGames(find, sort, limit, offset) : listGames(sort, limit, offset);
  }

  /// Loads the list from the top again, keeping as many rows as are loaded now so a refresh
  /// after saving or deleting doesn't lose the place.
  async function reload(find = filter, keep = games.length, sort = order) {
    const limit = Math.max(PAGE_SIZE, keep);
    const found = await fetch(find, sort, limit, 0);
    setGames(found);
    setHasMore(found.length === limit);
  }

  async function loadMore() {
    if (!hasMore || loadingMore) return;
    setLoadingMore(true);
    await run(async () => {
      const found = await fetch(filter, order, PAGE_SIZE, games.length);
      setGames((loaded) => [...loaded, ...found]);
      setHasMore(found.length === PAGE_SIZE);
    });
    setLoadingMore(false);
  }

  /// Shows the games that match `find`, or all games when it is null.
  async function applyFilter(find: Filter | null) {
    setFilter(find);
    await run(() => reload(find, 0));
  }

  /// Sorts by `column`; clicking the sorted column again reverses it.
  async function sortBy(column: SortColumn) {
    const next = nextOrder(order, column);
    setOrder(next);
    await run(() => reload(filter, 0, next));
  }

  /// Shows the first games of a database that was just opened, with no search.
  async function showNewDatabase() {
    setFilter(null);
    await reload(null, 0);
  }

  return { games, order, filter, hasMore, loadingMore, reload, loadMore, applyFilter, sortBy, showNewDatabase };
}
