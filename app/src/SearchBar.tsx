import { Filter, describeFilter } from "./filter";

type Props = {
  text: string;
  onText: (text: string) => void;
  /// Searches for the typed player name, or shows all games when it is empty.
  onSearch: () => void;
  onSearchWindow: () => void;
  /// The search the list shows, or null for all games.
  filter: Filter | null;
  onShowAll: () => void;
};

/// The quick player search above the game list, with the search window and the active search.
export function SearchBar({ text, onText, onSearch, onSearchWindow, filter, onShowAll }: Props) {
  return (
    <div className="search">
      <input
        placeholder="Search by player name"
        value={text}
        onChange={(e) => onText(e.currentTarget.value)}
        onKeyDown={(e) => e.key === "Enter" && onSearch()}
      />
      <button onClick={onSearch}>Search</button>
      <button onClick={onSearchWindow} title="Search by players, result, ECO, date, Elo…">
        Search games…
      </button>
      {filter && (
        <span className="filter-summary">
          Showing: {describeFilter(filter)}
          <button onClick={onShowAll}>Show all games</button>
        </span>
      )}
    </div>
  );
}
