import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Key } from "chessground/types";
import { Move, NormalMove, Role, SquareName } from "chessops/types";
import { parseSquare, parseUci, squareRank } from "chessops/util";
import { Board } from "./Board";
import { Ask, ContextMenu, Dialog, MenuItem } from "./Dialog";
import { EnginePanel } from "./EnginePanel";
import { ExplorerPanel } from "./ExplorerPanel";
import { Notation } from "./Notation";
import { RecentFile, addRecent, clearRecent, fileName, loadRecent, removeRecent } from "./recent";
import {
  AddMode,
  GameTree,
  MOVE_NAGS,
  MoveNode,
  POSITION_NAGS,
  addMove,
  childFor,
  deleteFrom,
  deleteVariation,
  nodeAt,
  parseGame,
  pathTo,
  position,
  promoteVariation,
  toggleNag,
  variationStart,
  writeGame,
} from "./tree";
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

const PAGE_SIZE = 200;
const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const RESULTS = ["*", "1-0", "0-1", "1/2-1/2"];
const HEADER_FIELDS = ["White", "Black", "Event", "Date"];
const THIS_DATABASE = "This database";
const OTHER_FILE = "Another file (PGN or database)";

function today() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
}

function newGamePgn() {
  return `[Event "?"]\n[Site "?"]\n[Date "${today()}"]\n[Round "?"]\n[White "?"]\n[Black "?"]\n[Result "*"]\n\n*\n`;
}

