import { EngineLine, formatScore, numberedMoves } from "./engine";
import { Engine } from "./useEngine";

/// Shows the engine's best lines for the board position and lets the user start and stop it.
/// Clicking a move of a line plays the line up to that move.
export function EnginePanel({ engine, onPlay }: { engine: Engine; onPlay: (line: EngineLine, through: number) => void }) {
  const { enginePath, setEnginePath, running, lines, error, toggle } = engine;

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
          <span className="pv">
            {numberedMoves(line.fen, line.moves.slice(0, 12)).map((label, i) => (
              <button key={i} className="pv-move" title="Play the line up to here" onClick={() => onPlay(line, i)}>
                {label}
              </button>
            ))}
          </span>
        </div>
      ))}
    </div>
  );
}
