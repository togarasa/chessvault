/// Engine analysis lines and how they are shown.

/// A score from White's side (`engine::Score`).
export type Score = { kind: "cp" | "mate"; value: number };

/// One analysis line from the engine (`engine::EngineLine`).
export type EngineLine = { fen: string; multipv: number; depth: number; score: Score; moves: string[] };

const ENGINE_PATH_KEY = "chessvault.enginePath";

export function loadEnginePath(): string {
  try {
    return localStorage.getItem(ENGINE_PATH_KEY) ?? "";
  } catch {
    return "";
  }
}

export function saveEnginePath(path: string) {
  try {
    localStorage.setItem(ENGINE_PATH_KEY, path);
  } catch {
    // Without storage the path just isn't remembered.
  }
}

/// A score from White's side: "+0.32", "-1.50", "0.00", or "#3" / "#-2" for mate.
export function formatScore(score: Score): string {
  if (score.kind === "mate") return `#${score.value}`;
  const pawns = score.value / 100;
  return `${pawns > 0 ? "+" : ""}${pawns.toFixed(2)}`;
}

/// SAN moves with move numbers, starting from the position in `fen`.
export function numberMoves(fen: string, moves: string[]): string {
  const fields = fen.split(" ");
  let whiteToMove = fields[1] !== "b";
  let moveNumber = Number(fields[5]) || 1;
  return moves
    .map((san, i) => {
      const label = whiteToMove ? `${moveNumber}. ${san}` : i === 0 ? `${moveNumber}... ${san}` : san;
      if (!whiteToMove) moveNumber += 1;
      whiteToMove = !whiteToMove;
      return label;
    })
    .join(" ");
}

/// Puts a new line in its place by line number, keeping the others.
export function withLine(lines: EngineLine[], line: EngineLine): EngineLine[] {
  const next = [...lines];
  next[line.multipv - 1] = line;
  return next;
}
