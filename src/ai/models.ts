/**
 * Local GGUF model management: scan the app's models/ folder, import a
 * folder via the SAF picker (Android) or file picker (iOS), read model
 * metadata through llama.rn, auto-select a model, and download the
 * recommended one from Hugging Face with progress. The chosen model is
 * never persisted - the scan reruns every launch (no app data on disk
 * beyond the .gguf files themselves).
 */

import { File, Directory, Paths } from 'expo-file-system';
import type { LlamaContext } from 'llama.rn';
import { ensureLlama } from './llm';

export interface LocalModelInfo {
  /** Absolute file URI llama.rn can load. */
  path: string;
  name: string;
  sizeBytes: number;
  hasChatTemplate: boolean;
}

/** Recommended starter model (Gemma 3 1B instruct, 4-bit ~ 800 MB). */
export const RECOMMENDED_MODEL = {
  name: 'gemma-3-1b-it-Q4_K_M.gguf',
  url: 'https://huggingface.co/unsloth/gemma-3-1b-it-GGUF/resolve/main/gemma-3-1b-it-Q4_K_M.gguf',
  sizeBytes: 807_694_688, // approximate, for the size label
};

const APP_MODELS_DIR = 'models';

/** The app's models directory (created on first scan). Null when the
 * filesystem is unavailable (e.g. web preview) - the scan then just
 * returns no models instead of crashing the screen. */
export function modelsDir(): Directory | null {
  try {
    const dir = new Directory(Paths.document, APP_MODELS_DIR);
    if (!dir.exists) dir.create();
    return dir;
  } catch (err) {
    console.warn('[models] models dir unavailable', err);
    return null;
  }
}

async function requireLoadModelInfo(): Promise<((model: string) => Promise<object>) | null> {
  try {
    const mod = require('llama.rn') as {
      loadLlamaModelInfo?: (model: string) => Promise<object>;
    };
    return mod.loadLlamaModelInfo ?? null;
  } catch {
    return null;
  }
}

/** Read llama.rn metadata for one .gguf; null when unreadable. */
async function modelInfoFor(file: File): Promise<LocalModelInfo | null> {
  const info: LocalModelInfo = {
    path: file.uri,
    name: file.name,
    sizeBytes: file.size ?? 0,
    hasChatTemplate: false,
  };
  const loadInfo = await requireLoadModelInfo();
  if (!loadInfo) {
    // Native module unavailable: accept the file, assume a chat template.
    info.hasChatTemplate = true;
    return info;
  }
  try {
    const meta = (await loadInfo(file.uri)) as {
      meta?: { chat_template?: unknown };
      chat_template?: unknown;
    };
    const tpl = meta.meta?.chat_template ?? meta.chat_template;
    info.hasChatTemplate = typeof tpl === 'string' && tpl.length > 0;
    return info;
  } catch (err) {
    console.warn('[models] metadata read failed for', file.name, err);
    return info;
  }
}

function listGgufFiles(dir: Directory): File[] {
  if (!dir.exists) return [];
  try {
    return dir.list().filter((e): e is File => e instanceof File && e.name.toLowerCase().endsWith('.gguf'));
  } catch (err) {
    console.warn('[models] list failed', err);
    return [];
  }
}

/**
 * Scan the app models/ folder for .gguf files (metadata included).
 * Never throws - returns whatever could be read.
 */
export async function scanAppModels(): Promise<LocalModelInfo[]> {
  const dir = modelsDir();
  if (!dir) return [];
  const files = listGgufFiles(dir);
  const infos = await Promise.all(files.map(modelInfoFor));
  return infos.filter((i): i is LocalModelInfo => i !== null);
}

/** Pick a folder (SAF on Android, picker on iOS) and scan it for .gguf. */
export async function scanPickedFolder(): Promise<LocalModelInfo[]> {
  const dir = await Directory.pickDirectoryAsync();
  if (!dir) return [];
  const files = listGgufFiles(dir);
  const infos = await Promise.all(files.map(modelInfoFor));
  return infos.filter((i): i is LocalModelInfo => i !== null);
}

/** Auto-select: Gemma 3 1B if present, else smallest with a chat template. */
export function autoSelect(models: LocalModelInfo[]): LocalModelInfo | null {
  if (!models.length) return null;
  const gemma = models.find((m) => /gemma/i.test(m.name) && /\b1b\b/i.test(m.name));
  if (gemma) return gemma;
  const withTemplate = models.filter((m) => m.hasChatTemplate);
  if (withTemplate.length) {
    return withTemplate.reduce((a, b) => (a.sizeBytes <= b.sizeBytes ? a : b));
  }
  return null;
}

/**
 * Full launch-time scan: app folder + auto-select. The caller stores the
 * pick in the session (kept separate to avoid a circular import).
 */
export async function rescanAndSelect(): Promise<{
  models: LocalModelInfo[];
  picked: LocalModelInfo | null;
}> {
  const models = await scanAppModels();
  const picked = autoSelect(models);
  return { models, picked };
}

export interface DownloadHandle {
  promise: Promise<LocalModelInfo | null>;
  cancel: () => void;
}

/**
 * Download the recommended model into the app models/ folder with
 * progress. Resolves null on cancel or failure.
 */
export function downloadRecommended(onProgress: (fraction: number) => void): DownloadHandle {
  const dir = modelsDir();
  if (!dir) {
    onProgress(0);
    return {
      promise: Promise.resolve(null),
      cancel: () => undefined,
    };
  }
  const destination = new File(dir, RECOMMENDED_MODEL.name);
  if (destination.exists) destination.delete();
  // Wire the progress listener through DownloadTaskOptions, otherwise the
  // onProgress callback of this function is never invoked.
  const task = File.createDownloadTask(RECOMMENDED_MODEL.url, destination, {
    onProgress: (data) => onProgress(data.totalBytes > 0 ? data.bytesWritten / data.totalBytes : 0),
  });
  let settled = false;

  const promise = task
    .downloadAsync()
    .then(async (file) => {
      settled = true;
      if (!file) return null;
      const info = await modelInfoFor(file);
      return info;
    })
    .catch((err) => {
      console.warn('[models] download failed', err);
      if (destination.exists) destination.delete();
      return null;
    });

  return {
    promise,
    cancel: () => {
      if (!settled) {
        try {
          task.cancel();
        } catch {
          /* already finished */
        }
      }
    },
  };
}

/**
 * Warm the LLM with the given model; reports load progress 0..1 and
 * returns the resulting context (null if the device could not load it).
 */
export async function activateModel(
  model: LocalModelInfo,
  onProgress?: (fraction: number) => void,
): Promise<LlamaContext | null> {
  const ctx = await ensureLlama(model.path, onProgress);
  return ctx;
}

/** Delete a downloaded model file (caller refreshes the selection). */
export async function deleteModel(model: LocalModelInfo): Promise<void> {
  const file = new File(model.path);
  if (file.exists) file.delete();
}

/** Human-readable size ("742 MB", "1.2 GB"). */
export function fmtSize(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
  if (bytes >= 1_048_576) return `${Math.round(bytes / 1_048_576)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}
