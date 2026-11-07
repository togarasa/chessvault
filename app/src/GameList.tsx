import { COLUMNS } from "./columns";
import { GameSummary, Order, SortColumn } from "./types";

type Props = {
  games: GameSummary[];
  order: Order;
  /// The game on the board, highlighted in the list.
  selectedId: number | null;
  hasMore: boolean;
  loadingMore: boolean;
  onSort: (column: SortColumn) => void;
  onSelect: (id: number) => void;
  onMenu: (game: GameSummary, x: number, y: number) => void;
  onLoadMore: () => void;
};

/// The table of games. Scrolling near the end loads more.
export function GameList({ games, order, selectedId, hasMore, loadingMore, onSort, onSelect, onMenu, onLoadMore }: Props) {
  return (
    <section
      className="games"
      onScroll={(e) => {
        const list = e.currentTarget;
        if (list.scrollTop + list.clientHeight >= list.scrollHeight - 200) onLoadMore();
      }}
    >
      <table>
        <thead>
          <tr>
            {COLUMNS.map((c) => (
              <th
                key={c.key}
                className={[c.className, "sortable", order.column === c.key ? "sorted" : ""].join(" ")}
                onClick={() => onSort(c.key)}
                title={`Sort by ${c.label}`}
              >
                {c.label}
                {order.column === c.key && (order.descending ? " ▼" : " ▲")}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {games.map((g) => (
            <tr
              key={g.id}
              className={selectedId === g.id ? "active" : ""}
              onClick={() => onSelect(g.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                onMenu(g, e.clientX, e.clientY);
              }}
            >
              {COLUMNS.map((c) => (
                <td key={c.key} className={c.className}>
                  {c.value(g)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {games.length === 0 ? (
        <p className="muted">No games.</p>
      ) : (
        <p className="muted list-end">
          {hasMore ? (
            <button onClick={onLoadMore} disabled={loadingMore}>
              {loadingMore ? "Loading…" : `Showing ${games.length} games, load more`}
            </button>
          ) : (
            `${games.length} ${games.length === 1 ? "game" : "games"}`
          )}
        </p>
      )}
    </section>
  );
}
