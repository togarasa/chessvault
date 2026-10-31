import { Chess, Position, normalizeMove } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import { ChildNode, Game, Node, PgnNodeData, makePgn, parsePgn, startingPosition } from "chessops/pgn";
import { makeSanAndPlay, parseSan } from "chessops/san";
import { Move } from "chessops/types";

/// One position in a game. The root has no move; every other node is reached by `san`.
export type MoveNode = {
  id: number;
  san: string;
  fen: string;
  /// Half-moves from the start of the game; the root has 0 unless the game starts from a FEN.
  ply: number;
  comments: string[];
  nags: number[];
  parent: MoveNode | null;
  /// The first child continues the line; the others are variations.
  children: MoveNode[];
};

export type GameTree = {
  headers: Map<string, string>;
  root: MoveNode;
};

let nextId = 1;

function newNode(parent: MoveNode | null, san: string, pos: Position, ply: number): MoveNode {
  return { id: nextId++, san, fen: makeFen(pos.toSetup()), ply, comments: [], nags: [], parent, children: [] };
}

/// Parses the first game in `pgn` with its variations, comments and symbols.
/// Moves that are not legal cut their line off.
export function parseGame(pgn: string): GameTree {
  // Some exports write brackets in tag values as `\[` and `\]`, which PGN doesn't allow
  // and which would make the parser lose the whole game.
  const cleaned = pgn.replace(/^\s*\[\w+\s+".*$/gm, (tag) => tag.replace(/\\([[\]])/g, "$1"));
  const game = parsePgn(cleaned)[0];
  if (!game) throw new Error("no game in the PGN");
  const expected = [...game.moves.mainline()].length;
  if (expected === 0 && /^\s*1\s*\./m.test(cleaned)) throw new Error("could not read the moves of this game");
  const start = startingPosition(game.headers).unwrap();
  const fullmoves = start.fullmoves;
  const root = newNode(null, "", start, (fullmoves - 1) * 2 + (start.turn === "black" ? 1 : 0));
  root.comments = game.comments ?? [];

  function build(from: Node<PgnNodeData>, into: MoveNode, pos: Position) {
    for (const child of from.children) {
      const move = parseSan(pos, child.data.san);
      if (!move) continue;
      const next = pos.clone();
      const san = makeSanAndPlay(next, move);
      const node = newNode(into, san, next, into.ply + 1);
      node.comments = [...(child.data.startingComments ?? []), ...(child.data.comments ?? [])];
      node.nags = child.data.nags ?? [];
      into.children.push(node);
      build(child, node, next);
    }
  }
  build(game.moves, root, start);
  let read = 0;
  for (let node = root; node.children[0]; node = node.children[0]) read++;
  if (read < expected) throw new Error(`move ${Math.floor((root.ply + read) / 2) + 1} of this game is not legal`);
  return { headers: game.headers, root };
}

/// Writes the game back to PGN, keeping its headers.
export function writeGame(tree: GameTree): string {
  const game: Game<PgnNodeData> = { headers: tree.headers, comments: tree.root.comments, moves: new Node() };
  function copy(from: MoveNode, into: Node<PgnNodeData>) {
    for (const child of from.children) {
      const node = new ChildNode<PgnNodeData>({
        san: child.san,
        comments: child.comments.length ? child.comments : undefined,
        nags: child.nags.length ? child.nags : undefined,
      });
      into.children.push(node);
      copy(child, node);
    }
  }
  copy(tree.root, game.moves);
  return makePgn(game);
}

/// The position at `node`. Its FEN was written by chessops, so it parses.
export function position(node: MoveNode): Position {
  return Chess.fromSetup(parseFen(node.fen).unwrap()).unwrap();
}

/// The child reached by `move`, or a new child for it that is not attached yet.
export function childFor(node: MoveNode, move: Move): { node: MoveNode; existing: boolean } {
  const pos = position(node);
  const san = makeSanAndPlay(pos, normalizeMove(pos, move));
  const existing = node.children.find((c) => c.san === san);
  if (existing) return { node: existing, existing: true };
  return { node: newNode(node, san, pos, node.ply + 1), existing: false };
}

/// How a new move joins a position that already has a continuation.
export type AddMode = "variation" | "overwrite" | "mainline";

export function addMove(parent: MoveNode, child: MoveNode, mode: AddMode) {
  if (mode === "variation") parent.children.push(child);
  else if (mode === "overwrite") parent.children[0] = child;
  else parent.children.unshift(child);
}

/// The first node of the variation that `node` belongs to: the node that is not its parent's first child.
/// Main-line nodes have none.
export function variationStart(node: MoveNode): MoveNode | null {
  for (let n: MoveNode | null = node; n?.parent; n = n.parent) {
    if (n.parent.children[0] !== n) return n;
  }
  return null;
}

/// Removes the variation that `node` is in. Returns the node to show afterwards.
export function deleteVariation(node: MoveNode): MoveNode | null {
  const start = variationStart(node);
  if (!start?.parent) return null;
  start.parent.children = start.parent.children.filter((c) => c !== start);
  return start.parent;
}

/// Removes `node` and every move after it in its line.
export function deleteFrom(node: MoveNode): MoveNode | null {
  if (!node.parent) return null;
  node.parent.children = node.parent.children.filter((c) => c !== node);
  return node.parent;
}

/// Moves the variation that `node` is in one place up, making it the main line when it is first.
export function promoteVariation(node: MoveNode) {
  const start = variationStart(node);
  if (!start?.parent) return;
  const siblings = start.parent.children;
  const i = siblings.indexOf(start);
  [siblings[i - 1], siblings[i]] = [siblings[i], siblings[i - 1]];
}

/// The symbols offered in the notation menu, by NAG number.
export const MOVE_NAGS: [number, string][] = [
  [1, "!"],
  [2, "?"],
  [3, "!!"],
  [4, "??"],
  [5, "!?"],
  [6, "?!"],
];

export const POSITION_NAGS: [number, string][] = [
  [10, "="],
  [13, "∞"],
  [14, "⩲"],
  [15, "⩱"],
  [16, "±"],
  [17, "∓"],
  [18, "+−"],
  [19, "−+"],
];

const NAG_TEXT = new Map([...MOVE_NAGS, ...POSITION_NAGS]);

export function nagText(nag: number): string {
  return NAG_TEXT.get(nag) ?? `$${nag}`;
}

/// Sets a move symbol (1–9) or a position symbol (10 and up), replacing one of the same kind.
/// Setting the symbol that is already there removes it.
export function toggleNag(node: MoveNode, nag: number) {
  const isMove = (n: number) => n < 10;
  const had = node.nags.includes(nag);
  node.nags = node.nags.filter((n) => isMove(n) !== isMove(nag));
  if (!had) node.nags.push(nag);
  node.nags.sort((a, b) => a - b);
}

/// The child indexes that lead from the root to `node`.
export function pathTo(node: MoveNode): number[] {
  const path: number[] = [];
  for (let n = node; n.parent; n = n.parent) path.unshift(n.parent.children.indexOf(n));
  return path;
}

/// The node at `path`, or the last one that still exists.
export function nodeAt(root: MoveNode, path: number[]): MoveNode {
  let node = root;
  for (const i of path) {
    if (!node.children[i]) break;
    node = node.children[i];
  }
  return node;
}
