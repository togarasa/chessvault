/// PGN text helpers for new games.

/// The game header fields shown above the board, besides the result.
export const HEADER_FIELDS = ["White", "Black", "Event", "Date"];
export const RESULTS = ["*", "1-0", "0-1", "1/2-1/2"];

/// A date in PGN's form, e.g. 2026.11.07.
export function pgnDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
}

/// An empty game dated `date`, with the seven standard tags.
export function newGamePgn(date: Date): string {
  return `[Event "?"]\n[Site "?"]\n[Date "${pgnDate(date)}"]\n[Round "?"]\n[White "?"]\n[Black "?"]\n[Result "*"]\n\n*\n`;
}

/// The value of a header field for a form: empty instead of PGN's "?" placeholder.
export function formValue(value: string | undefined): string {
  return value === undefined || value === "?" ? "" : value;
}

/// The value to store from a form field: PGN's "?" placeholder instead of nothing.
export function headerValue(value: string): string {
  return value.trim() || "?";
}
