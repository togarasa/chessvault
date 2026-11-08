import { useEffect, useRef, useState } from "react";
import { cancelConversion, onConversionProgress } from "./api";
import { ConversionProgress } from "./types";

/// How far the conversion of an opened file has come; `progress` is null when none is running.
export function useConversion() {
  const [progress, setProgress] = useState<ConversionProgress | null>(null);
  const [cancelling, setCancelling] = useState(false);
  /// Whether a file is being opened. A progress event that arrives after the end is ignored.
  const running = useRef(false);

  useEffect(
    () =>
      onConversionProgress((update) => {
        if (running.current) setProgress(update);
      }),
    [],
  );

  return {
    progress,
    cancelling,
    running,
    begin: () => {
      running.current = true;
    },
    end: () => {
      running.current = false;
      setProgress(null);
      setCancelling(false);
    },
    cancel: () => {
      setCancelling(true);
      return cancelConversion();
    },
  };
}
