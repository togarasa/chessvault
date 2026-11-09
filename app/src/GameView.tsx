import { useEffect } from "react";
import { parseUci } from "chessops/util";
import { Board } from "./Board";
import { EnginePanel } from "./EnginePanel";
import { EvalBar } from "./EvalBar";
import { ExplorerPanel } from "./ExplorerPanel";
import { Notation } from "./Notation";
import { HEADER_FIELDS, RESULTS } from "./pgn";
import { MoveNode } from "./tree";
import { useEngine } from "./useEngine";
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
  const engine = useEngine(fen);
  // Without a game there is no panel to stop the engine from, so it must not keep running.
  const shown = tree !== null;
  useEffect(() => {
    if (!shown && engine.running) void engine.toggle();
  }, [shown, engine.running]);
  if (!tree || !current) return <p className="muted">Select a game, or start a new one.</p>;
  const best = engine.running ? engine.lines[0] : undefined;

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
          <div className="board-row">
            <EvalBar score={best?.fen === fen ? best.score : null} orientation={editor.orientation} />
            <Board fen={fen} revision={editor.revision} orientation={editor.orientation} onMove={editor.boardMove} />
          </div>
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
            <button onClick={editor.flip} title="Flip the board (F)" aria-label="Flip board">
              ⇅
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
          <EnginePanel
            engine={engine}
            onPlay={(line, through) => editor.playLine(line.moves.slice(0, through + 1))}
          />
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
        <p className="muted">
          Typed edits are saved as they are, unless you then change the game another way (a move, a deletion, a
          comment, a symbol or a field above), which writes this text again from the board.
        </p>
      </details>
    </>
  );
}
