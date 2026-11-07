import { useEffect, useRef, useState } from "react";
import { onEngineLine, startAnalysis, stopAnalysis } from "./api";
import { EngineLine, formatScore, loadEnginePath, numberMoves, saveEnginePath, withLine } from "./engine";

/// Runs a UCI engine on the board position and shows its best lines.
export function EnginePanel({ fen }: { fen: string }) {
  const [enginePath, setEnginePath] = useState(loadEnginePath);
  const [running, setRunning] = useState(false);
  const [lines, setLines] = useState<EngineLine[]>([]);
  const [error, setError] = useState("");
  const currentFen = useRef(fen);
  currentFen.current = fen;

  // Lines for an earlier position can still arrive after a move; only the current position's count.
  useEffect(
    () =>
      onEngineLine((line) => {
        if (line.fen === currentFen.current) setLines((current) => withLine(current, line));
      }),
    [],
  );

  // While running, follow the board to each new position.
  useEffect(() => {
    setLines([]);
    if (!running) return;
    startAnalysis(enginePath, fen).catch((e) => {
      setError(String(e));
      setRunning(false);
    });
  }, [fen, running]);

  // Stop the engine when the panel closes.
  useEffect(
    () => () => {
      stopAnalysis().catch(() => {});
    },
    [],
  );

  async function toggle() {
    setError("");
    if (running) {
      setRunning(false);
      await stopAnalysis().catch((e) => setError(String(e)));
    } else {
      saveEnginePath(enginePath);
      setRunning(true);
    }
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <strong>Engine</strong>
        <input
          className="path"
          placeholder="Path to Stockfish or another UCI engine"
          value={enginePath}
          onChange={(e) => setEnginePath(e.currentTarget.value)}
          disabled={running}
        />
        <button onClick={toggle} disabled={!enginePath.trim()}>
          {running ? "Stop" : "Analyze"}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      {running && lines.length === 0 && !error && <p className="muted">Thinking…</p>}
      {lines.filter(Boolean).map((line) => (
        <div className="engine-line" key={line.multipv}>
          <span className="score">{formatScore(line.score)}</span>
          <span className="depth">d{line.depth}</span>
          <span className="pv">{numberMoves(line.fen, line.moves.slice(0, 12))}</span>
        </div>
      ))}
    </div>
  );
}
