/**
 * AI Sky Guide: opens with tonight's computed plan (verdict + best picks),
 * then a grounded follow-up chat. The local model only phrases; every
 * fact comes from the tool functions in skyQuery. No model -> the same
 * payload shows as clean template text.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
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
import { Stack } from 'expo-router';
import { useSessionStore } from '@/state/session';
import { buildGuidePayload, guidePayloadText, type GuidePayload } from '@/sky/guide';
import { route } from '@/sky/intent';
import { guidePrompt } from '@/ai/prompts';
import { ensureAiReady, generate } from '@/ai/llm';
import { fallbackText, makeToolRunner, respond } from '@/ai/router';
import type { SkyContext } from '@/sky/types';

export default function GuideScreen() {
  const location = useSessionStore((s) => s.location);
  const profile = useSessionStore((s) => s.profile);
  const guideChat = useSessionStore((s) => s.guideChat);
  const pushGuideChat = useSessionStore((s) => s.pushGuideChat);
  const resetGuideChat = useSessionStore((s) => s.resetGuideChat);

  const [payload, setPayload] = useState<GuidePayload | null>(null);
  const [planText, setPlanText] = useState<string>('');
  const [streaming, setStreaming] = useState(false);
  const [input, setInput] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const explainedOnce = useRef(false);
  const scrollRef = useRef<ScrollView>(null);

  const skyCtx: SkyContext | null = location
    ? { lat: location.lat, lon: location.lon, tz: location.tz, now: new Date(), label: location.label }
    : null;

  useEffect(() => {
    if (!location) return;
    let cancelled = false;
    (async () => {
      const built = await buildGuidePayload(
        {
          lat: location.lat,
          lon: location.lon,
          tz: location.tz,
          now: new Date(),
          label: location.label,
        },
        profile.equipment,
        profile.minutes,
      );
      if (cancelled) return;
      setPayload(built);
      setPlanText(guidePayloadText(built, profile.minutes));
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location?.lat, profile.equipment, profile.minutes]);

  /** First-open "Explain my sky": model-phrased plan or the template text. */
  const explainSky = useCallback(async () => {
    if (!payload) return;
    const ready = await ensureAiReady();
    if (!ready) {
      setNotice('No AI model loaded - showing the computed plan as-is. Load one from the Models screen.');
      return;
    }
    setStreaming(true);
    setPlanText('');
    const result = await generate({
      messages: [
        {
          role: 'system',
          content: guidePrompt(profile.knowledge, profile.minutes, guidePayloadText(payload, profile.minutes)),
        },
      ],
      temperature: 0.2,
      maxTokens: 220,
      onToken: (partial) => setPlanText(partial),
    });
    setStreaming(false);
    if (result?.text) {
      setPlanText(result.text);
      setNotice(null);
    } else {
      setPlanText(guidePayloadText(payload, profile.minutes));
      setNotice('The model could not phrase the plan - computed text shown.');
    }
  }, [payload, profile.knowledge, profile.minutes]);

  useEffect(() => {
    if (payload && !explainedOnce.current) {
      explainedOnce.current = true;
      explainSky();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload]);

  const send = useCallback(async () => {
    const question = input.trim();
    if (!question || streaming || !skyCtx) return;
    setInput('');
    pushGuideChat({ role: 'user', content: question });

    const ctx: SkyContext = { ...skyCtx, now: new Date() };
    const runTool = makeToolRunner(ctx, (start, end) => {
      // Follow-up verdicts reuse the cloud figure fetched for the plan.
      return payload?.summary.dark?.start === start && payload?.summary.dark?.end === end
        ? payload.summary.cloud
        : undefined;
    });

    // Template mode: run the matching tool and show the computed text.
    if (!(await ensureAiReady())) {
      const routed = route(question);
      const result = routed ? runTool(routed[0], routed[1]) : null;
      const text = result
        ? fallbackText(result)
        : 'No AI model loaded (see the Models screen). Computed questions like "where is Sirius" still work.';
      pushGuideChat({ role: 'assistant', content: text });
      return;
    }

    setStreaming(true);
    try {
      const answer = await respond(question, runTool, {
        locationLine: skyCtx.label ? ` The observer's location is ${skyCtx.label}.` : '',
        knowledge: profile.knowledge,
        history: useSessionStore.getState().guideChat,
      });
      pushGuideChat({ role: 'assistant', content: answer || 'Something went wrong - try again.' });
    } catch {
      pushGuideChat({ role: 'assistant', content: 'Something went wrong - try again.' });
    } finally {
      setStreaming(false);
    }
  }, [input, streaming, skyCtx, payload, pushGuideChat, profile.knowledge]);

  if (!location || !skyCtx) {
    return (
      <View style={styles.centerBox}>
        <Text style={styles.dimText}>Waiting for a location fix...</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Stack.Screen options={{ title: 'Sky Guide' }} />

      {payload && (
        <View style={styles.planCard}>
          <Text style={styles.cardTitle}>Tonight (computed)</Text>
          <Text style={styles.planText}>{streaming && planText ? planText : planText || 'Thinking...'}</Text>
          {payload.picks.length > 0 && (
            <View style={styles.pickRow}>
              {payload.picks.map((p) => (
                <View key={`${p.kind}:${p.name}`} style={styles.pickChip}>
                  <Text style={styles.pickText}>
                    {p.name} - {p.compass}, {p.fists} fists
                  </Text>
                </View>
              ))}
            </View>
          )}
        </View>
      )}

      <ScrollView
        style={styles.chatScroll}
        ref={scrollRef}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
        contentContainerStyle={styles.chatContent}
      >
        {guideChat.map((m, i) => (
          <View key={i} style={[styles.bubble, m.role === 'user' ? styles.bubbleUser : styles.bubbleAksa]}>
            <Text style={styles.bubbleText}>{m.content}</Text>
          </View>
        ))}
        {streaming && <ActivityIndicator color="#7FD4FF" />}
        {notice && <Text style={styles.notice}>{notice}</Text>}
      </ScrollView>

      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          placeholder="Ask about tonight's sky..."
          placeholderTextColor="#5A648A"
          value={input}
          onChangeText={setInput}
          onSubmitEditing={send}
        />
        <Pressable style={styles.sendBtn} onPress={send} disabled={streaming}>
          <Text style={styles.sendText}>Send</Text>
        </Pressable>
        {guideChat.length > 0 && (
          <Pressable style={styles.clearBtn} onPress={resetGuideChat} disabled={streaming}>
            <Text style={styles.clearText}>Clear</Text>
          </Pressable>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0B1026' },
  centerBox: { flex: 1, backgroundColor: '#0B1026', alignItems: 'center', justifyContent: 'center' },
  dimText: { color: '#9AA3C0', fontSize: 14, textAlign: 'center' },
  planCard: {
    backgroundColor: '#141B33',
    borderRadius: 16,
    padding: 16,
    margin: 12,
    gap: 6,
  },
  cardTitle: { color: '#7FD4FF', fontWeight: '700', fontSize: 15 },
  planText: { color: '#E8ECFF', fontSize: 15, lineHeight: 21 },
  pickRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  pickChip: {
    backgroundColor: '#1D2748',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  pickText: { color: '#E8ECFF', fontSize: 12 },
  chatScroll: { flex: 1 },
  chatContent: { padding: 12, gap: 8 },
  bubble: {
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
    maxWidth: '85%',
  },
  bubbleUser: { backgroundColor: '#2A3A6E', alignSelf: 'flex-end' },
  bubbleAksa: { backgroundColor: '#141B33', alignSelf: 'flex-start' },
  bubbleText: { color: '#E8ECFF', fontSize: 15, lineHeight: 20 },
  notice: { color: '#E5C15C', fontSize: 13, textAlign: 'center', paddingVertical: 6 },
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
  clearBtn: {
    backgroundColor: '#1D2748',
    borderRadius: 12,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clearText: { color: '#9AA3C0', fontWeight: '600', fontSize: 13 },
});
