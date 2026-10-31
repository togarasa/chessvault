import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Board } from "./Board";
import "./App.css";

type GameSummary = {
  id: number;
  event: string;
  date: string;
  white: string;
  black: string;
  result: string;
};

type Game = GameSummary & { pgn: string };

/// What opening a file did: the database used, its games, and how many were just imported.
type OpenResult = { database: string; games: number; imported: number };

/// One position on the main line. `san` is empty for the start position.
type Step = { san: string; fen: string };

const PAGE_SIZE = 200;
const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

/// Move label for step `n`, where step 1 is White's first move.
function moveLabel(n: number, san: string) {
  const moveNumber = Math.ceil(n / 2);
  return n % 2 === 1 ? `${moveNumber}. ${san}` : `${moveNumber}... ${san}`;
}

function App() {
  const [dbPath, setDbPath] = useState("");
  const [pgnPath, setPgnPath] = useState("");
  const [search, setSearch] = useState("");
  const [games, setGames] = useState<GameSummary[]>([]);
  const [selected, setSelected] = useState<Game | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [ply, setPly] = useState(0);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState("Open a database to begin.");
  const [isOpen, setIsOpen] = useState(false);

  // Arrow keys step through the moves, unless the user is typing.
  useEffect(() => {
    if (!selected) return;
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return;
      if (e.key === "ArrowRight") setPly((p) => Math.min(p + 1, steps.length - 1));
      if (e.key === "ArrowLeft") setPly((p) => Math.max(p - 1, 0));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, steps.length]);

  async function run(action: () => Promise<void>) {
    try {
      await action();
    } catch (error) {
      setStatus(String(error));
    }
  }

  async function openDatabase() {
    await run(async () => {
      const opened = await invoke<OpenResult>("open_database", { path: dbPath.trim().replace(/^"|"$/g, "") });
      setIsOpen(true);
      setSelected(null);
      setStatus(
        opened.imported > 0
          ? `Imported ${opened.imported} games into ${opened.database}.`
          : `Opened ${opened.database} (${opened.games} games).`,
      );
      await loadGames();
    });
  }

  async function importPgn() {
    await run(async () => {
      const imported = await invoke<number>("import_pgn", { path: pgnPath });
      setStatus(`Imported ${imported} games.`);
      await loadGames();
    });
  }

  async function loadGames(query = search) {
    const found = query.trim()
      ? await invoke<GameSummary[]>("search_games", { player: query.trim(), limit: PAGE_SIZE })
      : await invoke<GameSummary[]>("list_games", { limit: PAGE_SIZE, offset: 0 });
    setGames(found);
  }

  async function select(id: number) {
    await run(async () => {
      const [game, found] = await Promise.all([
        invoke<Game | null>("get_game", { id }),
        invoke<Step[]>("game_steps", { id }),
      ]);
      setSelected(game);
      setDraft(game?.pgn ?? "");
      setSteps(found);
      setPly(0);
    });
  }

  async function save() {
    if (!selected) return;
    await run(async () => {
      await invoke("save_game", { id: selected.id, pgn: draft });
      setStatus(`Saved game ${selected.id}. Undo restores the previous version.`);
      await select(selected.id);
      await loadGames();
    });
  }

  async function undo() {
    if (!selected) return;
    await run(async () => {
      const restored = await invoke<boolean>("undo_game", { id: selected.id });
      setStatus(restored ? `Restored game ${selected.id}.` : `Game ${selected.id} has no earlier version.`);
      await select(selected.id);
      await loadGames();
    });
  }

  return (
    <div className="app">
      <header className="toolbar">
        <input
          className="path"
          placeholder="Open a .pgn file or a .sqlite database"
          value={dbPath}
          onChange={(e) => setDbPath(e.currentTarget.value)}
        />
        <button onClick={openDatabase} disabled={!dbPath.trim()}>
          Open
        </button>
        <input
          className="path"
          placeholder="PGN file to import"
          value={pgnPath}
          onChange={(e) => setPgnPath(e.currentTarget.value)}
        />
        <button onClick={importPgn} disabled={!isOpen || !pgnPath.trim()}>
          Import
        </button>
      </header>

      <div className="search">
        <input
          placeholder="Search by player name"
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
          onKeyDown={(e) => e.key === "Enter" && run(() => loadGames())}
          disabled={!isOpen}
        />
        <button onClick={() => run(() => loadGames())} disabled={!isOpen}>
          Search
        </button>
      </div>

      <div className="panes">
        <section className="games">
          <table>
            <thead>
              <tr>
                <th>No.</th>
                <th>Date</th>
                <th>White</th>
                <th>Black</th>
                <th>Result</th>
                <th>Event</th>
              </tr>
            </thead>
            <tbody>
              {games.map((g) => (
                <tr
                  key={g.id}
                  className={selected?.id === g.id ? "active" : ""}
                  onClick={() => select(g.id)}
                >
                  <td>{g.id}</td>
                  <td>{g.date}</td>
                  <td>{g.white}</td>
                  <td>{g.black}</td>
                  <td>{g.result}</td>
                  <td>{g.event}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {isOpen && games.length === 0 && <p className="muted">No games.</p>}
        </section>

        <section className="game">
          {selected ? (
            <>
              <h2>
                {selected.white} – {selected.black}
              </h2>
              <div className="gameview">
                <Board fen={steps[ply]?.fen ?? START_FEN} />
                <div className="controls">
                  <button onClick={() => setPly(0)} disabled={ply === 0}>
                    |&lt;
                  </button>
                  <button onClick={() => setPly((p) => Math.max(p - 1, 0))} disabled={ply === 0}>
                    &lt;
                  </button>
                  <button
                    onClick={() => setPly((p) => Math.min(p + 1, steps.length - 1))}
                    disabled={ply >= steps.length - 1}
                  >
                    &gt;
                  </button>
                  <button onClick={() => setPly(steps.length - 1)} disabled={ply >= steps.length - 1}>
                    &gt;|
                  </button>
                </div>
                <div className="moves">
                  {steps.slice(1).map((step, i) => (
                    <button
                      key={i + 1}
                      className={ply === i + 1 ? "active" : ""}
                      onClick={() => setPly(i + 1)}
                    >
                      {moveLabel(i + 1, step.san)}
                    </button>
                  ))}
                </div>
              </div>
              <textarea value={draft} onChange={(e) => setDraft(e.currentTarget.value)} spellCheck={false} />
              <div className="actions">
                <button onClick={save} disabled={draft === selected.pgn}>
                  Save
                </button>
                <button onClick={undo}>Undo</button>
              </div>
            </>
          ) : (
            <p className="muted">Select a game to view it and edit its PGN.</p>
          )}
        </section>
      </div>

      <footer className="status">{status}</footer>
    </div>
  );
}

export default App;
