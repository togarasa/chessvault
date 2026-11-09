import { useEffect, useRef, useState } from "react";
import * as api from "./api";
import { largeConversionQuestion } from "./conversion";
import { ConversionDialog } from "./ConversionDialog";
import { ContextMenu, Dialog } from "./Dialog";
import { DatabaseTiles } from "./DatabaseTiles";
import { EMPTY_FILTER, isEmptyFilter, playerFilter } from "./filter";
import { GameList } from "./GameList";
import { GameView } from "./GameView";
import { HEADER_FIELDS, RESULTS, formValue, headerValue, newGamePgn } from "./pgn";
import { addRecent, clearRecent, fileName, folderOf, loadMyGames, loadRecent, removeRecent, saveMyGames } from "./recent";
import { SearchBar } from "./SearchBar";
import { SearchDialog } from "./Search";
import { Toolbar } from "./Toolbar";
import { writeGame } from "./tree";
import { GameSummary, OpenResult } from "./types";
import { useConversion } from "./useConversion";
import { useDialogs } from "./useDialogs";
import { useFileCounts } from "./useFileCounts";
import { useGameEditor } from "./useGameEditor";
import { useGameList } from "./useGameList";
import "./App.css";

const THIS_DATABASE = "This database";
const EXISTING_FILE = "An existing PGN file or database…";
const NEW_FILE = "A new PGN file or database…";

/// The status bar's report on a file that was opened.
function openedText({ database, games, imported, skipped }: OpenResult) {
  const left = skipped > 0 ? ` ${skipped} games were left out: damaged, or with null moves or Chess960.` : "";
  const done = imported > 0 ? `Imported ${imported} games into ${database}.` : `Opened ${database} (${games} games).`;
  return done + left;
}

