import { parseUci } from "chessops/util";
import { Board } from "./Board";
import { EnginePanel } from "./EnginePanel";
import { ExplorerPanel } from "./ExplorerPanel";
import { Notation } from "./Notation";
import { HEADER_FIELDS, RESULTS } from "./pgn";
import { MoveNode } from "./tree";
import { GameEditor } from "./useGameEditor";

type Props = {
  editor: GameEditor;
  onSave: () => void;
  onUndo: () => void;
  onDelete: () => void;
  onMoveMenu: (node: MoveNode, x: number, y: number) => void;
};

/// The game on the board: its headers, the board, the notation, the engine and the explorer.
export function GameView({ editor, onSave, onUndo, onDelete, onMoveMenu }: Props) {
  const { tree, current, gameId, dirty, fen } = editor;
  if (!tree || !current) return <p className="muted">Select a game, or start a new one.</p>;

  return (
    <>
      <div className="headers">
        {HEADER_FIELDS.map((name) => (
          <label key={name}>
            {name}
            <input value={tree.headers.get(name) ?? ""} onChange={(e) => editor.setHeader(name, e.currentTarget.value)} />
          </label>
        ))}
        <label>
          Result
          <select value={tree.headers.get("Result") ?? "*"} onChange={(e) => editor.setHeader("Result", e.currentTarget.value)}>
            {RESULTS.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="gameview">
        <div className="boardcol">
          <Board fen={fen} revision={editor.revision} onMove={editor.boardMove} />
          <div className="controls">
            <button onClick={() => editor.setCurrent(tree.root)} disabled={!current.parent}>
              |&lt;
            </button>
            <button onClick={() => current.parent && editor.setCurrent(current.parent)} disabled={!current.parent}>
              &lt;
            </button>
            <button onClick={() => editor.setCurrent(current.children[0])} disabled={!current.children[0]}>
              &gt;
            </button>
            <button onClick={editor.toEnd} disabled={!current.children[0]}>
              &gt;|
            </button>
          </div>
        </div>
        <div className="sidecol">
          <Notation root={tree.root} current={current} onSelect={editor.setCurrent} onMenu={onMoveMenu} />
          <div className="actions">
            <button onClick={onSave} disabled={!dirty}>
              {gameId === null ? "Save as new game" : "Save"}
            </button>
            <button onClick={onUndo} disabled={gameId === null}>
              Undo last save
            </button>
            <button onClick={onDelete} disabled={gameId === null}>
              Delete game
            </button>
            {dirty && <span className="muted">Unsaved changes</span>}
          </div>
          <EnginePanel fen={fen} />
          <ExplorerPanel
            fen={fen}
            onPlay={(uci) => {
              const move = parseUci(uci);
              if (move) editor.play(move);
            }}
          />
        </div>
      </div>
      <details className="source">
        <summary>PGN source</summary>
        <textarea value={editor.draft} onChange={(e) => editor.setDraft(e.currentTarget.value)} spellCheck={false} />
        <p className="muted">Edits here are saved as typed; moves made on the board replace them.</p>
      </details>
    </>
  );
}
