import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

type Score = { kind: "cp" | "mate"; value: number };
type EngineLine = { fen: string; multipv: number; depth: number; score: Score; moves: string[] };

const ENGINE_PATH_KEY = "chessvault.enginePath";

function loadEnginePath() {
  try {
    return localStorage.getItem(ENGINE_PATH_KEY) ?? "";
  } catch {
    return "";
  }
}

function saveEnginePath(path: string) {
  try {
    localStorage.setItem(ENGINE_PATH_KEY, path);
  } catch {
    // Without storage the path just isn't remembered.
  }
}

/// A score from White's side: "+0.32", "-1.50", or "#3" / "#-2" for mate.
function formatScore(score: Score) {
  if (score.kind === "mate") return `#${score.value}`;
  const pawns = score.value / 100;
  return `${pawns > 0 ? "+" : ""}${pawns.toFixed(2)}`;
}

/// SAN moves with move numbers, starting from the position in `fen`.
function numberMoves(fen: string, moves: string[]) {
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

/// Runs a UCI engine on the board position and shows its best lines.
export function EnginePanel({ fen }: { fen: string }) {
  const [enginePath, setEnginePath] = useState(loadEnginePath);
  const [running, setRunning] = useState(false);
  const [lines, setLines] = useState<EngineLine[]>([]);
  const [error, setError] = useState("");
  const currentFen = useRef(fen);
  currentFen.current = fen;

  useEffect(() => {
    const unlisten = listen<EngineLine>("engine-line", ({ payload }) => {
      if (payload.fen !== currentFen.current) return;
      setLines((current) => {
        const next = [...current];
        next[payload.multipv - 1] = payload;
        return next;
      });
    });
    return () => {
      unlisten.then((stop) => stop());
    };
  }, []);

  // While running, follow the board to each new position.
  useEffect(() => {
    setLines([]);
    if (!running) return;
    invoke("start_analysis", { enginePath, fen }).catch((e) => {
      setError(String(e));
      setRunning(false);
    });
  }, [fen, running]);

  // Stop the engine when the panel closes.
  useEffect(
    () => () => {
      invoke("stop_analysis").catch(() => {});
    },
    [],
  );

  async function toggle() {
    setError("");
    if (running) {
      setRunning(false);
      await invoke("stop_analysis").catch((e) => setError(String(e)));
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
