import { useState } from "react";
import { RecentFile, fileName, folderOf } from "./recent";

type Props = {
  /// Recently opened files, newest first.
  files: RecentFile[];
  /// The My Games database, or null until the user creates it.
  myGames: string | null;
  /// Games in each file by path; null when the file is missing or unreadable.
  counts: Record<string, number | null>;
  onOpen: (path: string) => void;
  onMyGames: () => void;
  onAdd: () => void;
  onMenu: (path: string, isMyGames: boolean, x: number, y: number) => void;
};

/// The folder of a file, without the trailing separator.
function folderName(path: string) {
  return folderOf(path).slice(0, -1);
}

function countText(count: number | null | undefined) {
  if (count === undefined) return "…";
  if (count === null) return "not found";
  return `${count.toLocaleString()} ${count === 1 ? "game" : "games"}`;
}

/// The start screen: databases and PGN files as tiles. Double-click (or Enter) opens one.
export function DatabaseTiles({ files, myGames, counts, onOpen, onMyGames, onAdd, onMenu }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const others = files.filter((f) => !myGames || f.path.toLowerCase() !== myGames.toLowerCase());

  function tile(key: string, path: string | null, name: string, details: string[], open: () => void, mine = false) {
    const missing = path !== null && counts[path] === null;
    return (
      <button
        key={key}
        className={["tile", mine ? "mine" : "", selected === key ? "selected" : "", missing ? "missing" : ""].join(" ")}
        title={path ?? undefined}
        onClick={() => setSelected(key)}
        onDoubleClick={open}
        onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), open())}
        onContextMenu={(e) => {
          e.preventDefault();
          setSelected(key);
          if (path) onMenu(path, mine, e.clientX, e.clientY);
        }}
      >
        <span className="tile-icon" aria-hidden />
        <span className="tile-name">{name}</span>
        {details.map((d, i) => (
          <span key={i} className="tile-detail">
            {d}
          </span>
        ))}
      </button>
    );
  }

  return (
    <section className="tiles-screen">
      <h2>Databases</h2>
      <div className="tiles">
        {tile(
          "my-games",
          myGames,
          "My Games",
          myGames ? [countText(counts[myGames]), folderName(myGames)] : ["Your own games", "Double-click to create"],
          onMyGames,
          true,
        )}
        {others.map((f) =>
          tile(
            f.path,
            f.path,
            fileName(f.path),
            [countText(counts[f.path]), folderName(f.path), `opened ${new Date(f.openedAt).toLocaleDateString()}`],
            () => onOpen(f.path),
          ),
        )}
        <button
          className="tile add"
          onDoubleClick={onAdd}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), onAdd())}
          title="Open a PGN file or database"
        >
          <span className="tile-plus" aria-hidden>
            +
          </span>
          <span className="tile-name">Add database…</span>
        </button>
      </div>
      <p className="muted">Double-click a tile to open it. Right-click for more.</p>
    </section>
  );
}
