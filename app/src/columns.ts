import { GameSummary, Order, SortColumn } from "./types";

export type Column = {
  key: SortColumn;
  label: string;
  value: (g: GameSummary) => string | number;
  className?: string;
};

/// The game list's columns, in ChessBase's familiar order. Clicking a header sorts by it.
export const COLUMNS: Column[] = [
  { key: "id", label: "No.", value: (g) => g.id, className: "num" },
  { key: "white", label: "White", value: (g) => g.white },
  { key: "whiteElo", label: "Elo", value: (g) => g.whiteElo ?? "", className: "num" },
  { key: "black", label: "Black", value: (g) => g.black },
  { key: "blackElo", label: "Elo", value: (g) => g.blackElo ?? "", className: "num" },
  { key: "result", label: "Result", value: (g) => g.result },
  { key: "plies", label: "Moves", value: (g) => (g.plies === null ? "" : Math.ceil(g.plies / 2)), className: "num" },
  { key: "eco", label: "ECO", value: (g) => g.eco },
  { key: "event", label: "Event", value: (g) => g.event },
  { key: "site", label: "Site", value: (g) => g.site },
  { key: "round", label: "Round", value: (g) => g.round },
  { key: "date", label: "Date", value: (g) => g.date },
];

export const DEFAULT_ORDER: Order = { column: "id", descending: false };

/// The order after clicking `column`: ascending by it, or reversed when it is already the sorted column.
export function nextOrder(order: Order, column: SortColumn): Order {
  return { column, descending: order.column === column && !order.descending };
}
