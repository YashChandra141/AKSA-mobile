/**
 * Chat router: port of aksa/chat.py ChatSession. Flow per question:
 *   greeting -> casual chat;  regex route -> tool -> phrase;
 *   else model JSON tool-pick -> tool -> phrase;  else casual chat.
 * The model only phrases; all astronomy comes from skyQuery. Without a
 * loaded model every path degrades to the computed template text.
 */

import { route, type ToolArgs, type ToolName } from '@/sky/intent';
import { findObject, identifyObject, whatsUp, tonightSummary } from '@/sky/skyQuery';
import { casualChatPrompt, NARRATOR_PROMPT, ROUTER_PROMPT } from './prompts';
import { generate, generateJson, parseLooseJson, type LlmMessage } from './llm';
import type { ChatMsg } from '@/state/session';
import type { SkyContext } from '@/sky/types';

const VALID_TOOLS: ToolName[] = ['find_object', 'identify_object', 'whats_up', 'tonight_verdict'];

/** Bare greetings skip the router step (wasted AI call, blank seconds). */
const GREETING_RE =
  /^(?:hi+|hello+|hey+|yo|namaste|good\s+(?:morning|evening|afternoon|night))[\s!,.]*$/i;

export type RunTool = (tool: ToolName, args: ToolArgs) => Record<string, unknown>;

/** Build a tool runner bound to the current observing context. */
export function makeToolRunner(
  ctx: SkyContext,
  cloudForWindow: (start: string, end: string) => number | null | undefined,
): RunTool {
  return (tool, args) => {
    switch (tool) {
      case 'find_object':
        return findObject(args.name ?? '', ctx) as unknown as Record<string, unknown>;
      case 'identify_object':
        return identifyObject(args.direction ?? '', args.height ?? 'medium', ctx) as unknown as Record<string, unknown>;
      case 'whats_up':
        return whatsUp(ctx) as unknown as Record<string, unknown>;
      case 'tonight_verdict':
        return tonightSummary(ctx, cloudForWindow) as unknown as Record<string, unknown>;
      default:
        return { ok: false, error: `unknown tool ${tool}` };
    }
  };
}

/** Template fallback: computed text only, no model. Port of _fallback_text. */
export function fallbackText(result: Record<string, unknown>): string {
  const bits: string[] = [];
  if (typeof result.summary === 'string' && result.summary) bits.push(result.summary);
  if (typeof result.fact === 'string' && result.fact) bits.push(`Fact: ${result.fact}`);
  if (Array.isArray(result.ambiguous) && result.ambiguous.length) {
    const cands = result.ambiguous.map(String);
    bits.push(
      'Did you mean ' + cands.slice(0, -1).join(', ') + ` or ${cands[cands.length - 1]}?`,
    );
  }
  if (typeof result.error === 'string' && result.error) bits.push(result.error);
  return bits.join('\n') || 'No data available.';
}

function stripDanglingFact(answer: string): string {
  return answer.replace(/Fact:\s*$/, '').trim();
}

export interface ChatSessionOpts {
  /** Location line for casual chat ("am I in Kanpur?"). */
  locationLine: string;
  /** In-memory chat history (already capped at 8 messages). */
  history: ChatMsg[];
  /** Persist new turns by appending to the caller's store. */
  remember?: (pair: [ChatMsg, ChatMsg]) => void;
}

/**
 * Respond to one question. `onChunk` streams the phrase-model output only.
 * Returns the final text. Falls back to computed text whenever the model
 * is unavailable or the tool result is not ok.
 */
export async function respond(
  question: string,
  runTool: RunTool,
  opts: ChatSessionOpts,
  onChunk?: (partial: string) => void,
): Promise<string> {
  const trimmed = question.trim();
  if (GREETING_RE.test(trimmed)) {
    return generalChat(trimmed, opts, onChunk);
  }

  const routed = route(trimmed);
  if (routed) {
    const [tool, args] = routed;
    const result = runTool(tool, args);
    return phrase(result, trimmed, opts, onChunk);
  }

  // Model tool-pick for unusual questions (JSON mode, 80-token cap).
  const pick = await modelToolPick(trimmed);
  if (pick) {
    const [tool, args] = pick;
    const result = runTool(tool, args);
    return phrase(result, trimmed, opts, onChunk);
  }

  return generalChat(trimmed, opts, onChunk);
}

async function modelToolPick(question: string): Promise<[ToolName, ToolArgs] | null> {
  const parsed = await generateJson(ROUTER_PROMPT, question, 80);
  if (!parsed) return null;
  const tool = parsed.tool;
  if (typeof tool !== 'string' || !VALID_TOOLS.includes(tool as ToolName)) return null;
  const rawArgs = parsed.args;
  const args: ToolArgs =
    rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)
      ? (rawArgs as ToolArgs)
      : {};
  return [tool as ToolName, args];
}

/** Port of ChatSession._phrase: data -> narrator -> Fact guards. */
async function phrase(
  result: Record<string, unknown>,
  question: string,
  opts: ChatSessionOpts,
  onChunk?: (partial: string) => void,
): Promise<string> {
  if (!result.ok) return fallbackText(result);

  const fact = (typeof result.fact === 'string' ? result.fact : '').trim();
  // Never hand the model an empty fact field: it replies with a bare
  // "Fact:" and stops. Only include a real fact in the payload.
  const payload: Record<string, unknown> = { ...result };
  delete payload.fact;
  if (fact) payload.fact = fact;

  const messages: LlmMessage[] = [
    { role: 'system', content: NARRATOR_PROMPT },
    ...opts.history.slice(-4).map((m) => ({ role: m.role, content: m.content }) as LlmMessage),
    {
      role: 'user',
      content:
        `Question: ${question}\n\nComputed data:\n${JSON.stringify(payload)}`,
    },
  ];

  const generated = await generate({ messages, temperature: 0.2, maxTokens: 256, onToken: onChunk });
  if (!generated) return fallbackText(result);

  const raw = generated.text;
  let answer: string;
  if (fact && /Fact:\s*$/.test(raw.trimEnd())) {
    // Model printed "Fact:" but stopped short - complete the line.
    onChunk?.(` ${fact}`);
    answer = `${raw.trimEnd()} ${fact}`.trim();
  } else {
    answer = stripDanglingFact(raw);
  }
  const finalAnswer = answer.trim();
  opts.remember?.([
    { role: 'user', content: question },
    { role: 'assistant', content: finalAnswer },
  ]);
  return finalAnswer;
}

/** Port of ChatSession._general_chat: warm chat with the no-sky-data guard. */
async function generalChat(
  question: string,
  opts: ChatSessionOpts,
  onChunk?: (partial: string) => void,
): Promise<string> {
  const messages: LlmMessage[] = [
    { role: 'system', content: casualChatPrompt(opts.locationLine) },
    ...opts.history.slice(-4).map((m) => ({ role: m.role, content: m.content }) as LlmMessage),
    { role: 'user', content: question },
  ];
  const generated = await generate({ messages, temperature: 0.7, maxTokens: 256, onToken: onChunk });
  if (!generated) {
    return 'I couldn\u2019t load the local model. Try \u201cwhere is Sirius\u201d for computed answers, or pick a model in the Models tab.';
  }
  const answer = generated.text.trim();
  opts.remember?.([
    { role: 'user', content: question },
    { role: 'assistant', content: answer },
  ]);
  return answer;
}

/** One-shot helper for screens that just need a single answer. */
export async function oneShot(
  question: string,
  runTool: RunTool,
  opts: ChatSessionOpts,
): Promise<string> {
  return respond(question, runTool, opts);
}
