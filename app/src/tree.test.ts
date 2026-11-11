import { parseUci } from "chessops/util";
import { describe, expect, it } from "vitest";
import {
  MoveNode,
  addMove,
  childFor,
  deleteFrom,
  deleteVariation,
  nagText,
  nodeAt,
  parseGame,
  pathTo,
  position,
  promoteVariation,
  toggleNag,
  variationStart,
  writeGame,
} from "./tree";

const movetext = (pgn: string) => pgn.split("\n\n")[1].trim();

/// Plays `uci` from `node`, adding it in `mode` when it is new, and returns the node reached.
function play(node: MoveNode, uci: string, mode: "variation" | "overwrite" | "mainline" = "mainline") {
  const { node: child, existing } = childFor(node, parseUci(uci)!)!;
  if (!existing) addMove(node, child, mode);
  return child;
}

/// The main line's moves from `node` on.
function line(node: MoveNode): string[] {
  const sans: string[] = [];
  for (let n = node.children[0]; n; n = n.children[0]) sans.push(n.san);
  return sans;
}

describe("parseGame and writeGame", () => {
  it("keeps moves, variations, comments and symbols through a round trip", () => {
    const pgn = '[Event "Club"]\n[White "A"]\n[Black "B"]\n[Result "1-0"]\n\n{ Intro } 1. e4 $1 { Best } ( 1. d4 d5 ) 1... e5 2. Nf3 1-0';
    const tree = parseGame(pgn);
    expect(tree.headers.get("White")).toBe("A");
    expect(tree.root.comments).toEqual(["Intro"]);
    expect(line(tree.root)).toEqual(["e4", "e5", "Nf3"]);
    expect(tree.root.children.map((c) => c.san)).toEqual(["e4", "d4"]);
    expect(tree.root.children[0].nags).toEqual([1]);
    expect(movetext(writeGame(tree))).toBe("{ Intro } 1. e4 $1 { Best } ( 1. d4 d5 ) 1... e5 2. Nf3 1-0");
    // Writing what was read gives the same text again.
    expect(writeGame(parseGame(writeGame(tree)))).toBe(writeGame(tree));
  });

  it("normalizes move text, e.g. missing check signs", () => {
    const tree = parseGame("1. e4 f5 2. Qh5 *");
    expect(line(tree.root)).toEqual(["e4", "f5", "Qh5+"]);
  });

  it("reads escaped brackets in tag values instead of losing the game", () => {
    const tree = parseGame('[White "Goetz, Andreas0 \\[66ER\\]"]\n\n1. d4 d5 *');
    expect(tree.headers.get("White")).toBe("Goetz, Andreas0 [66ER]");
    expect(line(tree.root)).toEqual(["d4", "d5"]);
  });

  it("reads names whose bracket backslashes were escaped again or cut short", () => {
    const twice = parseGame('[White "Vykouk, Jan1 \\\\[2000\\\\]"]\n\n1. e4 Nf6 *');
    expect(twice.headers.get("White")).toBe("Vykouk, Jan1 [2000]");
    expect(line(twice.root)).toEqual(["e4", "Nf6"]);

    const cut = parseGame('[White "A"]\n[Black "Simon, Martin1 \\\\[60Neumkt\\\\"]\n\n1. e4 *');
    expect(cut.headers.get("Black")).toBe("Simon, Martin1 [60Neumkt");
    expect(line(cut.root)).toEqual(["e4"]);

    const quote = parseGame('[White "O\\"Brien"]\n\n1. e4 *');
    expect(quote.headers.get("White")).toBe('O"Brien');
  });

  it("starts from the FEN tag with the right move numbers", () => {
    const fen = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";
    const tree = parseGame(`[FEN "${fen}"]\n[SetUp "1"]\n\n1... e5 2. Nf3 *`);
    expect(tree.root.ply).toBe(1);
    expect(tree.root.children[0].ply).toBe(2);
    expect(movetext(writeGame(tree))).toBe("1... e5 2. Nf3 *");
  });

  it("reads a game without moves", () => {
    const tree = parseGame('[Event "New"]\n\n*');
    expect(tree.root.children).toEqual([]);
  });

  it("refuses an illegal main-line move with its move number", () => {
    expect(() => parseGame("1. e4 e5 2. Ke3 *")).toThrow("move 2 of this game is not legal");
  });

  it("refuses text that has no game or whose moves can't be read", () => {
    expect(() => parseGame("")).toThrow();
    expect(() => parseGame('[White "\\"]\n1. ')).toThrow();
  });

  it("drops an illegal variation but keeps the main line", () => {
    const tree = parseGame("1. e4 ( 1. Ke2 ) 1... e5 *");
    expect(tree.root.children.map((c) => c.san)).toEqual(["e4"]);
    expect(line(tree.root)).toEqual(["e4", "e5"]);
  });
});

