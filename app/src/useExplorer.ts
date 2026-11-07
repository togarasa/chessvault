import { useEffect, useState } from "react";
import { explore, hasLichessToken, setLichessToken } from "./api";
import { Explorer, ExplorerDatabase } from "./types";

/// The Lichess explorer for the board position: the database, the token, the answer and errors.
export function useExplorer(fen: string) {
  const [database, setDatabase] = useState<ExplorerDatabase>("masters");
  /// The last answer and the position it is for.
  const [found, setFound] = useState<{ fen: string; explorer: Explorer } | null>(null);
  const [error, setError] = useState("");
  const [hasToken, setHasToken] = useState<boolean | null>(null);
  const [editingToken, setEditingToken] = useState(false);
  const [tokenInput, setTokenInput] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    hasLichessToken()
      .then(setHasToken)
      .catch(() => setHasToken(false));
  }, []);

  // Look up the position, waiting briefly so quick move steps make one request.
  useEffect(() => {
    if (!hasToken) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      explore(database, fen)
        .then((result) => {
          if (cancelled) return;
          setFound({ fen, explorer: result });
          setError("");
        })
        .catch((e) => {
          if (cancelled) return;
          setFound(null);
          setError(String(e));
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [fen, database, hasToken, reload]);

  async function saveToken() {
    try {
      await setLichessToken(tokenInput);
      setHasToken(tokenInput.trim() !== "");
      setTokenInput("");
      setEditingToken(false);
      setReload((n) => n + 1);
    } catch (e) {
      setError(String(e));
    }
  }

  return {
    database,
    setDatabase,
    // Only the answer for the shown position: moves from another position would not be legal here.
    data: found?.fen === fen ? found.explorer : null,
    error,
    hasToken,
    editingToken,
    setEditingToken,
    tokenInput,
    setTokenInput,
    saveToken,
  };
}
