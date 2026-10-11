/**
 * Thin async wrapper around llama.rn. Only one context is alive at a time
 * (a 1B model needs the whole device budget); `withLlama` serializes all
 * generation behind a promise chain so screens never race for the context.
 * Nothing here touches disk beyond what llama.rn itself does loading a
 * model file - all state lives in memory.
 */

import type { LlamaContext } from 'llama.rn';
import { NativeModules, Platform } from 'react-native';

export type LlmMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export type GenerateResult = { text: string; tokenCount: number };

type InitLlamaFn = (
  params: Record<string, unknown>,
  onProgress?: (progress: number) => void,
) => Promise<LlamaContext>;

type CompletionCallbackChunk = { token?: string };

let ctx: LlamaContext | null = null;
let ctxModel: string | null = null;
let loading: Promise<LlamaContext | null> | null = null;

// --- Ollama dev backend -------------------------------------------------
// On a dev machine a local Ollama server (gemma3:1b) stands in for the
// on-device GGUF so features can be tested without a device build. In
// Expo Go the llama.rn native module is unavailable, so this fallback is
// what makes AI phrasing work on phones/emulators too. The server runs
// on the dev machine; on a real device this is unreachable (unless on
// the same Wi-Fi) and the template paths take over.
const OLLAMA_PORT = 11434;
/** Preferred dev model, pinned for local testing. */
export const OLLAMA_PREFERRED_MODEL = 'gemma3:1b';
let ollamaModel: string | null | undefined; // undefined = not probed yet
let ollamaBase: string | null = null;
/** Shared in-flight probe so concurrent callers don't fan out twice. */
let ollamaProbe: Promise<string | null> | null = null;

/**
 * Candidate Ollama base URLs, in order:
 *  - localhost (the classic dev case: bundler and server on one machine)
 *  - 10.0.2.2 (Android emulator's alias for the host PC's localhost)
 *  - the Metro dev server's host (PC LAN IP, works from a phone on the
 *    same Wi-Fi) - read from the dev launcher script URL, no stored state.
 */
function ollamaCandidates(): string[] {
  const urls = new Set<string>();
  urls.add(`http://localhost:${OLLAMA_PORT}`);
  if (Platform.OS === 'android') urls.add(`http://10.0.2.2:${OLLAMA_PORT}`);
  try {
    // e.g. http://192.168.29.177:8081/node_modules/expo-router/entry.bundle
    const scriptURL =
      (NativeModules.SourceCode && NativeModules.SourceCode.scriptURL) || '';
    const m = scriptURL.match(/^[a-z]+:\/\/([^/:]+)/i);
    const host = m?.[1];
    if (host && host !== 'localhost' && !host.startsWith('127.')) {
      urls.add(`http://${host}:${OLLAMA_PORT}`);
    }
  } catch {
    // SourceCode module unavailable (rare) - localhost fallbacks remain.
  }
  return [...urls];
}