describe("null moves and Chess960", () => {
  const CHESS960 = "bbqrknrn/pppppppp/8/8/8/8/PPPPPPPP/BBQRKNRN w KQkq - 0 0";

  it("plays a null move as a pass, with the same position as the database", () => {
    const tree = parseGame("1. e4 -- 2. d4 e5 *");
    expect(line(tree.root)).toEqual(["e4", "--", "d4", "e5"]);
    const passed = tree.root.children[0].children[0];
    expect(passed.fen).toBe("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 1 2");
    expect(passed.ply).toBe(2);
    expect(childFor(passed, parseUci("d2d4")!)!.existing).toBe(true);
    expect(movetext(writeGame(tree))).toBe("1. e4 -- 2. d4 e5 *");
  });

  it("reads a null move in a variation and in its other spelling", () => {
    const tree = parseGame("1. e4 e5 (1... Z0 2. d4) 2. Nf3 *");
    expect(tree.root.children[0].children.map((c) => c.san)).toEqual(["e5", "--"]);
    expect(movetext(writeGame(tree))).toBe("1. e4 e5 ( 1... -- 2. d4 ) 2. Nf3 *");
  });

  it("keeps the move number when White passes, and gives up an en passant capture", () => {
    const white = parseGame("1. -- e5 *").root.children[0];
    expect(white.fen).toBe("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 1 1");
    expect(movetext(writeGame(parseGame("1. -- e5 *")))).toBe("1. -- e5 *");
    const tree = parseGame("1. e4 Nf6 2. e5 d5 3. -- *");
    expect(nodeAt(tree.root, [0, 0, 0, 0, 0]).fen).toBe("rnbqkb1r/ppp1pppp/5n2/3pP3/8/8/PPPP1PPP/RNBQKBNR b KQkq - 1 3");
  });

  it("refuses a null move in check", () => {
    expect(() => parseGame("1. e4 f5 2. Qh5+ -- *")).toThrow("move 2 of this game is not legal");
  });

  it("starts a Chess960 game from its position and castles with its own rooks", () => {
    const tree = parseGame(`[SetUp "1"]
[FEN "${CHESS960}"]

1. Ne3 Ne6 2. O-O O-O *`);
    expect(tree.root.ply).toBe(0);
    expect(line(tree.root)).toEqual(["Ne3", "Ne6", "O-O", "O-O"]);
    const beforeCastling = tree.root.children[0].children[0];
    expect(childFor(beforeCastling, parseUci("e1g1")!)).toEqual({ node: beforeCastling.children[0], existing: true });
    expect(nodeAt(tree.root, [0, 0, 0, 0]).fen).toBe("bbqr1rkn/pppppppp/4n3/8/8/4N3/PPPPPPPP/BBQR1RKN w - - 4 3");
  });
});

describe("childFor and addMove", () => {
  it("follows a move that exists and makes a node for a new one", () => {
    const tree = parseGame("1. e4 e5 *");
    expect(childFor(tree.root, parseUci("e2e4")!)).toEqual({ node: tree.root.children[0], existing: true });
    const { node, existing } = childFor(tree.root, parseUci("d2d4")!)!;
    expect(existing).toBe(false);
    expect([node.san, node.ply, node.parent]).toEqual(["d4", 1, tree.root]);
    expect(tree.root.children).toHaveLength(1);
  });

  it("accepts castling as the king's two-square move or as king takes rook", () => {
    const tree = parseGame("1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 *");
    let end = tree.root;
    while (end.children[0]) end = end.children[0];
    expect(childFor(end, parseUci("e1g1")!)!.node.san).toBe("O-O");
    expect(childFor(end, parseUci("e1h1")!)!.node.san).toBe("O-O");
  });

  it("adds a promotion with the chosen piece", () => {
    const tree = parseGame('[FEN "8/P7/8/8/8/8/8/k6K w - - 0 1"]\n[SetUp "1"]\n\n*');
    expect(childFor(tree.root, parseUci("a7a8n")!)!.node.san).toBe("a8=N");
  });

  it("adds a new move as a variation, a new main line, or over the old continuation", () => {
    const tree = parseGame("1. e4 e5 *");
    play(tree.root, "d2d4", "variation");
    expect(tree.root.children.map((c) => c.san)).toEqual(["e4", "d4"]);
    play(tree.root, "c2c4", "mainline");
    expect(tree.root.children.map((c) => c.san)).toEqual(["c4", "e4", "d4"]);
    play(tree.root, "g1f3", "overwrite");
    expect(tree.root.children.map((c) => c.san)).toEqual(["Nf3", "e4", "d4"]);
  });

  it("gives the new node the position after the move", () => {
    const tree = parseGame("*");
    const e4 = play(tree.root, "e2e4");
    expect(position(e4).turn).toBe("black");
    expect(e4.fen.startsWith("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b")).toBe(true);
  });
});

