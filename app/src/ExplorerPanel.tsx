import { ExplorerDatabase } from "./types";
import { useExplorer } from "./useExplorer";

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
  const { database, setDatabase, data, error, hasToken, editingToken, setEditingToken, tokenInput, setTokenInput, saveToken } =
    useExplorer(fen);

  const showTokenForm = hasToken === false || editingToken;

  return (
    <div className="panel">
      <div className="panel-head">
        <strong>Lichess explorer</strong>
        <select value={database} onChange={(e) => setDatabase(e.currentTarget.value as ExplorerDatabase)}>
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
