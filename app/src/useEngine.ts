import { useEffect, useRef, useState } from "react";
import { onEngineLine, startAnalysis, stopAnalysis } from "./api";
import { EngineLine, loadEnginePath, saveEnginePath, withLine } from "./engine";

/// A UCI engine analysing the board position: the engine path, whether it runs, its lines and errors.
export function useEngine(fen: string) {
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

  return { enginePath, setEnginePath, running, lines, error, toggle };
}
