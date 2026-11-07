import { formatScore, numberMoves } from "./engine";
import { useEngine } from "./useEngine";

/// Runs a UCI engine on the board position and shows its best lines.
export function EnginePanel({ fen }: { fen: string }) {
  const { enginePath, setEnginePath, running, lines, error, toggle } = useEngine(fen);

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