async function probeOllama(base: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const res = await fetch(`${base}/api/tags`, { signal: controller.signal });
    if (!res.ok) return null;
    const data = (await res.json()) as { models?: { name?: string }[] };
    const names = (data.models ?? []).map((m) => m.name ?? '').filter(Boolean);
    return (
      names.find((n) => /unsloth\/gemma-3-1b-it-GGUF/i.test(n)) ?? // the recommended download, imported into Ollama
      names.find((n) => n.includes(OLLAMA_PREFERRED_MODEL)) ??
      names.find((n) => /gemma/i.test(n)) ??
      names[0] ??
      null
    );
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Probe the local Ollama server(s) and pick a model (prefers gemma3:1b). */
export async function ensureOllama(): Promise<string | null> {
  if (ollamaModel !== undefined) return ollamaModel;
  // Ollama is a dev-machine stand-in; release builds never probe the LAN.
  if (!__DEV__) {
    ollamaModel = null;
    return null;
  }
  if (ollamaProbe) return ollamaProbe;
  ollamaProbe = (async () => {
    const candidates = ollamaCandidates();
    const results = await Promise.all(candidates.map((base) => probeOllama(base)));
    const idx = results.findIndex((m) => m !== null);
    ollamaModel = idx === -1 ? null : results[idx];
    ollamaBase = idx === -1 ? null : candidates[idx];
    if (ollamaModel) console.log('[llm] using Ollama backend:', ollamaModel, 'at', ollamaBase);
    return ollamaModel;
  })();
  try {
    return await ollamaProbe;
  } finally {
    ollamaProbe = null;
  }
}

/** True when any phrasing backend is available (loaded GGUF or Ollama). */
export async function ensureAiReady(): Promise<boolean> {
  if (ctx) return true;
  return (await ensureOllama()) !== null;
}

async function generateOllama(opts: {
  messages: LlmMessage[];
  maxTokens: number;
  temperature: number;
  onToken?: (partial: string) => void;
}): Promise<GenerateResult | null> {
  const model = await ensureOllama();
  if (!model || !ollamaBase) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120_000);
    try {
      const res = await fetch(`${ollamaBase}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          model,
          messages: opts.messages,
          stream: false,
          options: { temperature: opts.temperature, num_predict: opts.maxTokens },
        }),
      });
      if (!res.ok) {
        console.warn('[llm] ollama HTTP', res.status);
        return null;
      }
      const data = (await res.json()) as { message?: { content?: string } };
      const text = (data.message?.content ?? '').trim();
      if (!text) return null;
      opts.onToken?.(text);
      return { text, tokenCount: 0 };
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    console.warn('[llm] ollama completion failed', err);
    return null;
  }
}

// Serializes generation requests; llama.rn contexts are single-slot.
let queue: Promise<unknown> = Promise.resolve();

function getInitLlama(): InitLlamaFn | null {
  try {
    // Require lazily so Jest / web previews never pull the native module.
    const mod = require('llama.rn') as {
      initLlama?: InitLlamaFn;
      releaseAllLlama?: () => void;
    };
    return mod.initLlama ?? null;
  } catch {
    return null;
  }
}

/**
 * Ensure a context is loaded for `modelPath`. Returns null when the native
 * module is unavailable (Jest, Expo Go) so callers fall back to templates.
 */
export async function ensureLlama(
  modelPath: string,
  onProgress?: (fraction: number) => void,
): Promise<LlamaContext | null> {
  if (ctx && ctxModel === modelPath) return ctx;
  if (loading) return loading;

  const initLlama = getInitLlama();
  if (!initLlama) return null;

  loading = (async () => {
    try {
      if (ctx) await releaseLlama();
      const context = await initLlama(
        { model: modelPath, n_ctx: 2048, n_gpu_layers: 99 },
        (progress: number) => onProgress?.(progress),
      );
      ctx = context;
      ctxModel = modelPath;
      return context;
    } catch (err) {
      console.warn('[llm] init failed', err);
      return null;
    } finally {
      loading = null;
    }
  })();
  return loading;
}

export function currentLlama(): LlamaContext | null {
  return ctx;
}

export async function releaseLlama(): Promise<void> {
  if (!ctx) return;
  const old = ctx;
  ctx = null;
  ctxModel = null;
  try {
    await old.release();
  } catch (err) {
    console.warn('[llm] release failed', err);
  }
}

export function isLlamaReady(): boolean {
  return ctx !== null;
}

function runQueued<T>(job: () => Promise<T>): Promise<T> {
  const next = queue.then(job, job);
  queue = next.catch(() => undefined);
  return next;
}

/**
 * Run one completion to completion (non-streaming). Streaming variants can
 * pass `onToken` to receive chunks as they arrive.
 */
export async function generate(opts: {
  messages: LlmMessage[];
  maxTokens?: number;
  temperature?: number;
  onToken?: (partial: string) => void;
}): Promise<GenerateResult | null> {
  const context = ctx;
  // No on-device context: fall back to the local Ollama server (dev
  // testing), then to null (callers show template text).
  if (!context) {
    return runQueued(() =>
      generateOllama({
        messages: opts.messages,
        maxTokens: opts.maxTokens ?? 256,
        temperature: opts.temperature ?? 0.2,
        onToken: opts.onToken,
      }),
    );
  }

  return runQueued(async () => {
    try {
      let text = '';
      let tokenCount = 0;
      await context.completion(
        {
          messages: opts.messages,
          n_predict: opts.maxTokens ?? 256,
          temperature: opts.temperature ?? 0.2,
          top_k: 40,
          top_p: 0.95,
          stop: ['</s>', 'User:', 'user:'],
        },
        (chunk: CompletionCallbackChunk) => {
          const tok = chunk?.token ?? '';
          if (!tok) return;
          text += tok;
          tokenCount += 1;
          opts.onToken?.(text);
        },
      );
      return { text: text.trim(), tokenCount };
    } catch (err) {
      console.warn('[llm] completion failed', err);
      return null;
    }
  });
}

/** Strict JSON tool-pick call (router). Returns parsed object or null. */
export async function generateJson(
  system: string,
  user: string,
  maxTokens = 80,
): Promise<Record<string, unknown> | null> {
  const result = await generate({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    maxTokens,
    temperature: 0.1,
  });
  if (!result) return null;
  return parseLooseJson(result.text);
}

/** Tolerant JSON extraction: models like to wrap JSON in prose or fences. */
export function parseLooseJson(raw: string): Record<string, unknown> | null {
  if (!raw) return null;
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced ? fenced[1] : raw).trim();
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  const slice = candidate.slice(start, end + 1);
  try {
    const parsed = JSON.parse(slice) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}
