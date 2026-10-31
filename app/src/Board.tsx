import { useEffect, useRef } from "react";
import { Chessground } from "chessground";
import { Key } from "chessground/types";
import { Chess } from "chessops/chess";
import { chessgroundDests } from "chessops/compat";
import { parseFen } from "chessops/fen";
import "chessground/assets/chessground.base.css";
import "chessground/assets/chessground.brown.css";
import "chessground/assets/chessground.cburnett.css";

type Props = {
  fen: string;
  /// Changes whenever the board must be redrawn from `fen`, e.g. after a move was cancelled.
  revision: number;
  onMove: (from: Key, to: Key) => void;
};

/// A chessboard showing `fen` that lets the side to move play legal moves.
export function Board({ fen, revision, onMove }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const board = useRef<ReturnType<typeof Chessground> | null>(null);
  const moveHandler = useRef(onMove);
  moveHandler.current = onMove;

  useEffect(() => {
    if (!container.current) return;
    board.current = Chessground(container.current, {
      coordinates: true,
      movable: { free: false, showDests: true, events: { after: (from, to) => moveHandler.current(from, to) } },
    });
    return () => {
      board.current?.destroy();
      board.current = null;
    };
  }, []);

  useEffect(() => {
    const pos = Chess.fromSetup(parseFen(fen).unwrap());
    if (pos.isErr) {
      board.current?.set({ fen, movable: { color: undefined, dests: new Map() } });
      return;
    }
    const turn = pos.value.turn;
    board.current?.set({
      fen,
      turnColor: turn,
      check: pos.value.isCheck() ? turn : false,
      lastMove: undefined,
      movable: { color: turn, dests: chessgroundDests(pos.value) },
    });
  }, [fen, revision]);

  return <div ref={container} className="board" />;
}
