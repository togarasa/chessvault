import { afterEach, describe, expect, it, vi } from "vitest";
import { COLUMNS, DEFAULT_ORDER, nextOrder } from "./columns";
import { conversionStepText, largeConversionQuestion } from "./conversion";
import {
  EngineLine,
  formatScore,
  loadEnginePath,
  numberMoves,
  numberedMoves,
  saveEnginePath,
  whiteShare,
  withLine,
} from "./engine";
import { formValue, headerValue, newGamePgn, pgnDate } from "./pgn";
import { folderOf } from "./recent";
import { GameSummary } from "./types";

describe("large conversions", () => {
  it("are asked about from 200,000 games on", () => {
    expect(largeConversionQuestion(0)).toBeNull();
    expect(largeConversionQuestion(199_999)).toBeNull();
    const question = largeConversionQuestion(200_000)!;
    expect(question).toContain("about 1 minute and");
    expect(question).toContain("about 0.2 GB");
    expect(largeConversionQuestion(6_464_659)).toContain("about 7 minutes");
    expect(largeConversionQuestion(6_464_659)).toContain("about 6.8 GB");
  });

  it("say what they are doing", () => {
    expect(conversionStepText({ done: 0, total: 0 })).toContain("Unpacking");
    expect(conversionStepText({ done: 0, total: 5 })).toBe("0%");
    expect(conversionStepText({ done: 4, total: 5 })).toBe("80%");
    expect(conversionStepText({ done: 5, total: 5 })).toContain("Finishing");
  });
});

describe("game list columns", () => {
  const game: GameSummary = {
    id: 4,
    event: "Club",
    site: "Testville",
    date: "2026.01.10",
    round: "1",
    white: "Alpha, Anna",
    black: "Beta, Bernd",
    result: "1-0",
    eco: "C84",
    whiteElo: 2100,
    blackElo: null,
    plies: 9,
  };

  it("show a game in ChessBase's column order, moves counted in full moves", () => {
    expect(COLUMNS.map((c) => c.label)).toEqual(["No.", "White", "Elo", "Black", "Elo", "Result", "Moves", "ECO", "Event", "Site", "Round", "Date"]);
    expect(COLUMNS.map((c) => c.value(game))).toEqual([4, "Alpha, Anna", 2100, "Beta, Bernd", "", "1-0", 5, "C84", "Club", "Testville", "1", "2026.01.10"]);
    expect(COLUMNS.find((c) => c.key === "plies")!.value({ ...game, plies: null })).toBe("");
  });

  it("sort ascending by a new column and reverse the sorted one", () => {
    expect(DEFAULT_ORDER).toEqual({ column: "id", descending: false });
    const byElo = nextOrder(DEFAULT_ORDER, "whiteElo");
    expect(byElo).toEqual({ column: "whiteElo", descending: false });
    expect(nextOrder(byElo, "whiteElo")).toEqual({ column: "whiteElo", descending: true });
    expect(nextOrder(nextOrder(byElo, "whiteElo"), "whiteElo").descending).toBe(false);
    expect(nextOrder({ column: "whiteElo", descending: true }, "date")).toEqual({ column: "date", descending: false });
  });
});

describe("new games", () => {
  it("are dated in PGN's form with the seven standard tags", () => {
    expect(pgnDate(new Date(2026, 0, 5))).toBe("2026.01.05");
    const pgn = newGamePgn(new Date(2026, 10, 7));
    expect(pgn).toContain('[Date "2026.11.07"]');
    expect(pgn.match(/^\[/gm)).toHaveLength(7);
    expect(pgn.trim().endsWith("*")).toBe(true);
  });

  it("show PGN's ? as an empty field and store an empty field as ?", () => {
    expect([formValue("?"), formValue(undefined), formValue("Anna")]).toEqual(["", "", "Anna"]);
    expect([headerValue("  "), headerValue(" Anna ")]).toEqual(["?", "Anna"]);
  });
});

describe("engine lines", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("show scores from White's side", () => {
    expect(formatScore({ kind: "cp", value: 32 })).toBe("+0.32");
    expect(formatScore({ kind: "cp", value: -150 })).toBe("-1.50");
    expect(formatScore({ kind: "cp", value: 0 })).toBe("0.00");
    expect(formatScore({ kind: "mate", value: 3 })).toBe("#3");
    expect(formatScore({ kind: "mate", value: -2 })).toBe("#-2");
  });

  it("number the moves from the position, for either side to move", () => {
    const white = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
    expect(numberMoves(white, ["e4", "e5", "Nf3"])).toBe("1. e4 e5 2. Nf3");
    const black = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 7";
    expect(numberMoves(black, ["c5", "Nf3"])).toBe("7... c5 8. Nf3");
    expect(numberMoves("8/8/8/8/8/8/8/8", ["Kh1"])).toBe("1. Kh1");
    expect(numberMoves(white, [])).toBe("");
    expect(numberedMoves(black, ["c5", "Nf3", "d6"])).toEqual(["7... c5", "8. Nf3", "d6"]);
  });

  it("give the evaluation bar's share of White, half when equal", () => {
    expect(whiteShare({ kind: "cp", value: 0 })).toBe(50);
    expect(whiteShare({ kind: "cp", value: 100 })).toBeCloseTo(59.1, 1);
    expect(whiteShare({ kind: "cp", value: -100 })).toBeCloseTo(40.9, 1);
    expect(whiteShare({ kind: "cp", value: 2000 })).toBeGreaterThan(99);
    expect(whiteShare({ kind: "mate", value: 2 })).toBe(100);
    expect(whiteShare({ kind: "mate", value: -2 })).toBe(0);
  });

  it("keep one line per rank, replacing it when a deeper one arrives", () => {
    const line = (multipv: number, depth: number): EngineLine => ({ fen: "f", multipv, depth, score: { kind: "cp", value: 0 }, moves: [] });
    let lines = withLine([], line(2, 5));
    expect(lines[1].depth).toBe(5);
    lines = withLine(lines, line(1, 6));
    lines = withLine(lines, line(2, 9));
    expect(lines.map((l) => l.depth)).toEqual([6, 9]);
  });

  it("remember the engine path, and cope without storage", () => {
    const items = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (k: string) => items.get(k) ?? null, setItem: (k: string, v: string) => items.set(k, v) });
    expect(loadEnginePath()).toBe("");
    saveEnginePath("C:\\stockfish.exe");
    expect(loadEnginePath()).toBe("C:\\stockfish.exe");

    const blocked = () => {
      throw new Error("blocked");
    };
    vi.stubGlobal("localStorage", { getItem: blocked, setItem: blocked });
    expect(loadEnginePath()).toBe("");
    expect(() => saveEnginePath("x")).not.toThrow();
  });
});

describe("folderOf", () => {
  it("keeps the folder with its separator", () => {
    expect(folderOf("C:\\games\\a.pgn")).toBe("C:\\games\\");
    expect(folderOf("/home/me/a.pgn")).toBe("/home/me/");
    expect(folderOf("a.pgn")).toBe("");
  });
});
