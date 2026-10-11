/**
 * App-wide model-download manager. The download lives at the module level
 * (not in the Models screen's component state) so it keeps running no
 * matter where the user navigates; screens just subscribe to its progress.
 * Memory-only: if the app process is killed, the partial file is discarded
 * (the ground rule: nothing is persisted).
 */

import {
  downloadRecommended,
  RECOMMENDED_MODEL,
  type DownloadHandle,
  type LocalModelInfo,
} from './models';

export interface DownloadSnapshot {
  /** null = idle; otherwise 0..1 while running. */
  fraction: number | null;
  /** Human label of the file being downloaded. */
  name: string;
  /** The downloaded model info once finished (null = cancelled/failed). */
  result: LocalModelInfo | null;
}

let handle: DownloadHandle | null = null;
let snapshot: DownloadSnapshot = { fraction: null, name: '', result: null };
const listeners = new Set<() => void>();

function update(patch: Partial<DownloadSnapshot>) {
  snapshot = { ...snapshot, ...patch };
  for (const fn of listeners) fn();
}

/** useSyncExternalStore-compatible snapshot getter. */
export function downloadSnapshot(): DownloadSnapshot {
  return snapshot;
}

export function subscribeDownload(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** True while a download is in flight (any screen can check this). */
export function isDownloading(): boolean {
  return handle !== null;
}

/** Start the recommended download; a no-op if one is already running. */
export function startModelDownload(): void {
  if (handle) return;
  const h = downloadRecommended((fraction) => {
    update({ fraction });
  });
  handle = h;
  update({ fraction: 0, name: RECOMMENDED_MODEL.name, result: null });
  h.promise
    .then((info) => {
      update({ fraction: null, result: info });
    })
    .finally(() => {
      handle = null;
    });
}

export function cancelModelDownload(): void {
  if (!handle) return;
  const h = handle;
  handle = null;
  h.cancel();
  update({ fraction: null });
}