/// The window: the database tiles, or an open database's game list and the game on the board.
/// It ties the parts together and runs the file operations; the parts hold their own state.
function App() {
  /// The open file as the user chose it (a .pgn file or a database).
  const [dbPath, setDbPath] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [status, setStatus] = useState("Open a database to begin.");
  const [recent, setRecent] = useState(loadRecent);
  const [myGames, setMyGames] = useState(loadMyGames);
  const [searchText, setSearchText] = useState("");
  const [searchWindow, setSearchWindow] = useState(false);

  const dialogs = useDialogs();
  const conversion = useConversion();
  const list = useGameList(run);
  const saving = useRef(false);
  const editor = useGameEditor({
    ...dialogs,
    // The game's keys don't reach a game hidden behind the search window or a conversion.
    busy: dialogs.busy || searchWindow || conversion.progress !== null,
    onSave: async () => {
      // A second Ctrl+S during a save would store the same game twice, making an empty undo step.
      if (!editor.dirty || saving.current) return;
      saving.current = true;
      try {
        await saveGame();
      } finally {
        saving.current = false;
      }
    },
  });
  const counts = useFileCounts(!isOpen, [...(myGames ? [myGames] : []), ...recent.map((f) => f.path)]);
  const { askUser } = dialogs;

  /// Runs `action`, showing a failure in the status bar.
  async function run(action: () => Promise<void>) {
    try {
      await action();
    } catch (error) {
      setStatus(String(error));
    }
  }

  // Closing the window asks about unsaved changes like every other way of leaving a game. The
  // listener is set up once and always runs the newest version of the handler.
  const onClose = useRef(async () => {});
  const closeAfterConversion = useRef(false);
  const opening = useRef(false);
  onClose.current = async () => {
    // A conversion is stopped first, so that it can clean up; openFile then closes the window.
    if (conversion.running.current) {
      closeAfterConversion.current = true;
      await conversion.cancel();
    } else if (await confirmDiscard()) {
      await api.closeWindow();
    }
  };
  useEffect(() => api.onCloseRequested(() => void onClose.current()), []);

  /// Asks before throwing away unsaved changes. Returns whether to go on.
  async function confirmDiscard() {
    if (!editor.dirty) return true;
    const answer = await askUser({
      title: "The game on the board has unsaved changes.",
      choices: [{ label: "Discard changes", value: "discard" }],
    });
    return answer === "discard";
  }

  // Files and databases.

  /// Opens a database or PGN file, asking which one when `path` is not given. With `create`, a
  /// database that doesn't exist yet is created; otherwise a missing file is an error.
  async function openFile(path?: string, create = false) {
    // Keys and clicks can reach the tiles while a file opens; two conversions must not run at once.
    if (opening.current) return;
    opening.current = true;
    try {
      await chooseAndOpen(path, create);
    } finally {
      opening.current = false;
    }
  }

  async function chooseAndOpen(path?: string, create = false) {
    if (!(await confirmDiscard())) return;
    const chosen =
      path ??
      (await api.chooseFileToOpen(
        "Open a game file",
        [api.OPENABLE_FILES, api.PGN_FILES, api.DATABASE_FILES, api.CBH_FILES],
        folderOf(dbPath),
      ));
    if (chosen === null || !(await confirmConversion(chosen))) return;
    let opened: Awaited<ReturnType<typeof api.openDatabase>>;
    conversion.begin();
    try {
      opened = await (create ? api.createDatabase(chosen) : api.openDatabase(chosen));
    } catch (error) {
      conversion.end();
      if (closeAfterConversion.current) return api.closeWindow();
      if (error === api.CANCELLED) {
        setStatus(`Stopped converting ${fileName(chosen)}.`);
        return;
      }
      setStatus(String(error));
      await offerToForget(chosen, error);
      return;
    }
    conversion.end();
    // The conversion had just finished when the window was closed; there is nothing to clean up.
    if (closeAfterConversion.current) return api.closeWindow();
    setDbPath(chosen);
    setRecent(addRecent(chosen));
    await run(async () => {
      setIsOpen(true);
      editor.show(null, null);
      setStatus(openedText(opened));
      setSearchText("");
      await list.showNewDatabase();
    });
  }

  /// Asks before a conversion that takes long and makes a large file. Returns whether to go on.
  async function confirmConversion(path: string) {
    const games = await api.gamesToConvert(path);
    const question = games === null ? null : largeConversionQuestion(games);
    if (question === null) return true;
    return (await askUser({ title: question, choices: [{ label: "Convert", value: "convert" }] })) === "convert";
  }

  /// After a recent file failed to open, offers to take it off the list.
  async function offerToForget(path: string, error: unknown) {
    if (!recent.some((f) => f.path === path)) return;
    const answer = await askUser({
      title: `${fileName(path)} could not be opened: ${error}`,
      choices: [{ label: "Remove from recent files", value: "remove" }],
    });
    if (answer === "remove") setRecent(removeRecent(path));
  }

  /// Goes back to the database tiles.
  async function showDatabases() {
    if (!(await confirmDiscard())) return;
    editor.show(null, null);
    setIsOpen(false);
    setStatus("Double-click a database to open it.");
  }

  /// Opens My Games, asking where to create it the first time or when `choose` is set.
  async function openMyGames(choose = false) {
    if (myGames && !choose) return openFile(myGames);
    const path = await api.chooseFileToSave("Where to keep My Games", [api.DATABASE_FILES], myGames ?? "My Games.sqlite");
    if (!path) return;
    saveMyGames(path);
    setMyGames(path);
    await openFile(path, true);
  }

  function forgetFile(path: string, isMyGames: boolean) {
    // Only the list forgets the file; it stays on disk.
    setRecent(removeRecent(path));
    if (isMyGames) {
      saveMyGames(null);
      setMyGames(null);
    }
  }

  function tileMenu(path: string, isMyGames: boolean, x: number, y: number) {
    dialogs.openMenu({
      x,
      y,
      items: [
        { label: "Open", action: () => (isMyGames ? openMyGames() : openFile(path)) },
        { label: "Show in folder", action: () => run(() => api.showInFolder(path)) },
        "separator",
        ...(isMyGames ? [{ label: "Choose another My Games database…", action: () => openMyGames(true) }] : []),
        { label: "Remove from list", action: () => forgetFile(path, isMyGames) },
      ],
    });
  }

  function recentMenu(x: number, y: number) {
    dialogs.openMenu({
      x,
      y,
      items: [
        ...recent.map((f) => ({ label: fileName(f.path), action: () => openFile(f.path) })),
        "separator" as const,
        { label: "Clear list", action: () => setRecent(clearRecent()) },
      ],
    });
  }

  /// Adds the games of a PGN file to the open database.
  async function importPgn() {
    const path = await api.chooseFileToOpen("Import the games of a PGN file", [api.PGN_FILES], folderOf(dbPath));
    if (path === null) return;
    await run(async () => {
      const imported = await api.importPgn(path);
      setStatus(`Imported ${imported} games.`);
      await list.reload();
    });
  }

  /// Writes all games, or the game on the board, to a PGN file that ChessBase and other programs can open.
  async function exportPgn() {
    const shownId = editor.gameId;
    let onlyShown = false;
    if (shownId !== null) {
      const answer = await askUser({
        title: "Export to PGN",
        choices: [
          { label: "All games", value: "all" },
          { label: "Game on the board", value: "shown" },
        ],
      });
      if (!answer) return;
      onlyShown = answer === "shown";
    }
    const path = await api.chooseFileToSave("Export to PGN", [api.PGN_FILES], `${dbPath.replace(/\.(pgn|sqlite|cbh|cbv)$/i, "")} (ChessVault).pgn`);
    if (!path) return;
    if (editor.dirty) {
      const answer = await askUser({
        title: "The game on the board has unsaved changes. The export has the last saved version.",
        choices: [{ label: "Export anyway", value: "go" }],
      });
      if (answer !== "go") return;
    }
    await run(async () => {
      const written = await api.exportPgn(path, onlyShown && shownId !== null ? [shownId] : null);
      setStatus(`Exported ${written} ${written === 1 ? "game" : "games"} to ${path}.`);
    });
  }

  // Games.

  async function selectGame(id: number) {
    if (id === editor.gameId || !(await confirmDiscard())) return;
    await run(async () => {
      const game = await api.getGame(id);
      editor.show(id, game?.pgn ?? null);
    });
  }

  async function newGame() {
    if (!(await confirmDiscard())) return;
    editor.show(null, newGamePgn(new Date()));
    setStatus("New game. Make moves on the board, then save it.");
  }

  /// Loads a game again after it was saved, staying on the shown move.
  async function reloadGame(id: number) {
    const path = editor.currentPath();
    const game = await api.getGame(id);
    editor.show(id, game?.pgn ?? null, path);
    await list.reload();
  }

  async function saveGame() {
    const { tree, gameId } = editor;
    if (!tree) return;
    await run(async () => {
      if (gameId !== null) {
        await api.saveGame(gameId, editor.draft);
        setStatus(`Saved game ${gameId}. Undo restores the previous version.`);
        await reloadGame(gameId);
        return;
      }
      const target = await askNewGameDetails();
      if (target === null) return;
      const pgn = writeGame(tree);
      if (target === THIS_DATABASE) {
        const id = await api.addGame(pgn);
        setStatus(`Added game ${id}.`);
        await reloadGame(id);
        return;
      }
      await api.addGameTo(target.path, pgn, target.replace);
      editor.markSaved(pgn);
      setRecent(addRecent(target.path));
      setStatus(`Saved the game to ${target.path}.`);
      await list.reload();
    });
  }

  /// Asks for the players and event of a new game and puts them in its headers, then where to save it.
  /// Returns THIS_DATABASE, another file (to replace when it is a new file the user chose to replace),
  /// or null when cancelled.
  async function askNewGameDetails(): Promise<typeof THIS_DATABASE | { path: string; replace: boolean } | null> {
    const { tree } = editor;
    if (!tree) return null;
    const fields = await dialogs.askFields("Save as new game", [
      ...HEADER_FIELDS.map((name) => ({ name, value: formValue(tree.headers.get(name)) })),
      { name: "Result", value: tree.headers.get("Result") ?? "*", options: RESULTS },
      {
        name: "Save to",
        value: THIS_DATABASE,
        options: [THIS_DATABASE, EXISTING_FILE, NEW_FILE],
        hint: "A PGN file gets the game added at the end; a new PGN file holds only this game.",
      },
    ]);
    if (!fields) return null;
    for (const name of [...HEADER_FIELDS, "Result"]) tree.headers.set(name, headerValue(fields[name]));
    editor.changed();
    if (fields["Save to"] === THIS_DATABASE) return THIS_DATABASE;
    if (fields["Save to"] === EXISTING_FILE) {
      const path = await api.chooseFileToOpen("Add the game to", [api.GAME_FILES, api.PGN_FILES, api.DATABASE_FILES], folderOf(dbPath));
      return path === null ? null : { path, replace: false };
    }
    // Windows' save window has already asked before replacing an existing file.
    const path = await api.chooseFileToSave(
      "Save the game as",
      [api.PGN_FILES, api.DATABASE_FILES],
      `${folderOf(dbPath)}${tree.headers.get("White")} - ${tree.headers.get("Black")}.pgn`,
    );
    return path === null ? null : { path, replace: true };
  }

  async function undoSave() {
    const id = editor.gameId;
    if (id === null || !(await confirmDiscard())) return;
    await run(async () => {
      if (!(await api.undoGame(id))) {
        setStatus(`Game ${id} has no earlier version.`);
        return;
      }
      setStatus(`Restored game ${id}.`);
      await reloadGame(id);
    });
  }

  /// Deletes a game from the database after asking.
  async function deleteGame(game: Pick<GameSummary, "id" | "white" | "black" | "date">) {
    const answer = await askUser({
      title: `Delete game ${game.id}: ${game.white} – ${game.black} (${game.date})? This cannot be undone.`,
      choices: [{ label: "Delete game", value: "delete" }],
    });
    if (answer !== "delete") return;
    await run(async () => {
      await api.deleteGame(game.id);
      if (game.id === editor.gameId) editor.show(null, null);
      setStatus(`Deleted game ${game.id}.`);
      await list.reload();
    });
  }

  function deleteShownGame() {
    const { tree, gameId } = editor;
    if (!tree || gameId === null) return;
    const header = (name: string) => tree.headers.get(name) ?? "?";
    deleteGame({ id: gameId, white: header("White"), black: header("Black"), date: header("Date") });
  }

  function gameMenu(game: GameSummary, x: number, y: number) {
    dialogs.openMenu({
      x,
      y,
      items: [
        { label: "Open game", action: () => selectGame(game.id) },
        { label: "Delete game…", action: () => deleteGame(game) },
      ],
    });
  }

  function quickSearch() {
    const name = searchText.trim();
    list.applyFilter(name ? playerFilter(name) : null);
  }

  return (
    <div className="app">
      <Toolbar
        isOpen={isOpen}
        dbPath={dbPath}
        hasRecent={recent.length > 0}
        onDatabases={showDatabases}
        onOpen={() => openFile()}
        onRecent={recentMenu}
        onImport={importPgn}
        onNewGame={newGame}
        onExport={exportPgn}
      />

      {isOpen ? (
        <>
          <SearchBar
            text={searchText}
            onText={setSearchText}
            onSearch={quickSearch}
            onSearchWindow={() => setSearchWindow(true)}
            filter={list.filter}
            onShowAll={() => {
              setSearchText("");
              list.applyFilter(null);
            }}
          />
          <div className="panes">
            <GameList
              games={list.games}
              order={list.order}
              selectedId={editor.gameId}
              hasMore={list.hasMore}
              loadingMore={list.loadingMore}
              onSort={list.sortBy}
              onSelect={selectGame}
              onMenu={gameMenu}
              onLoadMore={list.loadMore}
            />
            <section className="game">
              <GameView
                editor={editor}
                onSave={saveGame}
                onUndo={undoSave}
                onDelete={deleteShownGame}
                onMoveMenu={(node, x, y) => dialogs.openMenu({ x, y, items: editor.moveMenu(node) })}
              />
            </section>
          </div>
        </>
      ) : (
        <DatabaseTiles
          files={recent}
          myGames={myGames}
          counts={counts}
          onOpen={(path) => openFile(path)}
          onMyGames={() => openMyGames()}
          onAdd={() => openFile()}
          onMenu={tileMenu}
        />
      )}

      <footer className="status">{status}</footer>
      {dialogs.ask && <Dialog ask={dialogs.ask} />}
      {conversion.progress && <ConversionDialog progress={conversion.progress} cancelling={conversion.cancelling} onCancel={conversion.cancel} />}
      {searchWindow && (
        <SearchDialog
          initial={list.filter ?? EMPTY_FILTER}
          onClose={() => setSearchWindow(false)}
          onSearch={(find) => {
            setSearchWindow(false);
            setSearchText("");
            list.applyFilter(isEmptyFilter(find) ? null : find);
          }}
        />
      )}
      {dialogs.menu && <ContextMenu {...dialogs.menu} close={dialogs.closeMenu} />}
    </div>
  );
}

export default App;
