const RECENT_KEY = "chessvault.recent";
const MAX_RECENT = 10;

/// A file the user opened, newest first in the list.
export type RecentFile = { path: string; openedAt: number };

export function loadRecent(): RecentFile[] {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(list) ? list.filter((f) => typeof f?.path === "string") : [];
  } catch {
    return [];
  }
}

function saveRecent(list: RecentFile[]) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    // Without storage the list just isn't remembered.
  }
}

const samePath = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/// Puts `path` at the top of the list and returns the new list.
export function addRecent(path: string): RecentFile[] {
  const list = [{ path, openedAt: Date.now() }, ...loadRecent().filter((f) => !samePath(f.path, path))].slice(0, MAX_RECENT);
  saveRecent(list);
  return list;
}

export function removeRecent(path: string): RecentFile[] {
  const list = loadRecent().filter((f) => !samePath(f.path, path));
  saveRecent(list);
  return list;
}

export function clearRecent(): RecentFile[] {
  saveRecent([]);
  return [];
}

/// The file name without its folder, e.g. `Bad Kötzting.pgn`.
export function fileName(path: string) {
  return path.split(/[\\/]/).pop() || path;
}

const MY_GAMES_KEY = "chessvault.myGames";

/// The My Games database the user chose, or null before they create one.
export function loadMyGames(): string | null {
  try {
    return localStorage.getItem(MY_GAMES_KEY);
  } catch {
    return null;
  }
}

export function saveMyGames(path: string | null) {
  try {
    if (path) localStorage.setItem(MY_GAMES_KEY, path);
    else localStorage.removeItem(MY_GAMES_KEY);
  } catch {
    // Without storage My Games has to be chosen again next time.
  }
}
