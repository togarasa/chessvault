import { Color } from "chessops/types";
import { Score, formatScore, whiteShare } from "./engine";

/// A bar beside the board showing who stands better, from the engine's best line. White's part
/// is on White's side of the board, so it follows the board when it is flipped.
export function EvalBar({ score, orientation }: { score: Score | null; orientation: Color }) {
  if (!score) return <div className="evalbar idle" aria-hidden="true" />;
  const share = whiteShare(score);
  return (
    <div
      className={`evalbar ${orientation === "white" ? "white-below" : "white-above"}`}
      title={formatScore(score)}
      role="img"
      aria-label={`Evaluation ${formatScore(score)}`}
    >
      <div className="evalbar-white" style={{ height: `${share}%` }} />
    </div>
  );
}
