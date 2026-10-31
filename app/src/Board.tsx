import { useEffect, useRef } from "react";
import { Chessground } from "chessground";
import "chessground/assets/chessground.base.css";
import "chessground/assets/chessground.brown.css";
import "chessground/assets/chessground.cburnett.css";

type Props = { fen: string };

/// A read-only chessboard that shows the position in `fen`.
export function Board({ fen }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const board = useRef<ReturnType<typeof Chessground> | null>(null);

  useEffect(() => {
    if (!container.current) return;
    board.current = Chessground(container.current, { fen, viewOnly: true, coordinates: true });
    return () => {
      board.current?.destroy();
      board.current = null;
    };
  }, []);

  useEffect(() => {
    board.current?.set({ fen });
  }, [fen]);

  return <div ref={container} className="board" />;
}
