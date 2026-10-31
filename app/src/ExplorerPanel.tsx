import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

type Database = "masters" | "lichess";

type ExplorerMove = {
  uci: string;
  san: string;
  white: number;
  draws: number;
  black: number;
  averageRating: number | null;
};

type Explorer = {
  white: number;
  draws: number;
  black: number;
  moves: ExplorerMove[];
  opening: { eco: string; name: string } | null;
};

/// White wins, draws and Black wins as a bar of three segments.
function ResultBar({ white, draws, black }: { white: number; draws: number; black: number }) {
  const total = white + draws + black || 1;
  const pct = (n: number) => `${Math.round((n / total) * 100)}%`;
  return (
    <div className="result-bar" title={`White ${pct(white)}, draws ${pct(draws)}, Black ${pct(black)}`}>
      <span className="w" style={{ width: pct(white) }}>
        {white / total >= 0.15 ? pct(white) : ""}
      </span>
      <span className="d" style={{ width: pct(draws) }}>
        {draws / total >= 0.15 ? pct(draws) : ""}
      </span>
      <span className="b" style={{ width: pct(black) }}>
        {black / total >= 0.15 ? pct(black) : ""}
      </span>
    </div>
  );
}

/// Lichess opening explorer statistics for the board position. Clicking a move plays it.
export function ExplorerPanel({ fen, onPlay }: { fen: string; onPlay: (uci: string) => void }) {
  const [database, setDatabase] = useState<Database>("masters");
  const [data, setData] = useState<Explorer | null>(null);
  const [error, setError] = useState("");
  const [hasToken, setHasToken] = useState<boolean | null>(null);
  const [editingToken, setEditingToken] = useState(false);
  const [tokenInput, setTokenInput] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    invoke<boolean>("has_lichess_token")
      .then(setHasToken)
      .catch(() => setHasToken(false));
  }, []);

  // Look up the position, waiting briefly so quick move steps make one request.
  useEffect(() => {
    if (!hasToken) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      invoke<Explorer>("explore", { database, fen })
        .then((result) => {
          if (cancelled) return;
          setData(result);
          setError("");
        })
        .catch((e) => {
          if (cancelled) return;
          setData(null);
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
      await invoke("set_lichess_token", { token: tokenInput });
      setHasToken(tokenInput.trim() !== "");
      setTokenInput("");
      setEditingToken(false);
      setReload((n) => n + 1);
    } catch (e) {
      setError(String(e));
    }
  }

  const showTokenForm = hasToken === false || editingToken;

  return (
    <div className="panel">
      <div className="panel-head">
        <strong>Lichess explorer</strong>
        <select value={database} onChange={(e) => setDatabase(e.currentTarget.value as Database)}>
          <option value="masters">Masters</option>
          <option value="lichess">Lichess games</option>
        </select>
        {hasToken && (
          <button onClick={() => setEditingToken((v) => !v)}>{editingToken ? "Cancel" : "Token"}</button>
        )}
      </div>

      {showTokenForm && (
        <div className="token-form">
          <p className="muted">
            The explorer needs a Lichess personal token. Create one with no scopes at
            lichess.org/account/oauth/token. It is stored only on this computer.
          </p>
          <div className="row">
            <input
              type="password"
              autoComplete="off"
              placeholder="Lichess personal token"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.currentTarget.value)}
            />
            <button onClick={saveToken} disabled={!tokenInput.trim() && !hasToken}>
              {tokenInput.trim() || !hasToken ? "Save" : "Remove"}
            </button>
          </div>
        </div>
      )}

      {error && <p className="error">{error}</p>}

      {data && !showTokenForm && (
        <>
          {data.opening && (
            <p className="opening">
              {data.opening.eco} {data.opening.name}
            </p>
          )}
          <table className="explorer">
            <thead>
              <tr>
                <th>Move</th>
                <th>Games</th>
                <th>Results</th>
                <th>Avg.</th>
              </tr>
            </thead>
            <tbody>
              {data.moves.map((m) => (
                <tr key={m.uci} className="playable" onClick={() => onPlay(m.uci)} title={`Play ${m.san}`}>
                  <td>{m.san}</td>
                  <td>{(m.white + m.draws + m.black).toLocaleString()}</td>
                  <td>
                    <ResultBar white={m.white} draws={m.draws} black={m.black} />
                  </td>
                  <td>{m.averageRating ?? ""}</td>
                </tr>
              ))}
              <tr className="total">
                <td>Total</td>
                <td>{(data.white + data.draws + data.black).toLocaleString()}</td>
                <td>
                  <ResultBar white={data.white} draws={data.draws} black={data.black} />
                </td>
                <td></td>
              </tr>
            </tbody>
          </table>
          {data.moves.length === 0 && <p className="muted">No games reach this position.</p>}
        </>
      )}
    </div>
  );
}
