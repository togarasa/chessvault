import { ReactNode, useEffect, useRef } from "react";
import { MoveNode, nagText } from "./tree";

type Props = {
  root: MoveNode;
  current: MoveNode;
  onSelect: (node: MoveNode) => void;
  onMenu: (node: MoveNode, x: number, y: number) => void;
};

/// The moves of a game with their variations, comments and symbols.
/// Variations of the main line get their own indented paragraph; deeper ones stay inline.
export function Notation({ root, current, onSelect, onMenu }: Props) {
  const active = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    active.current?.scrollIntoView({ block: "nearest" });
  }, [current]);

  function move(node: MoveNode, withNumber: boolean) {
    const white = node.ply % 2 === 1;
    const number = Math.ceil(node.ply / 2);
    return (
      <span
        key={node.id}
        ref={node === current ? active : undefined}
        className={node === current ? "move active" : "move"}
        onClick={() => onSelect(node)}
        onContextMenu={(e) => {
          e.preventDefault();
          onSelect(node);
          onMenu(node, e.clientX, e.clientY);
        }}
      >
        {white ? `${number}. ` : withNumber ? `${number}... ` : ""}
        {node.san}
        {node.nags.map(nagText).join("")}
      </span>
    );
  }

  function line(start: MoveNode, depth: number): ReactNode[] {
    const out: ReactNode[] = [];
    let withNumber = true;
    for (let node: MoveNode | undefined = start; node; node = node.children[0]) {
      for (const [i, comment] of node.startingComments.entries()) {
        out.push(
          <span key={`${node.id}s${i}`} className="comment">
            {comment}
          </span>,
        );
        withNumber = true;
      }
      out.push(move(node, withNumber));
      withNumber = false;
      for (const [i, comment] of node.comments.entries()) {
        out.push(
          <span key={`${node.id}c${i}`} className="comment">
            {comment}
          </span>,
        );
        withNumber = true;
      }
      const parent: MoveNode | null = node.parent;
      if (parent && parent.children[0] === node && parent.children.length > 1) {
        for (const variation of parent.children.slice(1)) {
          out.push(
            <span key={`v${variation.id}`} className={depth === 0 ? "variation block" : "variation"}>
              {line(variation, depth + 1)}
            </span>,
          );
        }
        withNumber = true;
      }
    }
    return out;
  }

  return (
    <div className="notation" onContextMenu={(e) => e.preventDefault()}>
      <span className={current === root ? "move active start" : "move start"} onClick={() => onSelect(root)}>
        Start
      </span>
      {root.comments.map((c, i) => (
        <span key={`root${i}`} className="comment">
          {c}
        </span>
      ))}
      {root.children[0] ? line(root.children[0], 0) : <span className="muted"> Make a move on the board.</span>}
    </div>
  );
}
