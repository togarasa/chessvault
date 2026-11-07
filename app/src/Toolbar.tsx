import { fileName } from "./recent";

type Props = {
  isOpen: boolean;
  /// The open file, shown on the right.
  dbPath: string;
  hasRecent: boolean;
  onDatabases: () => void;
  onOpen: () => void;
  /// Opens the recent-files menu below the button at `x`, `y`.
  onRecent: (x: number, y: number) => void;
  onImport: () => void;
  onNewGame: () => void;
  onExport: () => void;
};

export function Toolbar({ isOpen, dbPath, hasRecent, onDatabases, onOpen, onRecent, onImport, onNewGame, onExport }: Props) {
  return (
    <header className="toolbar">
      <button onClick={onDatabases} disabled={!isOpen} title="Show all databases">
        Databases
      </button>
      <button onClick={onOpen} title="Open a PGN file or a ChessVault database">
        Open…
      </button>
      <button
        onClick={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          onRecent(box.left, box.bottom + 2);
        }}
        disabled={!hasRecent}
        title="Recently opened files"
      >
        Recent ▾
      </button>
      <button onClick={onImport} disabled={!isOpen} title="Add the games of a PGN file to the open database">
        Import PGN…
      </button>
      <button onClick={onNewGame} disabled={!isOpen}>
        New game
      </button>
      <button onClick={onExport} disabled={!isOpen}>
        Export PGN…
      </button>
      {isOpen && (
        <span className="current-file" title={dbPath}>
          {fileName(dbPath)}
        </span>
      )}
    </header>
  );
}
