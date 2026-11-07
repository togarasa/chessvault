import { describe, expect, it } from "vitest";
import { EMPTY_FILTER, describeFilter, playerFilter } from "./filter";

describe("playerFilter", () => {
  it("finds the name as either player", () => {
    expect(playerFilter("Alpha")).toEqual({ ...EMPTY_FILTER, white: "Alpha", ignoreColour: true });
  });
});

describe("describeFilter", () => {
  it("says all games when nothing is set", () => {
    expect(describeFilter(EMPTY_FILTER)).toBe("all games");
  });

  it("names the players, with anyone for an empty side", () => {
    expect(describeFilter({ ...EMPTY_FILTER, white: "Alpha" })).toBe("Alpha – anyone");
    expect(describeFilter({ ...EMPTY_FILTER, black: "Beta" })).toBe("anyone – Beta");
    expect(describeFilter({ ...EMPTY_FILTER, white: "A", black: "B", ignoreColour: true })).toBe("A – B (either colour)");
  });

  it("shows ranges with one or both ends", () => {
    expect(describeFilter({ ...EMPTY_FILTER, ecoFrom: "B20", ecoTo: "B99" })).toBe("ECO B20–B99");
    expect(describeFilter({ ...EMPTY_FILTER, dateFrom: "2024" })).toBe("date from 2024");
    expect(describeFilter({ ...EMPTY_FILTER, dateTo: "2026" })).toBe("date to 2026");
  });

  it("lists every field that is set, in a fixed order", () => {
    const all = {
      white: "A",
      black: "",
      ignoreColour: false,
      result: "1-0",
      ecoFrom: "C",
      ecoTo: "",
      dateFrom: "",
      dateTo: "2025",
      minWhiteElo: 2000,
      minBlackElo: 0,
      event: "Open",
      site: "Prague",
    };
    expect(describeFilter(all)).toBe(
      'A – anyone · result 1-0 · ECO from C · date to 2025 · White Elo ≥ 2000 · Black Elo ≥ 0 · event "Open" · site "Prague"',
    );
  });
});