describe("review findings of 2026-11-07", () => {
  it("refuses moves that are not legal in the position", () => {
    const tree = parseGame("1. e4 *");
    const e4 = tree.root.children[0];
    expect(childFor(e4, parseUci("d2d4")!), "White can't move twice").toBeNull();
    expect(childFor(tree.root, parseUci("e3e4")!), "no piece on e3").toBeNull();
    expect(childFor(e4, parseUci("e7e5")!)!.node.san).toBe("e5");
  });

  it("keeps comments before a move where they were", () => {
    const pgn = "1. e4 ( { Better is } 1. d4 d5 ) 1... e5 *";
    const tree = parseGame(pgn);
    const d4 = tree.root.children[1];
    expect([d4.startingComments, d4.comments]).toEqual([["Better is"], []]);
    expect(movetext(writeGame(tree))).toBe("1. e4 ( { Better is } 1. d4 d5 ) 1... e5 *");
  });

  it("keeps symbols like a novelty when a move or position symbol is set", () => {
    const node = parseGame("1. e4 $146 $36 *").root.children[0];
    toggleNag(node, 16);
    toggleNag(node, 1);
    expect(node.nags).toEqual([1, 16, 36, 146]);
    toggleNag(node, 18);
    expect(node.nags).toEqual([1, 18, 36, 146]);
  });
});

describe("variations", () => {
  const tree = () => parseGame("1. e4 ( 1. d4 d5 ( 1... Nf6 2. c4 ) 2. c4 ) ( 1. c4 ) 1... e5 *");

  it("finds where a node's variation starts", () => {
    const t = tree();
    const [e4, d4] = t.root.children;
    expect(variationStart(e4.children[0])).toBeNull();
    expect(variationStart(d4.children[0].children[0])).toBe(d4);
    const nf6 = d4.children[1];
    expect(variationStart(nf6.children[0])).toBe(nf6);
    expect(variationStart(t.root)).toBeNull();
  });

  it("promotes a variation one place at a time, up to the main line", () => {
    const t = tree();
    const c4 = t.root.children[2];
    promoteVariation(c4);
    expect(t.root.children.map((c) => c.san)).toEqual(["e4", "c4", "d4"]);
    promoteVariation(c4);
    expect(t.root.children.map((c) => c.san)).toEqual(["c4", "e4", "d4"]);
    // On the main line there is nothing to promote.
    promoteVariation(c4);
    expect(t.root.children.map((c) => c.san)).toEqual(["c4", "e4", "d4"]);
  });

  it("deletes the whole variation a node is in and shows where it branched off", () => {
    const t = tree();
    const d5 = t.root.children[1].children[0];
    expect(deleteVariation(d5)).toBe(t.root);
    expect(t.root.children.map((c) => c.san)).toEqual(["e4", "c4"]);
    expect(deleteVariation(t.root.children[0])).toBeNull();
  });

  it("deletes the moves from a node on, but not the start position", () => {
    const t = tree();
    const e5 = t.root.children[0].children[0];
    expect(deleteFrom(e5)).toBe(t.root.children[0]);
    expect(t.root.children[0].children).toEqual([]);
    expect(deleteFrom(t.root)).toBeNull();
  });
});

describe("symbols", () => {
  it("shows known symbols and falls back to the NAG number", () => {
    expect([nagText(1), nagText(4), nagText(16), nagText(19)]).toEqual(["!", "??", "±", "−+"]);
    expect(nagText(146)).toBe("$146");
  });

  it("keeps one move symbol and one position symbol, and toggles off the same one", () => {
    const node = parseGame("1. e4 *").root.children[0];
    toggleNag(node, 16);
    toggleNag(node, 1);
    expect(node.nags).toEqual([1, 16]);
    toggleNag(node, 2);
    expect(node.nags).toEqual([2, 16]);
    toggleNag(node, 18);
    expect(node.nags).toEqual([2, 18]);
    toggleNag(node, 2);
    expect(node.nags).toEqual([18]);
  });
});

describe("pathTo and nodeAt", () => {
  it("find a node again in a freshly read copy of the game", () => {
    const pgn = "1. e4 ( 1. d4 d5 2. c4 ) 1... e5 *";
    const c4 = parseGame(pgn).root.children[1].children[0].children[0];
    expect(pathTo(c4)).toEqual([1, 0, 0]);
    expect(nodeAt(parseGame(pgn).root, [1, 0, 0]).san).toBe("c4");
  });

  it("stop at the last node that still exists", () => {
    const tree = parseGame("1. e4 e5 *");
    expect(nodeAt(tree.root, [0, 0, 0, 0]).san).toBe("e5");
    expect(nodeAt(tree.root, [3])).toBe(tree.root);
    expect(pathTo(tree.root)).toEqual([]);
  });
});
