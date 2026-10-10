/**
 * Stargazing Missions: one chain of three verified steps for tonight.
 * "Found it" advances; "Stuck" walks the Detective clue ladder for that
 * step's target. Progress lives in the session store only.
 */

import { useEffect, useMemo, useState } from 'react';
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
import { buildTonightMission } from '@/sky/missions';
import { clueFor } from '@/sky/clues';
import type { SkyContext } from '@/sky/types';

export default function MissionsScreen() {
  const location = useSessionStore((s) => s.location);
  const profile = useSessionStore((s) => s.profile);
  const mission = useSessionStore((s) => s.mission);
  const setMission = useSessionStore((s) => s.setMission);
  const completeMissionStep = useSessionStore((s) => s.completeMissionStep);
  const resetMission = useSessionStore((s) => s.resetMission);

  const [loading, setLoading] = useState(true);
  const [hint, setHint] = useState<string | null>(null);
  const router = useRouter();

  const ctx: SkyContext | null = useMemo(
    () =>
      location
        ? { lat: location.lat, lon: location.lon, tz: location.tz, now: new Date(), label: location.label }
        : null,
    [location?.lat, location?.lon],
  );

  // Build a fresh mission when none is running for this location.
  useEffect(() => {
    if (!ctx) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      const m = mission ?? buildTonightMission(ctx, {
        minutes: profile.minutes,
        equipment: profile.equipment,
        difficulty: 'any',
      });
      if (!cancelled) {
        setMission(m);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, mission === null]);

  const currentStep = mission && mission.doneSteps.length < mission.steps.length
    ? mission.steps[mission.doneSteps.length]
    : null;

  const stuck = () => {
    if (!ctx || !currentStep) return;
    const clue = clueFor(currentStep.targetName, ctx, 0);
    setHint(clue ? clue.text : 'No clue ladder for this target - check the map instead.');
    // Jump to the object screen for the full clue ladder + Ask chat.
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
        <Pressable style={styles.primaryButton} onPress={resetMission}>
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
      </View>

      {mission.steps.map((step, i) => {
        const done = mission.doneSteps.includes(i);
        const isCurrent = currentStep === step;
        return (
          <View key={i} style={[styles.card, isCurrent && styles.cardCurrent]}>
            <Text style={styles.stepLabel}>
              Step {i + 1} - {step.kind}
              {done ? '  ✓' : ''}
            </Text>
            <Text style={styles.body}>{step.title}</Text>
            <Text style={styles.dimText}>{step.detail}</Text>
            {isCurrent && !done && (
              <View style={styles.actionRow}>
                <Pressable
                  style={styles.primaryButton}
                  onPress={() => completeMissionStep(i)}
                >
                  <Text style={styles.primaryButtonText}>Found it</Text>
                </Pressable>
                <Pressable style={styles.stuckButton} onPress={stuck}>
                  <Text style={styles.stuckText}>Stuck - show clue</Text>
                </Pressable>
              </View>
            )}
            {isCurrent && hint && !done && <Text style={styles.hint}>{hint}</Text>}
          </View>
        );
      })}

      {mission.doneSteps.length === mission.steps.length && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Mission complete!</Text>
          <Text style={styles.body}>
            All steps found. Progress clears when you close the app - no journal,
            just tonight.
          </Text>
          <Pressable style={styles.primaryButton} onPress={resetMission}>
            <Text style={styles.primaryButtonText}>New mission</Text>
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
  cardTitle: { color: '#7FD4FF', fontWeight: '700', fontSize: 15 },
  body: { color: '#E8ECFF', fontSize: 15, lineHeight: 21 },
  dimText: { color: '#9AA3C0', fontSize: 13 },
  stepLabel: { color: '#7FD4FF', fontWeight: '700', fontSize: 13 },
  actionRow: { flexDirection: 'row', gap: 8, marginTop: 6 },
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
  hint: { color: '#E5C15C', fontSize: 14, lineHeight: 20 },
});
