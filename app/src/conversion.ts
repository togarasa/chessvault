import { ConversionProgress } from "./types";

/// From here on a conversion takes long and makes a large file, so it asks first.
const LARGE_CONVERSION_GAMES = 200_000;
// Measured on a database of 6.4 million games: 5.8 GB in about 6 minutes.
const BYTES_PER_GAME = 900;
const GAMES_PER_MINUTE = 1_100_000;

/// What the conversion is doing now.
export function conversionStepText({ done, total }: ConversionProgress) {
  if (total === 0) return "Unpacking the archive…";
  if (done >= total) return "Finishing the database…";
  return `${Math.floor((done / total) * 100)}%`;
}

/// The question to ask before converting `games` games, or null when it is quick and small.
export function largeConversionQuestion(games: number): string | null {
  if (games < LARGE_CONVERSION_GAMES) return null;
  const gigabytes = ((games * BYTES_PER_GAME) / 1e9).toFixed(1);
  const minutes = Math.ceil(games / GAMES_PER_MINUTE);
  return (
    `This file holds about ${games.toLocaleString()} games. Converting it takes about ${minutes} ` +
    `${minutes === 1 ? "minute" : "minutes"} and makes a new file of about ${gigabytes} GB in the same folder. ` +
    "If that folder is synced to a cloud service, the new file is uploaded too."
  );
}
