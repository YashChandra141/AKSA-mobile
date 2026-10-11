/**
 * Stargazing Missions: one chain of three verified steps for tonight.
 * With an AI backend, missions are random challenges drawn from what is
 * actually up at the observer's location; without one, the curated
 * challenges.json chain is used. "Found it" advances; "Stuck" opens the
 * Detective clue ladder for that step's target. Progress lives in the
 * session store only.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSessionStore } from '@/state/session';
import {
  buildRandomMission,
  buildTonightMission,
  missionPayloadText,
  type MissionOptions,
} from '@/sky/missions';
import { missionCompletePrompt } from '@/ai/prompts';
import { ensureAiReady, generate } from '@/ai/llm';
import type { SkyContext } from '@/sky/types';

export default function MissionsScreen() {
  const location = useSessionStore((s) => s.location);
  const profile = useSessionStore((s) => s.profile);
  const mission = useSessionStore((s) => s.mission);
  const setMission = useSessionStore((s) => s.setMission);
  const completeMissionStep = useSessionStore((s) => s.completeMissionStep);

  const [loading, setLoading] = useState(true);
  const [aiReady, setAiReady] = useState<boolean | null>(null);
  const [rebuild, setRebuild] = useState(0);
  const [completeText, setCompleteText] = useState<string | null>(null);
  const [phrasing, setPhrasing] = useState(false);
  const phrasedFor = useRef<string | null>(null);
  const router = useRouter();

  const ctx: SkyContext | null = useMemo(
    () =>
      location
        ? { lat: location.lat, lon: location.lon, tz: location.tz, now: new Date(), label: location.label }
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [location?.lat, location?.lon, rebuild],
  );

  const options: MissionOptions = useMemo(
    () => ({ minutes: profile.minutes, equipment: profile.equipment, difficulty: 'any' }),
    [profile.minutes, profile.equipment],
  );

  useEffect(() => {
    let cancelled = false;
    ensureAiReady()
      .then((ready) => {
        if (!cancelled) setAiReady(ready);
      })
      .catch(() => {
        if (!cancelled) setAiReady(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Build a mission once the AI probe has answered (so the first mission
  // is already the right kind) and whenever a rebuild is requested.
  useEffect(() => {
    if (!ctx || aiReady === null) return;
    if (mission && rebuild === 0) {
      setLoading(false);
      return;
    }
    const m = (aiReady ? buildRandomMission(ctx, options) : null) ?? buildTonightMission(ctx, options);
    setMission(m);
    setCompleteText(null);
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, aiReady]);

  const newMission = () => {
    phrasedFor.current = null;
    setLoading(true);
    setRebuild((n) => n + 1);
  };

  const shuffleMission = () => {
    if (!ctx) return;
    phrasedFor.current = null;
    setCompleteText(null);
    setMission(buildRandomMission(ctx, options) ?? buildTonightMission(ctx, options));
  };

  const missionDone = !!mission && mission.steps.length > 0 && mission.doneSteps.length === mission.steps.length;

  useEffect(() => {
    if (!missionDone || !mission || !aiReady) return;
    if (phrasedFor.current === mission.id) return;
    phrasedFor.current = mission.id;
    let cancelled = false;
    setPhrasing(true);
    generate({
      messages: [
        { role: 'system', content: missionCompletePrompt(profile.knowledge, missionPayloadText(mission)) },
      ],
      temperature: 0.5,
      maxTokens: 120,
    })
      .then((result) => {
        if (!cancelled && result?.text) setCompleteText(result.text);
      })
      .finally(() => {
        if (!cancelled) setPhrasing(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missionDone, mission?.id, aiReady]);

  const currentIndex = mission && !missionDone ? mission.doneSteps.length : -1;
  const currentStep = mission && currentIndex >= 0 ? mission.steps[currentIndex] : null;

  const stuck = () => {
    if (!currentStep) return;
    router.push(`/object/${encodeURIComponent(currentStep.targetName)}`);
  };

  if (!ctx || loading) {
    return (
      <View style={styles.centerBox}>
        <ActivityIndicator color="#7FD4FF" />
        <Text style={styles.dimText}>Building tonight&apos;s mission...</Text>
      </View>
    );
  }

  if (!mission) {
    return (
      <View style={styles.centerBox}>
        <Text style={styles.body}>
          Nothing observable for your equipment in the next {profile.minutes} minutes.
          Try again after dark or with binoculars.
        </Text>
        <Pressable style={styles.primaryButton} onPress={newMission}>
          <Text style={styles.primaryButtonText}>Rebuild mission</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: 'Missions' }} />

      <View style={styles.card}>
        <Text style={styles.cardTitle}>{mission.title}</Text>
        <Text style={styles.dimText}>
          {mission.difficulty} · {mission.steps.length} steps · for {mission.equipment}
        </Text>
        <Text style={styles.dimText}>
          {aiReady
            ? 'Random challenges picked from what is up at your location right now.'
            : 'Curated mission. Load an AI model from the Models screen for random challenges.'}
        </Text>
        <Pressable style={styles.shuffleButton} onPress={shuffleMission}>
          <Text style={styles.shuffleText}>Shuffle challenges</Text>
        </Pressable>
      </View>

      {mission.steps.map((step, i) => {
        const done = mission.doneSteps.includes(i);
        const isCurrent = i === currentIndex;
        return (
          <View key={`${mission.id}:${i}`} style={[styles.card, isCurrent && styles.cardCurrent]}>
            <Text style={styles.stepLabel}>
              Step {i + 1} - {step.kind}
              {done ? '  ✓' : ''}
            </Text>
            <Text style={styles.body}>{step.title}</Text>
            <Text style={styles.dimText}>{step.detail}</Text>
            {isCurrent && (
              <View style={styles.actionRow}>
                <Pressable style={styles.primaryButton} onPress={() => completeMissionStep(i)}>
                  <Text style={styles.primaryButtonText}>Found it</Text>
                </Pressable>
                <Pressable style={styles.stuckButton} onPress={stuck}>
                  <Text style={styles.stuckText}>Stuck - show clue</Text>
                </Pressable>
              </View>
            )}
          </View>
        );
      })}

      {missionDone && (
        <View style={[styles.card, styles.doneCard]}>
          <Text style={styles.cardTitle}>Mission complete!</Text>
          {phrasing && !completeText && (
            <View style={styles.phrasingRow}>
              <ActivityIndicator color="#7FD4FF" />
              <Text style={styles.dimText}>AKSA is writing your congratulations...</Text>
            </View>
          )}
          <Text style={styles.body}>
            {completeText ??
              'All steps found. Progress clears when you close the app - no journal, just tonight.'}
          </Text>
          <Pressable style={styles.primaryButton} onPress={newMission}>
            <Text style={styles.primaryButtonText}>
              {aiReady ? 'New random challenge' : 'New mission'}
            </Text>
          </Pressable>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0B1026' },
  content: { padding: 16, gap: 12, paddingBottom: 40 },
  centerBox: { flex: 1, backgroundColor: '#0B1026', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  card: { backgroundColor: '#141B33', borderRadius: 16, padding: 16, gap: 6 },
  cardCurrent: { borderColor: '#7FD4FF', borderWidth: 1 },
  doneCard: { borderColor: '#4CC38A', borderWidth: 1 },
  cardTitle: { color: '#7FD4FF', fontWeight: '700', fontSize: 15 },
  body: { color: '#E8ECFF', fontSize: 15, lineHeight: 21 },
  dimText: { color: '#9AA3C0', fontSize: 13 },
  stepLabel: { color: '#7FD4FF', fontWeight: '700', fontSize: 13 },
  actionRow: { flexDirection: 'row', gap: 8, marginTop: 6 },
  phrasingRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  primaryButton: {
    backgroundColor: '#7FD4FF',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 18,
    alignItems: 'center',
  },
  primaryButtonText: { color: '#0B1026', fontWeight: '800' },
  stuckButton: {
    backgroundColor: '#2A1B2A',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  stuckText: { color: '#E5646E', fontWeight: '700' },
  shuffleButton: {
    backgroundColor: '#1D2748',
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: 'center',
    marginTop: 4,
  },
  shuffleText: { color: '#7FD4FF', fontWeight: '600' },
});
