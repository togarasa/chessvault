import { useEffect, useState } from "react";

/// What to look for in a game search; matches `db::Filter` in the core library.
/// Empty fields match every game; text matches any part of a value, ignoring case.
export type Filter = {
  white: string;
  black: string;
  /// Also find the games where the names are the other way round.
  ignoreColour: boolean;
  result: string;
  ecoFrom: string;
  ecoTo: string;
  dateFrom: string;
  dateTo: string;
  minWhiteElo: number | null;
  minBlackElo: number | null;
  event: string;
  site: string;
};

export const EMPTY_FILTER: Filter = {
  white: "",
  black: "",
  ignoreColour: false,
  result: "",
  ecoFrom: "",
  ecoTo: "",
  dateFrom: "",
  dateTo: "",
  minWhiteElo: null,
  minBlackElo: null,
  event: "",
  site: "",
};

/// A filter that finds `name` as either player, as the quick search box does.
export function playerFilter(name: string): Filter {
  return { ...EMPTY_FILTER, white: name, ignoreColour: true };
}

/// A short description of a filter for the bar above the game list.
export function describeFilter(f: Filter): string {
  const parts: string[] = [];
  const range = (from: string, to: string) => (from && to ? `${from}–${to}` : from ? `from ${from}` : `to ${to}`);
  if (f.white || f.black) {
    const players = [f.white || "anyone", f.black || "anyone"].join(" – ");
    parts.push(f.ignoreColour ? `${players} (either colour)` : players);
  }
  if (f.result) parts.push(`result ${f.result}`);
  if (f.ecoFrom || f.ecoTo) parts.push(`ECO ${range(f.ecoFrom, f.ecoTo)}`);
  if (f.dateFrom || f.dateTo) parts.push(`date ${range(f.dateFrom, f.dateTo)}`);
  if (f.minWhiteElo !== null) parts.push(`White Elo ≥ ${f.minWhiteElo}`);
  if (f.minBlackElo !== null) parts.push(`Black Elo ≥ ${f.minBlackElo}`);
  if (f.event) parts.push(`event "${f.event}"`);
  if (f.site) parts.push(`site "${f.site}"`);
  return parts.join(" · ") || "all games";
}

const RESULTS: [string, string][] = [
  ["", "Any"],
  ["1-0", "1-0"],
  ["0-1", "0-1"],
  ["1/2-1/2", "½-½"],
  ["*", "* (unfinished)"],
];

/// The search window: players, result, ECO and date ranges, minimum Elo, event and site.
export function SearchDialog({
  initial,
  onSearch,
  onClose,
}: {
  initial: Filter;
  onSearch: (filter: Filter) => void;
  onClose: () => void;
}) {
  const [f, setF] = useState<Filter>(initial);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const text = (key: keyof Filter, label: string, placeholder = "") => (
    <label>
      {label}
      <input
        value={f[key] as string}
        placeholder={placeholder}
        onChange={(e) => setF({ ...f, [key]: e.currentTarget.value })}
      />
    </label>
  );
  const elo = (key: "minWhiteElo" | "minBlackElo", label: string) => (
    <label>
      {label}
      <input
        type="number"
        min={0}
        value={f[key] ?? ""}
        onChange={(e) => {
          const n = parseInt(e.currentTarget.value, 10);
          setF({ ...f, [key]: Number.isNaN(n) ? null : n });
        }}
      />
    </label>
  );

  return (
    <div className="overlay" onMouseDown={onClose}>
      <form
        className="dialog search-dialog"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          const trimmed = Object.fromEntries(
            Object.entries(f).map(([k, v]) => [k, typeof v === "string" ? v.trim() : v]),
          ) as Filter;
          onSearch(trimmed);
        }}
      >
        <strong>Search games</strong>
        <fieldset>
          <legend>Players</legend>
          {text("white", "White player")}
          {text("black", "Black player")}
          <label className="check">
            <input
              type="checkbox"
              checked={f.ignoreColour}
              onChange={(e) => setF({ ...f, ignoreColour: e.currentTarget.checked })}
            />
            Ignore colour
          </label>
        </fieldset>
        <fieldset>
          <legend>Game</legend>
          <label>
            Result
            <select aria-label="Result" value={f.result} onChange={(e) => setF({ ...f, result: e.currentTarget.value })}>
              {RESULTS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {text("ecoFrom", "ECO from", "B20")}
          {text("ecoTo", "ECO to", "B99")}
          {text("dateFrom", "Date from", "2024 or 2024.06.15")}
          {text("dateTo", "Date to", "2026")}
        </fieldset>
        <fieldset>
          <legend>Ratings and place</legend>
          {elo("minWhiteElo", "White Elo at least")}
          {elo("minBlackElo", "Black Elo at least")}
          {text("event", "Event")}
          {text("site", "Site")}
        </fieldset>
        <div className="actions">
          <button type="submit">Search</button>
          <button type="button" onClick={() => setF(EMPTY_FILTER)}>
            Clear fields
          </button>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
