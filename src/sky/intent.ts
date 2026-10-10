/** Code-first question routing.
 * Port of aksa/intent.py. Most stargazing questions have a handful of
 * shapes. Recognizing them here means the small local model is only
 * needed to phrase the answer, which halves the wait and makes even a
 * 1B model dependable. */

const FILLER = /\b(please|the|a|an|tonight|now|right now)\b/g;

// Friendly lead-ins like "hey!", "hello,", "ok aksa - how are you, ..." before a question.
const LEAD_RE =
  /^(?:hey|hi|hello|yo|ok(?:ay)?|so|please|aksa|how\s+are\s+you)\b[!,.\-:\s]*/i;

const FIND_RE =
  /^(?:where\s+is|where's|where\s+are|find|locate|show\s+me|point\s+me\s+to|help\s+me\s+find|tell\s+me\s+about)\s+(?<name>.+)$/i;
const RISE_RE =
  /^(?:when|what\s+time)\s+(?:does|will|do|is)\s+(?<name>.+?)\s+(?:rise|setting|set|come\s+up|go\s+down|reach|peak|is\s+highest|highest|transit|cross\s+overhead)\b.*$/i;
const IDENTIFY_RE =
  /^what(?:'s|s|\s+is)\s+(?:that|this)\s+(?:(?:bright|faint|red|blue|orange)\s+)*(?:star|thing|light|object|dot|planet)\b/i;
const DIR_WORDS_RE =
  /\b(north\s*east|north\s*west|south\s*east|south\s*west|north|south|east|west|nne|ene|ese|sse|ssw|wnw|nnw|ne|nw|se|sw)\b/i;
const WHATSUP_RE =
  /^what(?:'s|\s+is)\s+up\b|^what\s+can\s+i\s+see\b|^anything\s+up\b|^what\s+is\s+(?:there|visible|bright)\b.*$/i;
// "what is orion" / "what's M31" - a definition question about a sky object,
// which must be answered from computed data, not from the model's memory.
const WHATIS_RE = /^what(?:'s|\s+is)\s+(?<name>.+)$/i;
// "how's the sky tonight", "is tonight good", "night of kanpur"
const TONIGHT_RE =
  /^(?:how(?:'s|\s+is|\s+was|\s+about)?\s+(?:the\s+)?(?:sky|night|tonight)\b.*|is\s+(?:it|tonight|the\s+(?:sky|night))\s+(?:good|clear|fine|ok(?:ay)?|decent|better)\b.*|night\s+(?:of|in|at)\s+\S+.*|tonight(?:'s)?\s+(?:sky|verdict|conditions|report)\b.*)$/i;

export type ToolName =
  | 'whats_up'
  | 'tonight_verdict'
  | 'identify_object'
  | 'find_object';

export interface ToolArgs {
  name?: string;
  direction?: string;
  height?: string;
}

function cleanName(name: string): string {
  let text = name.replace(FILLER, ' ');
  text = text.replace(/[?.!]+$/, '');
  return text.split(/\s+/).filter(Boolean).join(' ');
}

/** Return [toolName, args] for recognized shapes, else null. */
export function route(question: string): [ToolName, ToolArgs] | null {
  let q = question.trim().split(/\s+/).join(' ');
  for (let i = 0; i < 3; i++) {
    // strip repeated lead-ins: "hey! ok aksa - what's up"
    const stripped = q.replace(LEAD_RE, '');
    if (stripped === q) break;
    q = stripped;
  }
  if (!q) return null;

  if (WHATSUP_RE.test(q)) {
    return ['whats_up', {}];
  }

  if (TONIGHT_RE.test(q)) {
    return ['tonight_verdict', {}];
  }

  const mIdentify = q.match(IDENTIFY_RE);
  if (mIdentify) {
    let direction = '';
    const dm = q.match(DIR_WORDS_RE);
    if (dm) direction = dm[1].replace(/\s+/g, '').toLowerCase();
    let height = 'medium';
    const hl = q.toLowerCase();
    for (const [word, band] of [
      ['overhead', 'overhead'],
      ['high', 'high'],
      ['low', 'low'],
      ['medium', 'medium'],
    ] as const) {
      if (hl.includes(word)) {
        height = band;
        break;
      }
    }
    if (direction) {
      return ['identify_object', { direction, height }];
    }
    return null; // no direction: let the model ask the user for one
  }

  const mRise = q.match(RISE_RE);
  if (mRise?.groups?.name) {
    const name = cleanName(mRise.groups.name);
    if (name) return ['find_object', { name }];
  }

  const mWhatIs = q.match(WHATIS_RE);
  if (mWhatIs?.groups?.name) {
    const name = cleanName(mWhatIs.groups.name);
    if (name) return ['find_object', { name }];
  }

  const mFind = q.match(FIND_RE);
  if (mFind?.groups?.name) {
    const name = cleanName(mFind.groups.name);
    if (name) return ['find_object', { name }];
  }
  return null;
}