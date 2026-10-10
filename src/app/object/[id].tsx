/**
 * Object screen: full computed detail for one object (position, tonight,
 * what you need, fact) plus the Sky Detective clue ladder ("Next clue")
 * and an "Ask AKSA" grounded chat about this object.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useSessionStore } from '@/state/session';
import { findObject } from '@/sky/skyQuery';
import { buildClues, clueFor } from '@/sky/clues';
import { NARRATOR_PROMPT } from '@/ai/prompts';
import { ensureAiReady, generate } from '@/ai/llm';
import { fallbackText } from '@/ai/router';
import type { FindObjectResult } from '@/sky/skyQuery';
import type { SkyContext } from '@/sky/types';

export default function ObjectScreen() {
  const raw = useLocalSearchParams<{ id?: string }>();
  const name = raw.id ? decodeURIComponent(String(raw.id)) : '';
  const location = useSessionStore((s) => s.location);
  const profile = useSessionStore((s) => s.profile);
  const clueProgress = useSessionStore((s) => s.clueProgress);
  const revealClue = useSessionStore((s) => s.revealClue);

  const [result, setResult] = useState<FindObjectResult | null>(null);
  const [clueText, setClueText] = useState<string | null>(null);
  const [chat, setChat] = useState<{ role: 'user' | 'assistant'; content: string }[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const chatedOnce = useRef(false);

  const ctx: SkyContext | null = useMemo(
    () =>
      location
        ? { lat: location.lat, lon: location.lon, tz: location.tz, now: new Date(), label: location.label }
        : null,
    [location?.lat, location?.lon],
  );

  useEffect(() => {
    if (!ctx || !name) return;
    const found = findObject(name, ctx);
    setResult(found);
    setClueText(null);
  }, [ctx, name]);

  const revealed = clueProgress[name] ?? 0;
  // Clue ladder is expensive (findObject + nearbyObjects) - build once
  // per object/location, not on every render.
  const clues = useMemo(() => (ctx ? buildClues(name, ctx) : null), [ctx, name]);

  const nextClue = useCallback(() => {
    if (!ctx || !clues) return;
    const clue = clueFor(name, ctx, revealed);
    if (!clue) return;
    setClueText(clue.text);
    revealClue(name, Math.min(revealed + 1, 4));
    // Model phrasing of the clue (best effort, template text is kept).
    ensureAiReady().then((ready) => {
      if (!ready) return;
      generate({
        messages: [
          { role: 'system', content: NARRATOR_PROMPT },
          { role: 'user', content: `Rephrase this stargazing clue warmly, same meaning: "${clue.text}"` },
        ],
        temperature: 0.4,
        maxTokens: 120,
        onToken: (partial) => setClueText(partial),
      });
    });
  }, [ctx, clues, name, revealed, revealClue]);

  const ask = useCallback(async () => {
    const question = input.trim();
    if (!question || streaming || !ctx) return;
    setInput('');
    setChat((c) => [...c, { role: 'user', content: question }]);

    const factPayload = result?.ok ? JSON.stringify(result) : 'object not visible';
    const messages = [
      { role: 'system' as const, content: NARRATOR_PROMPT },
      {
        role: 'user' as const,
        content: `Question: ${question}\n\nComputed data:\n${factPayload}`,
      },
    ];

    if (!(await ensureAiReady())) {
      setChat((c) => [
        ...c,
        { role: 'assistant', content: fallbackText((result ?? { ok: false }) as unknown as Record<string, unknown>) },
      ]);
      return;
    }

    setStreaming(true);
    let partial = '';
    const answer = await generate({
      messages,
      temperature: 0.2,
      maxTokens: 220,
      onToken: (p) => {
        partial = p;
        setChat((c) => {
          const last = c[c.length - 1];
          if (last?.role === 'assistant' && last.content !== partial) {
            return [...c.slice(0, -1), { role: 'assistant', content: partial }];
          }
          return [...c, { role: 'assistant', content: partial }];
        });
      },
    });
    setStreaming(false);
    if (answer?.text) {
      setChat((c) => {
        const withoutPartial = c[c.length - 1]?.role === 'assistant' ? c.slice(0, -1) : c;
        return [...withoutPartial, { role: 'assistant', content: answer.text }];
      });
    }
  }, [input, streaming, ctx, result]);

  if (!name) {
    return (
      <View style={styles.centerBox}>
        <Text style={styles.dimText}>No object selected.</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen options={{ title: name }} />
      <ScrollView contentContainerStyle={styles.content}>
        {!result && (
          <View style={styles.centerBox}>
            <ActivityIndicator color="#7FD4FF" />
            <Text style={styles.dimText}>Computing {name}...</Text>
          </View>
        )}

        {result && !result.ok && (
          <View style={styles.card}>
            <Text style={styles.body}>{fallbackText(result as unknown as Record<string, unknown>)}</Text>
          </View>
        )}

        {result?.ok && (
          <>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>{result.object?.name ?? name}</Text>
              <Text style={styles.body}>{result.summary}</Text>
              {result.needs && <Text style={styles.dimText}>Needs: {result.needs}</Text>}
              {result.fact ? <Text style={styles.factText}>Fact: {result.fact}</Text> : null}
              {result.hop ? <Text style={styles.dimText}>{result.hop}</Text> : null}
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Sky Detective</Text>
              {clueText ? (
                <Text style={styles.body}>{clueText}</Text>
              ) : (
                <Text style={styles.dimText}>
                  Don&apos;t know what you&apos;re looking at? Get a clue without the name.
                </Text>
              )}
              {clues && revealed < clues.length - 1 ? (
                <Pressable style={styles.primaryButton} onPress={nextClue}>
                  <Text style={styles.primaryButtonText}>
                    {clueText ? 'Next clue' : 'Give me a clue'}
                  </Text>
                </Pressable>
              ) : (
                <Text style={styles.dimText}>That&apos;s the full reveal - well spotted.</Text>
              )}
            </View>

            {chat.map((m, i) => (
              <View key={i} style={[styles.bubble, m.role === 'user' ? styles.bubbleUser : styles.bubbleAksa]}>
                <Text style={styles.bubbleText}>{m.content}</Text>
              </View>
            ))}
            {streaming && <ActivityIndicator color="#7FD4FF" />}
          </>
        )}
      </ScrollView>

      {result?.ok && (
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            placeholder={`Ask about ${name}...`}
            placeholderTextColor="#5A648A"
            value={input}
            onChangeText={setInput}
            onSubmitEditing={ask}
          />
          <Pressable style={styles.sendBtn} onPress={ask} disabled={streaming}>
            <Text style={styles.sendText}>Ask</Text>
          </Pressable>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0B1026' },
  content: { padding: 16, gap: 12, paddingBottom: 24 },
  centerBox: { alignItems: 'center', gap: 10, paddingVertical: 40 },
  dimText: { color: '#9AA3C0', fontSize: 13, textAlign: 'center' },
  card: { backgroundColor: '#141B33', borderRadius: 16, padding: 16, gap: 8 },
  cardTitle: { color: '#7FD4FF', fontWeight: '700', fontSize: 15 },
  body: { color: '#E8ECFF', fontSize: 15, lineHeight: 21 },
  factText: { color: '#E5C15C', fontSize: 14, lineHeight: 20 },
  primaryButton: { backgroundColor: '#7FD4FF', borderRadius: 14, padding: 14, alignItems: 'center' },
  primaryButtonText: { color: '#0B1026', fontWeight: '800' },
  bubble: { borderRadius: 14, paddingHorizontal: 12, paddingVertical: 8, maxWidth: '85%' },
  bubbleUser: { backgroundColor: '#2A3A6E', alignSelf: 'flex-end' },
  bubbleAksa: { backgroundColor: '#141B33', alignSelf: 'flex-start' },
  bubbleText: { color: '#E8ECFF', fontSize: 15, lineHeight: 20 },
  inputRow: {
    flexDirection: 'row',
    gap: 8,
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: '#232C4D',
  },
  input: {
    flex: 1,
    backgroundColor: '#1D2748',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#E8ECFF',
    fontSize: 15,
  },
  sendBtn: {
    backgroundColor: '#7FD4FF',
    borderRadius: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendText: { color: '#0B1026', fontWeight: '800' },
});
