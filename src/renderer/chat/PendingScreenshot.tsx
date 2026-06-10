/**
 * @file src/renderer/chat/PendingScreenshot.tsx
 *
 * Thumbnail chip for a screenshot queued on the next outgoing chat message.
 */

import { useEffect, useState, type ReactElement } from 'react';
import type { Screenshot } from '../../shared/types';

export interface PendingScreenshotProps {
  screenshot: Screenshot;
  onRemove: () => void;
}

export default function PendingScreenshot(props: PendingScreenshotProps): ReactElement {
  const { screenshot, onRemove } = props;
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void window.api.capture.getThumbnailDataUrl(screenshot.id).then((url) => {
      if (!cancelled) setDataUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [screenshot.id]);

  return (
    <div className="group relative h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-ap-green/40 bg-black/40">
      {dataUrl ? (
        <img
          src={dataUrl}
          alt="Captured region preview"
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-[9px] text-white/50">
          …
        </div>
      )}
      <button
        type="button"
        aria-label="Remove screenshot attachment"
        onClick={onRemove}
        className="absolute right-0.5 top-0.5 rounded bg-black/70 px-1 text-[10px] leading-none text-white/80 opacity-0 transition-opacity group-hover:opacity-100 hover:text-white"
      >
        ×
      </button>
    </div>
  );
}