function App() {
  const [dbPath, setDbPath] = useState("");
  const [pgnPath, setPgnPath] = useState("");
  const [search, setSearch] = useState("");
  const [games, setGames] = useState<GameSummary[]>([]);
  const [status, setStatus] = useState("Open a database to begin.");
  const [isOpen, setIsOpen] = useState(false);
  /// Whether the database may have more games than the list has loaded.
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [recent, setRecent] = useState<RecentFile[]>(loadRecent);

  /// The game on the board: its id (null until a new game is saved), its moves and the shown position.
  const [gameId, setGameId] = useState<number | null>(null);
  const [tree, setTree] = useState<GameTree | null>(null);
  const [current, setCurrent] = useState<MoveNode | null>(null);
  /// Bumped on every change to the tree, which is edited in place.
  const [revision, setRevision] = useState(0);
  /// The PGN as last loaded or saved, to tell whether there are unsaved changes.
  const [savedPgn, setSavedPgn] = useState("");
  const [draft, setDraft] = useState("");
  const [ask, setAsk] = useState<Ask | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);

  const treePgn = useMemo(() => (tree ? writeGame(tree) : ""), [tree, revision]);
  const dirty = tree !== null && (treePgn !== savedPgn || draft !== treePgn);

  function askUser(question: Omit<Ask, "answer">): Promise<string | null> {
    return new Promise((resolve) =>
      setAsk({
        ...question,
        answer: (value) => {
          setAsk(null);
          resolve(value);
        },
      }),
    );
  }

  /// Call after editing the tree in place.
  function changed() {
    setRevision((r) => r + 1);
    if (tree) setDraft(writeGame(tree));
  }

  // Arrow keys step through the moves, unless the user is typing or a dialog is open.
  useEffect(() => {
    if (!current || ask || menu) return;
    const node = current;
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return;
      if (e.target instanceof HTMLSelectElement) return;
      let next: MoveNode | null | undefined;
      if (e.key === "ArrowRight") next = node.children[0];
      if (e.key === "ArrowLeft") next = node.parent;
      if (e.key === "Home") for (next = node; next.parent; next = next.parent);
      if (e.key === "End") for (next = node; next.children[0]; next = next.children[0]);
      if (next) {
        e.preventDefault();
        setCurrent(next);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, ask, menu]);

  async function run(action: () => Promise<void>) {
    try {
      await action();
    } catch (error) {
      setStatus(String(error));
    }
  }

  /// Asks before throwing away unsaved changes. Returns whether to go on.
  async function confirmDiscard() {
    if (!dirty) return true;
    const answer = await askUser({
      title: "The game on the board has unsaved changes.",
      choices: [{ label: "Discard changes", value: "discard" }],
    });
    return answer === "discard";
  }

  /// Opens a database or PGN file, by default the one typed in the toolbar.
  async function openDatabase(path = dbPath.trim().replace(/^"|"$/g, "")) {
    if (!(await confirmDiscard())) return;
    setDbPath(path);
    let opened: OpenResult;
    try {
      opened = await invoke<OpenResult>("open_database", { path });
    } catch (error) {
      setStatus(String(error));
      if (recent.some((f) => f.path === path)) {
        const answer = await askUser({
          title: `${fileName(path)} could not be opened: ${error}`,
          choices: [{ label: "Remove from recent files", value: "remove" }],
        });
        if (answer === "remove") setRecent(removeRecent(path));
      }
      return;
    }
    setRecent(addRecent(path));
    await run(async () => {
      setIsOpen(true);
      showGame(null, null);
      setStatus(
        opened.imported > 0
          ? `Imported ${opened.imported} games into ${opened.database}.`
          : `Opened ${opened.database} (${opened.games} games).`,
      );
      await loadGames(search, 0);
    });
  }

  /// Writes all games, or the game on the board, to a PGN file that ChessBase and other programs can open.
  async function exportPgn() {
    const base = dbPath.replace(/\.(pgn|sqlite)$/i, "");
    const choice = await new Promise<Record<string, string> | null>((resolve) =>
      setAsk({
        title: "Export to PGN",
        fields: [
          { name: "File", value: `${base} (ChessVault).pgn` },
          { name: "Games", value: "All games", options: gameId === null ? ["All games"] : ["All games", "Game on the board"] },
        ],
        answer: (value, values) => {
          setAsk(null);
          resolve(value && values ? values : null);
        },
      }),
    );
    if (!choice) return;
    const path = choice.File.trim().replace(/^"|"$/g, "");
    if (!path) return;
    if (dirty) {
      const answer = await askUser({
        title: "The game on the board has unsaved changes. The export has the last saved version.",
        choices: [{ label: "Export anyway", value: "go" }],
      });
      if (answer !== "go") return;
    }
    if (await invoke<boolean>("file_exists", { path })) {
      const answer = await askUser({
        title: `${fileName(path)} already exists.`,
        choices: [{ label: "Replace it", value: "replace" }],
      });
      if (answer !== "replace") return;
    }
    await run(async () => {
      const ids = choice.Games === "All games" ? null : [gameId];
      const written = await invoke<number>("export_pgn", { path, ids });
      setStatus(`Exported ${written} ${written === 1 ? "game" : "games"} to ${path}.`);
    });
  }

  async function importPgn() {
    await run(async () => {
      const imported = await invoke<number>("import_pgn", { path: pgnPath });
      setStatus(`Imported ${imported} games.`);
      await loadGames();
    });
  }

  function fetchGames(query: string, limit: number, offset: number) {
    return query.trim()
      ? invoke<GameSummary[]>("search_games", { player: query.trim(), limit, offset })
      : invoke<GameSummary[]>("list_games", { limit, offset });
  }

  /// Loads the list from the top again, keeping as many rows as are loaded now so a refresh
  /// after saving or deleting doesn't lose the place.
  async function loadGames(query = search, keep = games.length) {
    const limit = Math.max(PAGE_SIZE, keep);
    const found = await fetchGames(query, limit, 0);
    setGames(found);
    setHasMore(found.length === limit);
  }

  async function loadMore() {
    if (!hasMore || loadingMore) return;
    setLoadingMore(true);
    await run(async () => {
      const found = await fetchGames(search, PAGE_SIZE, games.length);
      setGames((loaded) => [...loaded, ...found]);
      setHasMore(found.length === PAGE_SIZE);
    });
    setLoadingMore(false);
  }

  /// Puts a game on the board at the move `path` leads to, or clears the board when `pgn` is null.
  function showGame(id: number | null, pgn: string | null, path: number[] = []) {
    const parsed = pgn === null ? null : parseGame(pgn);
    const written = parsed ? writeGame(parsed) : "";
    setGameId(id);
    setTree(parsed);
    setCurrent(parsed ? nodeAt(parsed.root, path) : null);
    setSavedPgn(written);
    setDraft(written);
  }

  async function select(id: number) {
    if (id === gameId || !(await confirmDiscard())) return;
    await run(async () => {
      const game = await invoke<Game | null>("get_game", { id });
      showGame(id, game?.pgn ?? null);
    });
  }

  async function newGame() {
    if (!(await confirmDiscard())) return;
    showGame(null, newGamePgn());
    setStatus("New game. Make moves on the board, then save it.");
  }

  async function save() {
    if (!tree) return;
    await run(async () => {
      let id = gameId;
      let pgn = draft;
      if (id === null) {
        const target = await askGameDetails();
        if (target === null) return;
        pgn = writeGame(tree);
        if (target !== "") {
          await invoke("add_game_to", { path: target, pgn });
          setSavedPgn(pgn);
          setDraft(pgn);
          setRecent(addRecent(target));
          setStatus(`Saved the game to ${target}.`);
          await loadGames();
          return;
        }
        id = await invoke<number>("add_game", { pgn });
        setStatus(`Added game ${id}.`);
      } else {
        await invoke("save_game", { id, pgn });
        setStatus(`Saved game ${id}. Undo restores the previous version.`);
      }
      await reload(id);
    });
  }

  /// Deletes a game from the database after asking.
  async function deleteGame(game: GameSummary) {
    const answer = await askUser({
      title: `Delete game ${game.id}: ${game.white} – ${game.black} (${game.date})? This cannot be undone.`,
      choices: [{ label: "Delete game", value: "delete" }],
    });
    if (answer !== "delete") return;
    await run(async () => {
      await invoke<boolean>("delete_game", { id: game.id });
      if (game.id === gameId) showGame(null, null);
      setStatus(`Deleted game ${game.id}.`);
      await loadGames();
    });
  }

  async function undo() {
    if (gameId === null) return;
    await run(async () => {
      const restored = await invoke<boolean>("undo_game", { id: gameId });
      setStatus(restored ? `Restored game ${gameId}.` : `Game ${gameId} has no earlier version.`);
      await reload(gameId);
    });
  }

  /// Asks for the players and event of a new game and puts them in its headers. Returns false when cancelled.
  /// Returns where to save it: "" for the open database, a file path for another file, or null when cancelled.
  async function askGameDetails(): Promise<string | null> {
    if (!tree) return null;
    const folder = dbPath.slice(0, Math.max(dbPath.lastIndexOf("\\"), dbPath.lastIndexOf("/")) + 1);
    const fields = await new Promise<Record<string, string> | null>((resolve) =>
      setAsk({
        title: "Save as new game",
        fields: [
          ...HEADER_FIELDS.map((name) => ({ name, value: tree.headers.get(name) === "?" ? "" : (tree.headers.get(name) ?? "") })),
          { name: "Result", value: tree.headers.get("Result") ?? "*", options: RESULTS },
          { name: "Save to", value: THIS_DATABASE, options: [THIS_DATABASE, OTHER_FILE] },
          {
            name: "File",
            value: `${folder}My games.pgn`,
            hint: "Used for another file. A .pgn file gets the game added (or is created with only this game); a .sqlite file is a ChessVault database.",
          },
        ],
        answer: (value, values) => {
          setAsk(null);
          resolve(value && values ? values : null);
        },
      }),
    );
    if (!fields) return null;
    for (const name of [...HEADER_FIELDS, "Result"]) tree.headers.set(name, fields[name].trim() || "?");
    changed();
    if (fields["Save to"] === THIS_DATABASE) return "";
    const path = fields.File.trim().replace(/^"|"$/g, "");
    if (!path) throw new Error("enter the file to save the game to");
    return path;
  }

  /// Loads a game again after it was saved, staying on the shown move.
  async function reload(id: number) {
    const path = current ? pathTo(current) : [];
    const game = await invoke<Game | null>("get_game", { id });
    showGame(id, game?.pgn ?? null, path);
    await loadGames();
  }

  /// Plays `move` from the shown position, asking how to add it when the position already has a continuation.
  async function play(move: Move) {
    if (!current) return;
    const { node, existing } = childFor(current, move);
    if (existing) {
      setCurrent(node);
      return;
    }
    let mode: AddMode = "mainline";
    if (current.children.length > 0) {
      const answer = await askUser({
        title: `${node.san} is a new move here.`,
        choices: [
          { label: "New variation", value: "variation" },
          { label: "Overwrite", value: "overwrite" },
          { label: "New main line", value: "mainline" },
        ],
      });
      if (!answer) {
        setRevision((r) => r + 1); // Put the piece back.
        return;
      }
      mode = answer as AddMode;
    }
    addMove(current, node, mode);
    setCurrent(node);
    changed();
  }

  async function onBoardMove(from: Key, to: Key) {
    if (!current) return;
    // The board only offers legal moves, so both keys are real squares.
    const move: NormalMove = { from: parseSquare(from as SquareName), to: parseSquare(to as SquareName) };
    const piece = position(current).board.get(move.from);
    if (piece?.role === "pawn" && [0, 7].includes(squareRank(move.to))) {
      const role = await askUser({
        title: "Promote to",
        choices: [
          { label: "Queen", value: "queen" },
          { label: "Rook", value: "rook" },
          { label: "Bishop", value: "bishop" },
          { label: "Knight", value: "knight" },
        ],
      });
      if (!role) {
        setRevision((r) => r + 1);
        return;
      }
      move.promotion = role as Role;
    }
    await play(move);
  }

  async function editComment(node: MoveNode) {
    const text = await askUser({ title: `Comment after ${node.san || "the start"}`, text: node.comments.join(" ") });
    if (text === null) return;
    node.comments = text.trim() ? [text.trim()] : [];
    changed();
  }

  function openMenu(node: MoveNode, x: number, y: number) {
    const inVariation = variationStart(node) !== null;
    const symbolRow = (nags: [number, string][]): MenuItem => ({
      buttons: nags.map(([nag, label]) => ({
        label,
        active: node.nags.includes(nag),
        action: () => {
          toggleNag(node, nag);
          changed();
        },
      })),
    });
    setMenu({
      x,
      y,
      items: [
        { label: node.comments.length ? "Edit comment…" : "Add comment…", action: () => editComment(node) },
        symbolRow(MOVE_NAGS),
        symbolRow(POSITION_NAGS),
        {
          label: "Remove comment and symbols",
          disabled: !node.comments.length && !node.nags.length,
          action: () => {
            node.comments = [];
            node.nags = [];
            changed();
          },
        },
        "separator",
        {
          label: "Promote variation",
          disabled: !inVariation,
          action: () => {
            promoteVariation(node);
            changed();
          },
        },
        {
          label: "Delete variation",
          disabled: !inVariation,
          action: () => {
            setCurrent(deleteVariation(node));
            changed();
          },
        },
        {
          label: "Delete moves from here",
          action: () => {
            setCurrent(deleteFrom(node));
            changed();
          },
        },
      ],
    });
  }

  function setHeader(name: string, value: string) {
    if (!tree) return;
    tree.headers.set(name, value);
    changed();
  }

  const fen = current?.fen ?? START_FEN;

  return (
    <div className="app">
      <header className="toolbar">
        <input
          className="path"
          placeholder="Open a .pgn file or a .sqlite database"
          value={dbPath}
          onChange={(e) => setDbPath(e.currentTarget.value)}
        />
        <button onClick={() => openDatabase()} disabled={!dbPath.trim()}>
          Open
        </button>
        <button
          onClick={(e) => {
            const box = e.currentTarget.getBoundingClientRect();
            setMenu({
              x: box.left,
              y: box.bottom + 2,
              items: [
                ...recent.map((f) => ({ label: fileName(f.path), action: () => openDatabase(f.path) })),
                "separator" as const,
                { label: "Clear list", action: () => setRecent(clearRecent()) },
              ],
            });
          }}
          disabled={recent.length === 0}
          title="Recently opened files"
        >
          Recent ▾
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
        <button onClick={newGame} disabled={!isOpen}>
          New game
        </button>
        <button onClick={exportPgn} disabled={!isOpen}>
          Export PGN
        </button>
      </header>

      <div className="search">
        <input
          placeholder="Search by player name"
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
          onKeyDown={(e) => e.key === "Enter" && run(() => loadGames(search, 0))}
          disabled={!isOpen}
        />
        <button onClick={() => run(() => loadGames(search, 0))} disabled={!isOpen}>
          Search
        </button>
      </div>

      <div className="panes">
        <section
          className="games"
          onScroll={(e) => {
            const list = e.currentTarget;
            if (list.scrollTop + list.clientHeight >= list.scrollHeight - 200) loadMore();
          }}
        >
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
                  className={gameId === g.id ? "active" : ""}
                  onClick={() => select(g.id)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setMenu({
                      x: e.clientX,
                      y: e.clientY,
                      items: [
                        { label: "Open game", action: () => select(g.id) },
                        { label: "Delete game…", action: () => deleteGame(g) },
                      ],
                    });
                  }}
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
          {isOpen && games.length > 0 && (
            <p className="muted list-end">
              {hasMore ? (
                <button onClick={loadMore} disabled={loadingMore}>
                  {loadingMore ? "Loading…" : `Showing ${games.length} games, load more`}
                </button>
              ) : (
                `${games.length} ${games.length === 1 ? "game" : "games"}`
              )}
            </p>
          )}
        </section>

        <section className="game">
          {tree && current ? (
            <>
              <div className="headers">
                {HEADER_FIELDS.map((name) => (
                  <label key={name}>
                    {name}
                    <input value={tree.headers.get(name) ?? ""} onChange={(e) => setHeader(name, e.currentTarget.value)} />
                  </label>
                ))}
                <label>
                  Result
                  <select value={tree.headers.get("Result") ?? "*"} onChange={(e) => setHeader("Result", e.currentTarget.value)}>
                    {RESULTS.map((r) => (
                      <option key={r}>{r}</option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="gameview">
                <div className="boardcol">
                  <Board fen={fen} revision={revision} onMove={onBoardMove} />
                  <div className="controls">
                    <button onClick={() => setCurrent(tree.root)} disabled={!current.parent}>
                      |&lt;
                    </button>
                    <button onClick={() => current.parent && setCurrent(current.parent)} disabled={!current.parent}>
                      &lt;
                    </button>
                    <button onClick={() => setCurrent(current.children[0])} disabled={!current.children[0]}>
                      &gt;
                    </button>
                    <button
                      onClick={() => {
                        let n = current;
                        while (n.children[0]) n = n.children[0];
                        setCurrent(n);
                      }}
                      disabled={!current.children[0]}
                    >
                      &gt;|
                    </button>
                  </div>
                </div>
                <div className="sidecol">
                  <Notation root={tree.root} current={current} onSelect={setCurrent} onMenu={openMenu} />
                  <div className="actions">
                    <button onClick={save} disabled={!dirty}>
                      {gameId === null ? "Save as new game" : "Save"}
                    </button>
                    <button onClick={undo} disabled={gameId === null}>
                      Undo last save
                    </button>
                    <button
                      onClick={() => {
                        if (gameId === null) return;
                        const header = (name: string) => tree.headers.get(name) ?? "?";
                        deleteGame({
                          id: gameId,
                          white: header("White"),
                          black: header("Black"),
                          date: header("Date"),
                          event: header("Event"),
                          result: header("Result"),
                        });
                      }}
                      disabled={gameId === null}
                    >
                      Delete game
                    </button>
                    {dirty && <span className="muted">Unsaved changes</span>}
                  </div>
                  <EnginePanel fen={fen} />
                  <ExplorerPanel
                    fen={fen}
                    onPlay={(uci) => {
                      const move = parseUci(uci);
                      if (move) play(move);
                    }}
                  />
                </div>
              </div>
              <details className="source">
                <summary>PGN source</summary>
                <textarea value={draft} onChange={(e) => setDraft(e.currentTarget.value)} spellCheck={false} />
                <p className="muted">Edits here are saved as typed; moves made on the board replace them.</p>
              </details>
            </>
          ) : isOpen ? (
            <p className="muted">Select a game, or start a new one.</p>
          ) : (
            <div className="welcome">
              <h2>Recent files</h2>
              {recent.length === 0 && <p className="muted">Files you open will be listed here.</p>}
              {recent.map((f) => (
                <button key={f.path} className="recent" onClick={() => openDatabase(f.path)} title={f.path}>
                  <span className="name">{fileName(f.path)}</span>
                  <span className="where">{f.path}</span>
                  <span className="when">{new Date(f.openedAt).toLocaleString()}</span>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>

      <footer className="status">{status}</footer>
      {ask && <Dialog ask={ask} />}
      {menu && <ContextMenu {...menu} close={() => setMenu(null)} />}
    </div>
  );
}

export default App;
