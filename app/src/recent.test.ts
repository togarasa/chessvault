import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addRecent, clearRecent, fileName, loadMyGames, loadRecent, removeRecent, saveMyGames } from "./recent";

/// A stand-in for the browser's localStorage.
function fakeStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (k) => items.get(k) ?? null,
    key: (i) => [...items.keys()][i] ?? null,
    removeItem: (k) => void items.delete(k),
    setItem: (k, v) => void items.set(k, String(v)),
  };
}

beforeEach(() => vi.stubGlobal("localStorage", fakeStorage()));
afterEach(() => vi.unstubAllGlobals());

describe("recent files", () => {
  it("starts empty and puts the newest file first", () => {
    expect(loadRecent()).toEqual([]);
    addRecent("C:\\games\\a.pgn");
    const list = addRecent("C:\\games\\b.pgn");
    expect(list.map((f) => f.path)).toEqual(["C:\\games\\b.pgn", "C:\\games\\a.pgn"]);
    expect(loadRecent()).toEqual(list);
  });

  it("moves a file that is opened again to the top, ignoring case", () => {
    addRecent("C:\\games\\a.pgn");
    addRecent("C:\\games\\b.pgn");
    expect(addRecent("c:\\GAMES\\A.pgn").map((f) => f.path)).toEqual(["c:\\GAMES\\A.pgn", "C:\\games\\b.pgn"]);
  });

  it("keeps the ten newest files", () => {
    for (let i = 0; i < 12; i++) addRecent(`f${i}.pgn`);
    const list = loadRecent();
    expect(list).toHaveLength(10);
    expect(list[0].path).toBe("f11.pgn");
    expect(list[9].path).toBe("f2.pgn");
  });

  it("removes one file, or all of them", () => {
    addRecent("a.pgn");
    addRecent("b.pgn");
    expect(removeRecent("A.PGN").map((f) => f.path)).toEqual(["b.pgn"]);
    expect(clearRecent()).toEqual([]);
    expect(loadRecent()).toEqual([]);
  });

  it("ignores stored data that isn't a list of files", () => {
    localStorage.setItem("chessvault.recent", "not json");
    expect(loadRecent()).toEqual([]);
    localStorage.setItem("chessvault.recent", '{"path":"a.pgn"}');
    expect(loadRecent()).toEqual([]);
    localStorage.setItem("chessvault.recent", '[{"path":"a.pgn","openedAt":1},{"nope":1},null]');
    expect(loadRecent()).toEqual([{ path: "a.pgn", openedAt: 1 }]);
  });

  it("works without storage, just without remembering", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    });
    expect(loadRecent()).toEqual([]);
    expect(addRecent("a.pgn").map((f) => f.path)).toEqual(["a.pgn"]);
    expect(loadMyGames()).toBeNull();
    expect(() => saveMyGames("x.sqlite")).not.toThrow();
  });
});

describe("My Games", () => {
  it("is unset until chosen, and can be forgotten", () => {
    expect(loadMyGames()).toBeNull();
    saveMyGames("D:\\My Games.sqlite");
    expect(loadMyGames()).toBe("D:\\My Games.sqlite");
    saveMyGames(null);
    expect(loadMyGames()).toBeNull();
  });
});

describe("fileName", () => {
  it("takes the last part of Windows and Linux paths", () => {
    expect(fileName("C:\\Users\\me\\Bad Kötzting.pgn")).toBe("Bad Kötzting.pgn");
    expect(fileName("/home/me/games.sqlite")).toBe("games.sqlite");
    expect(fileName("plain.pgn")).toBe("plain.pgn");
  });

  it("keeps a path that ends in a separator", () => {
    expect(fileName("C:\\games\\")).toBe("C:\\games\\");
  });
});
