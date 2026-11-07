import { useEffect, useState } from "react";
import { EMPTY_FILTER, Filter } from "./filter";

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
