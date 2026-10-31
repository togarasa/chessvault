import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
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

const PAGE_SIZE = 200;

function App() {
  const [dbPath, setDbPath] = useState("");
  const [pgnPath, setPgnPath] = useState("");
  const [search, setSearch] = useState("");
  const [games, setGames] = useState<GameSummary[]>([]);
  const [selected, setSelected] = useState<Game | null>(null);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState("Open a database to begin.");
  const [isOpen, setIsOpen] = useState(false);

  async function run(action: () => Promise<void>) {
    try {
      await action();
    } catch (error) {
      setStatus(String(error));
    }
  }

  async function openDatabase() {
    await run(async () => {
      const count = await invoke<number>("open_database", { path: dbPath });
      setIsOpen(true);
      setStatus(`Opened ${dbPath} (${count} games).`);
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
      const game = await invoke<Game | null>("get_game", { id });
      setSelected(game);
      setDraft(game?.pgn ?? "");
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
          placeholder="Database file, e.g. C:\chess\chessvault.sqlite"
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
              <textarea value={draft} onChange={(e) => setDraft(e.currentTarget.value)} spellCheck={false} />
              <div className="actions">
                <button onClick={save} disabled={draft === selected.pgn}>
                  Save
                </button>
                <button onClick={undo}>Undo</button>
              </div>
            </>
          ) : (
            <p className="muted">Select a game to view and edit its PGN.</p>
          )}
        </section>
      </div>

      <footer className="status">{status}</footer>
    </div>
  );
}

export default App;
