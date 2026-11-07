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

/// Whether a filter has nothing set, so it matches every game.
export function isEmptyFilter(f: Filter): boolean {
  return describeFilter(f) === "all games";
}
