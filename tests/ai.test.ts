/**
 * AI runtime tests: pure logic only (no model, no network).
 * Covers the code-first router, the tolerant JSON parser, the template
 * fallback builder, the knowledge-aware narrator prompt and the Guide
 * payload text serializer.
 */

import { route } from '@/sky/intent';
import { guidePayloadText, type GuidePayload } from '@/sky/guide';
import { fallbackText } from '@/ai/router';
import { guidePrompt, narratorPrompt, ROUTER_PROMPT } from '@/ai/prompts';
import { parseLooseJson } from '@/ai/llm';
import type { TonightSummary, VisibleEntry } from '@/sky/types';

describe('code-first router', () => {
  it('routes where-is questions to find_object', () => {
    expect(route('where is Sirius')).toEqual(['find_object', { name: 'Sirius' }]);
    expect(route("where's the Pleiades tonight")).toEqual([
      'find_object',
      { name: 'Pleiades' },
    ]);
  });

  it('strips friendly lead-ins before routing', () => {
    expect(route('hey! ok aksa - where is Mars')).toEqual([
      'find_object',
      { name: 'Mars' },
    ]);
  });

  it('routes what is up and tonight verdict questions', () => {
    expect(route("what's up")).toEqual(['whats_up', {}]);
    expect(route('how is the sky tonight?')).toEqual(['tonight_verdict', {}]);
    expect(route('is tonight good for stargazing?')).toEqual([
      'tonight_verdict',
      {},
    ]);
  });

  it('routes bright-object identification with direction and height', () => {
    expect(route("what's that bright star in the east low")).toEqual([
      'identify_object',
      { direction: 'east', height: 'low' },
    ]);
  });

  it('returns null for identification without a direction (model asks)', () => {
    expect(route("what's that bright star?")).toBeNull();
  });

  it('returns null for unrelated chat', () => {
    expect(route('do you like pineapple pizza')).toBeNull();
  });
});

describe('parseLooseJson', () => {
  it('parses a plain JSON object', () => {
    expect(parseLooseJson('{"tool":"whats_up","args":{}}')).toEqual({
      tool: 'whats_up',
      args: {},
    });
  });

  it('parses JSON inside code fences', () => {
    expect(
      parseLooseJson('```json\n{"tool": "whats_up"}\n```'),
    ).toEqual({ tool: 'whats_up' });
  });

  it('parses JSON wrapped in prose', () => {
    expect(
      parseLooseJson('Sure! The answer is {"tool": null} as requested.'),
    ).toEqual({ tool: null });
  });

  it('returns null for garbage or non-object JSON', () => {
    expect(parseLooseJson('no json here')).toBeNull();
    expect(parseLooseJson('[1,2,3]')).toBeNull();
    expect(parseLooseJson('')).toBeNull();
  });
});

describe('fallbackText', () => {
  it('joins summary and fact', () => {
    expect(fallbackText({ ok: true, summary: 'Mars rises at 22:10.', fact: 'Mars is the fourth planet.' })).toBe(
      'Mars rises at 22:10.\nFact: Mars is the fourth planet.',
    );
  });

  it('lists ambiguous candidates', () => {
    expect(fallbackText({ ok: false, ambiguous: ['Aldebaran', 'Betelgeuse'] })).toBe(
      'Did you mean Aldebaran or Betelgeuse?',
    );
  });

  it('falls back to the error message, then a default', () => {
    expect(fallbackText({ ok: false, error: 'Not visible tonight.' })).toBe(
      'Not visible tonight.',
    );
    expect(fallbackText({ ok: false })).toBe('No data available.');
  });
});

describe('narrator prompt', () => {
  it('base prompt has no knowledge rule and mentions the Fact rule', () => {
    expect(narratorPrompt()).toContain('Fact:');
    expect(narratorPrompt()).not.toContain('beginner');
  });

  it('appends the knowledge rule for each level', () => {
    const base = narratorPrompt();
    expect(narratorPrompt('beginner')).toContain('beginner');
    expect(narratorPrompt('amateur')).toContain('magnitudes or catalog names');
    expect(narratorPrompt('expert')).toContain('catalog IDs');
    for (const level of ['beginner', 'amateur', 'expert'] as const) {
      expect(narratorPrompt(level).length).toBeGreaterThan(base.length);
    }
  });

  it('router prompt demands JSON only', () => {
    expect(ROUTER_PROMPT).toContain('ONLY a JSON object');
    expect(ROUTER_PROMPT).toContain('{"tool": null}');
  });
});

describe('guide payload text', () => {
  const entry = (over: Partial<VisibleEntry>): VisibleEntry => ({
    kind: 'star',
    name: 'Sirius',
    mag: -1.46,
    best_time: '21:30',
    best_alt: 35,
    compass: 'southeast',
    fists: 3,
    needs: 'eyes',
    fact: 'The brightest star in the night sky.',
    why: 'Brightest star visible from here tonight.',
    ...over,
  });

  const summary: TonightSummary = {
    ok: true,
    summary: 'Clear and moonless.',
    verdict: 'GO',
    score: 78,
    dark: { start: '19:45', end: '05:10', hours: 9.4, kind: 'dark' },
    cloud: 15,
    moon: { phase: 'Waxing crescent', percent_lit: 22, rise: null, set: '21:30' },
    planets: [
      { name: 'Jupiter', best_time: '22:00', compass: 'east', fists: 4 },
    ],
    showers: [],
    reasons: ['Moon sets early'],
    offline: false,
    location: 'Pune',
  };

  const payload: GuidePayload = {
    summary,
    picks: [entry({}), entry({ name: 'M31', kind: 'asterism', mag: 3.4 })],
    cloudFetched: true,
  };

  it('serializes verdict, window, moon, clouds, planets and picks', () => {
    const text = guidePayloadText(payload, 30);
    expect(text).toContain('Verdict: GO (78/100)');
    expect(text).toContain('Dark window: 19:45 to 05:10');
    expect(text).toContain('Waxing crescent, 22% lit');
    expect(text).toContain('Clouds: about 15%');
    expect(text).toContain('Jupiter best 22:00 east 4 fists up');
    expect(text).toContain('Sirius (southeast, 3 fists up');
    expect(text).toContain('Reasons: Moon sets early');
  });

  it('handles missing dark window and cloud data', () => {
    const noDark: GuidePayload = {
      ...payload,
      summary: { ...summary, dark: null, cloud: null, planets: [], reasons: [] },
      picks: [],
    };
    const text = guidePayloadText(noDark, 15);
    expect(text).toContain('Dark window: none tonight');
    expect(text).toContain('Clouds: unknown');
  });

  it('guidePrompt embeds the time budget and the payload', () => {
    const p = guidePrompt('beginner', 30, 'DATA-HERE');
    expect(p).toContain('next 30 minutes');
    expect(p).toContain('DATA-HERE');
    expect(p).toContain('beginner');
  });
});
