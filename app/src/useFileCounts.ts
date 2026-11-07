import { useEffect, useState } from "react";
import { databaseCounts } from "./api";

/// The number of games in each file, read again whenever `active` turns on or the files change.
/// A file that is missing or can't be read counts as null.
export function useFileCounts(active: boolean, paths: string[]): Record<string, number | null> {
  const [counts, setCounts] = useState<Record<string, number | null>>({});
  const key = paths.join("\n");

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    databaseCounts(paths)
      .then((found) => {
        if (!cancelled) setCounts(Object.fromEntries(paths.map((p, i) => [p, found[i]])));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [active, key]);

  return counts;
}
