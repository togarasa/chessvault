import { conversionStepText } from "./conversion";
import { ConversionProgress } from "./types";

/// Shown over the window while a file is converted, which can take minutes for a large database.
export function ConversionDialog({
  progress,
  cancelling,
  onCancel,
}: {
  progress: ConversionProgress;
  cancelling: boolean;
  onCancel: () => void;
}) {
  return (
    <div className="overlay">
      <div className="dialog conversion" role="dialog" aria-label="Converting">
        <strong>Converting to a ChessVault database</strong>
        <small>This happens once; next time the file opens straight away. The original file is not changed.</small>
        {/* Without a value the bar only shows that something is happening. */}
        <progress value={progress.total > 0 ? progress.done : undefined} max={progress.total || undefined} />
        <span>{conversionStepText(progress)}</span>
        <div className="actions">
          <button disabled={cancelling} onClick={onCancel}>
            {cancelling ? "Stopping…" : "Cancel"}
          </button>
        </div>
      </div>
    </div>
  );
}
