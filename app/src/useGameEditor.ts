import { useEffect, useMemo, useState } from "react";
import { Key } from "chessground/types";
import { Move, NormalMove, Role, SquareName } from "chessops/types";
import { parseSquare, squareRank } from "chessops/util";
import { MenuItem } from "./Dialog";
import { Dialogs } from "./useDialogs";
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

export const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

/// The last move of the line that `node` is on.
function lineEnd(node: MoveNode): MoveNode {
  let end = node;
  while (end.children[0]) end = end.children[0];
  return end;
}

/// The game on the board: its moves, the shown position, unsaved changes and editing.
export function useGameEditor({ askUser, busy }: Pick<Dialogs, "askUser" | "busy">) {
  /// The game's id, or null until a new game is saved.
  const [gameId, setGameId] = useState<number | null>(null);
  const [tree, setTree] = useState<GameTree | null>(null);
  const [current, setCurrent] = useState<MoveNode | null>(null);
  /// Bumped on every change to the tree, which is edited in place, and to put back a cancelled move.
  const [revision, setRevision] = useState(0);
  /// The PGN as last loaded or saved, to tell whether there are unsaved changes.
  const [savedPgn, setSavedPgn] = useState("");
  /// The PGN source text; moves made on the board replace it.
  const [draft, setDraft] = useState("");

  const treePgn = useMemo(() => (tree ? writeGame(tree) : ""), [tree, revision]);
  const dirty = tree !== null && (treePgn !== savedPgn || draft !== treePgn);

  // Arrow keys, Home and End step through the moves, unless the user is typing or a dialog is open.
  useEffect(() => {
    if (!current || busy) return;
    const node = current;
    function onKey(e: KeyboardEvent) {
      const t = e.target;
      if (t instanceof HTMLTextAreaElement || t instanceof HTMLInputElement || t instanceof HTMLSelectElement) return;
      const next = {
        ArrowRight: node.children[0],
        ArrowLeft: node.parent,
        Home: tree?.root,
        End: lineEnd(node),
      }[e.key];
      if (next) {
        e.preventDefault();
        setCurrent(next);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, busy, tree]);

  /// Puts a game on the board at the move `path` leads to, or clears the board when `pgn` is null.
  function show(id: number | null, pgn: string | null, path: number[] = []) {
    const parsed = pgn === null ? null : parseGame(pgn);
    const written = parsed ? writeGame(parsed) : "";
    setGameId(id);
    setTree(parsed);
    setCurrent(parsed ? nodeAt(parsed.root, path) : null);
    setSavedPgn(written);
    setDraft(written);
  }

  /// Call after editing the tree in place.
  function changed() {
    setRevision((r) => r + 1);
    if (tree) setDraft(writeGame(tree));
  }

  /// Marks `pgn` as saved somewhere else, so the board has no unsaved changes.
  function markSaved(pgn: string) {
    setSavedPgn(pgn);
    setDraft(pgn);
  }

  /// Redraws the board from the shown position, e.g. after a move was cancelled.
  function putBack() {
    setRevision((r) => r + 1);
  }

  /// Plays `move` from the shown position, asking how to add it when the position already has a continuation.
  async function play(move: Move) {
    if (!current) return;
    const reached = childFor(current, move);
    // Not legal here, e.g. from an explorer table that still showed another position.
    if (!reached) return putBack();
    const { node, existing } = reached;
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
      if (!answer) return putBack();
      mode = answer as AddMode;
    }
    addMove(current, node, mode);
    setCurrent(node);
    changed();
  }

  /// A move made on the board, asking for the piece when a pawn promotes.
  async function boardMove(from: Key, to: Key) {
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
      if (!role) return putBack();
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

  /// The right-click menu for a move in the notation.
  function moveMenu(node: MoveNode): MenuItem[] {
    const inVariation = variationStart(node) !== null;
    const edit = (change: () => void) => () => {
      change();
      changed();
    };
    const symbolRow = (nags: [number, string][]): MenuItem => ({
      buttons: nags.map(([nag, label]) => ({
        label,
        active: node.nags.includes(nag),
        action: edit(() => toggleNag(node, nag)),
      })),
    });
    return [
      { label: node.comments.length ? "Edit comment…" : "Add comment…", action: () => editComment(node) },
      symbolRow(MOVE_NAGS),
      symbolRow(POSITION_NAGS),
      {
        label: "Remove comment and symbols",
        disabled: !node.comments.length && !node.startingComments.length && !node.nags.length,
        action: edit(() => {
          node.startingComments = [];
          node.comments = [];
          node.nags = [];
        }),
      },
      "separator",
      { label: "Promote variation", disabled: !inVariation, action: edit(() => promoteVariation(node)) },
      { label: "Delete variation", disabled: !inVariation, action: edit(() => setCurrent(deleteVariation(node))) },
      { label: "Delete moves from here", action: edit(() => setCurrent(deleteFrom(node))) },
    ];
  }

  function setHeader(name: string, value: string) {
    if (!tree) return;
    tree.headers.set(name, value);
    changed();
  }

  return {
    gameId,
    tree,
    current,
    revision,
    draft,
    dirty,
    fen: current?.fen ?? START_FEN,
    show,
    changed,
    markSaved,
    setCurrent,
    setDraft,
    setHeader,
    play,
    boardMove,
    moveMenu,
    toEnd: () => current && setCurrent(lineEnd(current)),
    /// The way back to the shown move after the game is read again.
    currentPath: () => (current ? pathTo(current) : []),
  };
}

export type GameEditor = ReturnType<typeof useGameEditor>;
