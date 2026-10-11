/**
 * Tonight screen: the computed verdict (GO/MAYBE/SKIP), the dark window,
 * the Moon, planets, meteor showers, and the "Explain my sky" button
 * that opens the AI Sky Guide.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Link, Stack } from 'expo-router';

import { useSessionStore, type Equipment, type KnowledgeLevel } from '@/state/session';
import { getGpsLocation, getIpLocation, cityLocation, cityNames } from '@/services/location';
import { cloudForDarkWindow } from '@/services/weather';
import { darkWindow, dayPhase, type DayPhase } from '@/sky/astro';
import { tonightSummary } from '@/sky/skyQuery';
import type { SkyContext, TonightSummary } from '@/sky/types';

const VERDICT_COLOR: Record<string, string> = {
  GO: '#4CC38A',
  MAYBE: '#E5C15C',
  SKIP: '#E5646E',
};

const KNOWLEDGE_CHIPS: KnowledgeLevel[] = ['beginner', 'amateur', 'expert'];
const EQUIPMENT_CHIPS: Equipment[] = ['eyes', 'binoculars', 'telescope'];

export default function TonightScreen() {
  const location = useSessionStore((s) => s.location);
  const locationState = useSessionStore((s) => s.locationState);
  const setLocation = useSessionStore((s) => s.setLocation);
  const setLocationState = useSessionStore((s) => s.setLocationState);
  const profile = useSessionStore((s) => s.profile);
  const setProfile = useSessionStore((s) => s.setProfile);
  const activeModel = useSessionStore((s) => s.activeModel);

  const [summary, setSummary] = useState<TonightSummary | null>(null);
  const [phase, setPhase] = useState<DayPhase | null>(null);
  const [busy, setBusy] = useState(false);
  const [cloudPending, setCloudPending] = useState(false);
  const [showPicker, setShowPicker] = useState(false);

  const recompute = useCallback(async (showSpinner = false) => {
    const loc = useSessionStore.getState().location;
    if (!loc) return;
    if (showSpinner) setBusy(true);
    try {
      const ctx: SkyContext = {
        lat: loc.lat,
        lon: loc.lon,
        tz: loc.tz,
        now: new Date(),
        label: loc.label,
      };
      // Show the computed verdict right away; clouds (the only network
      // call) refine it when the forecast arrives.
      setSummary(tonightSummary(ctx, () => null, false));
      setPhase(dayPhase(ctx));
      const preDark = darkWindow(ctx);
      if (!preDark) return;
      setCloudPending(true);
      const preCloud = await cloudForDarkWindow(loc.lat, loc.lon, preDark, ctx.now, loc.tz, false);
      if (preCloud !== null) setSummary(tonightSummary(ctx, () => preCloud, false));
    } finally {
      setCloudPending(false);
      setBusy(false);
    }
  }, []);

  const pickCity = useCallback(
    (city: string) => {
      const loc = cityLocation(city);
      if (!loc) return;
      setLocation(loc);
      setShowPicker(false);
      recompute();
    },
    [recompute, setLocation],
  );

  const useGps = useCallback(async () => {
    setShowPicker(false);
    setLocationState('locating');
    const gps = await getGpsLocation();
    if (gps.ok && gps.loc) {
      setLocation(gps.loc);
      recompute();
    } else {
      setLocationState('denied');
    }
  }, [recompute, setLocation, setLocationState]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!location) {
        setLocationState('locating');
        const gps = await getGpsLocation();
        if (cancelled) return;
        if (gps.ok && gps.loc) {
          setLocation(gps.loc);
        } else {
          // GPS denied: try the IP-based lookup automatically. It gives
          // the country's correct timezone without any permission prompt.
          const ip = await getIpLocation();
          if (cancelled) return;
          if (ip.ok && ip.loc) {
            setLocation(ip.loc);
          } else {
            setLocationState('denied');
            return;
          }
        }
      } else {
        setLocationState('ready');
      }
      await recompute();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the verdict live: recompute once a minute (positions drift).
  useEffect(() => {
    const id = setInterval(() => {
      if (useSessionStore.getState().location) recompute();
    }, 60_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const verdictColor = summary ? VERDICT_COLOR[summary.verdict] ?? '#E8ECFF' : '#E8ECFF';

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={busy}
          onRefresh={() => recompute(true)}
          tintColor="#7FD4FF"
        />
      }
    >
      <Stack.Screen options={{ title: summary ? `AKSA - ${summary.location}` : 'AKSA' }} />

      {locationState === 'locating' && (
        <View style={styles.centerBox}>
          <ActivityIndicator color="#7FD4FF" />
          <Text style={styles.dimText}>Getting a GPS fix (kept in memory only)...</Text>
        </View>
      )}

      {locationState === 'denied' && !summary && (
        <CityPicker
          dismissible={false}
          onPick={pickCity}
          onUseGps={useGps}
        />
      )}

      {!summary && locationState === 'ready' && (
        <View style={styles.centerBox}>
          <ActivityIndicator color="#7FD4FF" />
          <Text style={styles.dimText}>Computing tonight's sky...</Text>
        </View>
      )}

      {summary && (
        <>
          <View style={styles.verdictCard}>
            <Text style={[styles.verdict, { color: verdictColor }]}>
              {summary.verdict} · {summary.score}/100
            </Text>
            <Text style={styles.dimText}>{summary.location}</Text>
          </View>

          {location?.source === 'ip' ? (
            <Pressable style={styles.ipBanner} onPress={() => setShowPicker(true)}>
              <Text style={styles.ipText}>
                Location is approximate (from your network) - tap to change city
              </Text>
            </Pressable>
          ) : null}

          {phase && (
            <View
              style={[
                styles.phaseCard,
                phase.phase === 'night' && styles.phaseNight,
                phase.phase === 'twilight' && styles.phaseTwilight,
              ]}
            >
              <Text style={styles.phaseTitle}>
                {phase.phase === 'day' ? 'Daytime' : phase.phase === 'twilight' ? 'Twilight' : 'Night'}
              </Text>
              <Text style={styles.body}>
                {phase.phase === 'day' && (
                  <>
                    The Sun is {Math.abs(phase.sunAlt)}° above the horizon — nothing to see yet.
                    {summary.dark ? ` Stargazing opens at ${summary.dark.start}.` : ''}
                  </>
                )}
                {phase.phase === 'twilight' && (
                  <>
                    The Sun is {Math.abs(phase.sunAlt)}° below the horizon and the sky is still
                    brightening the view.
                    {summary.dark ? ` Full darkness at ${summary.dark.start}.` : ''}
                  </>
                )}
                {phase.phase === 'night' && (
                  <>
                    The Sun is {Math.abs(phase.sunAlt)}° below the horizon — it is night. All
                    verdicts below describe the sky you can see right now.
                  </>
                )}
              </Text>
            </View>
          )}

          <View style={styles.card}>
            {summary.dark ? (
              <Text style={styles.body}>
                Dark {summary.dark.start} - {summary.dark.end} ({summary.dark.hours} h,{' '}
                {summary.dark.kind})
              </Text>
            ) : (
              <Text style={styles.body}>The sky never fully darkens tonight.</Text>
            )}
            <Text style={styles.body}>
              Moon: {summary.moon.phase} ({summary.moon.percent_lit}% lit
              {summary.moon.rise ? `, rises ${summary.moon.rise}` : ''}
              {summary.moon.set ? `, sets ${summary.moon.set}` : ''})
            </Text>
            <Text style={styles.body}>
              Clouds:{' '}
              {summary.cloud !== null
                ? `about ${summary.cloud}%`
                : cloudPending
                  ? 'checking forecast...'
                  : 'unknown (offline?)'}
            </Text>
            {summary.reasons.map((r) => (
              <Text key={r} style={styles.reason}>
                - {r}
              </Text>
            ))}
          </View>

          {summary.planets.length > 0 && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Planets</Text>
              {summary.planets.map((p) => (
                <Text key={p.name} style={styles.body}>
                  {p.name} - best {p.best_time}, {p.compass}, {p.fists} fists up
                </Text>
              ))}
            </View>
          )}

          {summary.showers.length > 0 && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Meteor showers</Text>
              {summary.showers.map((s) => (
                <Text key={s.name} style={styles.body}>
                  {s.name} - peak in {s.days_to_peak} day(s), ZHR ~{s.zhr}
                </Text>
              ))}
            </View>
          )}

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Tonight I have</Text>
            <View style={styles.chipRow}>
              {(['10', '30', '60'] as const).map((m) => (
                <Chip
                  key={m}
                  label={`${m} min`}
                  active={profile.minutes === Number(m)}
                  onPress={() => setProfile({ minutes: Number(m) })}
                />
              ))}
            </View>
            <View style={styles.chipRow}>
              {EQUIPMENT_CHIPS.map((e) => (
                <Chip
                  key={e}
                  label={e}
                  active={profile.equipment === e}
                  onPress={() => setProfile({ equipment: e })}
                />
              ))}
            </View>
            <View style={styles.chipRow}>
              {KNOWLEDGE_CHIPS.map((k) => (
                <Chip
                  key={k}
                  label={k}
                  active={profile.knowledge === k}
                  onPress={() => setProfile({ knowledge: k })}
                />
              ))}
            </View>
          </View>

          <Link href="/guide" asChild>
            <Pressable style={styles.primaryButton}>
              <Text style={styles.primaryButtonText}>Explain my sky</Text>
            </Pressable>
          </Link>

          <Link href="/chat" asChild>
            <Pressable style={styles.linkButton}>
              <Text style={styles.linkText}>AI Chat</Text>
            </Pressable>
          </Link>
          <View style={styles.linkRow}>
            <Link href="/sky" asChild>
              <Pressable style={styles.linkButton}>
                <Text style={styles.linkText}>Sky Detective</Text>
              </Pressable>
            </Link>
            <Link href="/missions" asChild>
              <Pressable style={styles.linkButton}>
                <Text style={styles.linkText}>Missions</Text>
              </Pressable>
            </Link>
            <Link href="/models" asChild>
              <Pressable style={styles.linkButton}>
                <Text style={styles.linkText}>Models</Text>
              </Pressable>
            </Link>
          </View>

          {showPicker && (
            <CityPicker dismissible onClose={() => setShowPicker(false)} onPick={pickCity} onUseGps={useGps} />
          )}

          <View style={styles.linkRow}>
            <Pressable style={styles.linkButton} onPress={() => setShowPicker((v) => !v)}>
              <Text style={styles.linkText}>{showPicker ? 'Hide city list' : 'Change city'}</Text>
            </Pressable>
          </View>

          {!activeModel && (
            <Text style={styles.dimText}>
              No AI model loaded (see Models) -
              running with template answers.
            </Text>
          )}
        </>
      )}
    </ScrollView>
  );
}

function Chip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable style={[styles.chip, active && styles.chipActive]} onPress={onPress}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

function CityPicker({
  onPick,
  onUseGps,
  onClose,
  dismissible = false,
}: {
  onPick: (city: string) => void;
  onUseGps?: () => void;
  onClose?: () => void;
  dismissible?: boolean;
}) {
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const matches = (needle
    ? cityNames().filter((c) => c.toLowerCase().includes(needle))
    : cityNames()
  ).slice(0, 8);
  return (
    <View style={styles.card}>
      <View style={styles.pickerHeader}>
        <Text style={styles.cardTitle}>{dismissible ? 'Change city' : 'Pick a city (GPS denied)'}</Text>
        {dismissible && onClose && (
          <Pressable onPress={onClose}>
            <Text style={styles.dimText}>Close</Text>
          </Pressable>
        )}
      </View>
      <TextInput
        style={styles.input}
        placeholder="e.g. Pune"
        placeholderTextColor="#5A648A"
        value={query}
        autoCapitalize="words"
        onChangeText={setQuery}
      />
      {matches.map((c) => (
        <Pressable key={c} style={styles.cityRow} onPress={() => onPick(c)}>
          <Text style={styles.body}>{c}</Text>
        </Pressable>
      ))}
      {needle.length > 0 && matches.length === 0 ? (
        <Text style={styles.dimText}>No city by that name in the catalog.</Text>
      ) : null}
      {onUseGps ? (
        <Pressable style={styles.gpsButton} onPress={onUseGps}>
          <Text style={styles.gpsText}>Use my GPS instead</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0B1026' },
  content: { padding: 16, gap: 12, paddingBottom: 40 },
  centerBox: { alignItems: 'center', gap: 10, paddingVertical: 40 },
  verdictCard: {
    backgroundColor: '#141B33',
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    gap: 6,
  },
  verdict: { fontSize: 32, fontWeight: '800' },
  phaseCard: {
    backgroundColor: '#141B33',
    borderLeftWidth: 3,
    borderLeftColor: '#E5C15C',
    borderRadius: 12,
    padding: 14,
    gap: 4,
  },
  phaseTwilight: { borderLeftColor: '#E58A5C' },
  phaseNight: { borderLeftColor: '#4CC38A' },
  ipBanner: {
    backgroundColor: '#2A2413',
    borderColor: '#E5C15C',
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
    alignItems: 'center',
  },
  ipText: { color: '#E5C15C', fontSize: 13, fontWeight: '600', textAlign: 'center' },
  phaseTitle: { color: '#7FD4FF', fontWeight: '700', fontSize: 13, letterSpacing: 1 },
  card: {
    backgroundColor: '#141B33',
    borderRadius: 16,
    padding: 16,
    gap: 6,
  },
  cardTitle: { color: '#7FD4FF', fontWeight: '700', fontSize: 15 },
  body: { color: '#E8ECFF', fontSize: 15, lineHeight: 21 },
  reason: { color: '#9AA3C0', fontSize: 13 },
  dimText: { color: '#9AA3C0', fontSize: 14, textAlign: 'center' },
  chipRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 4 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#1D2748',
  },
  chipActive: { backgroundColor: '#7FD4FF' },
  chipText: { color: '#E8ECFF', fontSize: 13 },
  chipTextActive: { color: '#0B1026', fontWeight: '700' },
  input: {
    backgroundColor: '#1D2748',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#E8ECFF',
    fontSize: 15,
  },
  cityRow: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#232C4D' },
  pickerHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  gpsButton: {
    backgroundColor: '#1D2748',
    borderRadius: 10,
    padding: 10,
    alignItems: 'center',
    marginTop: 4,
  },
  gpsText: { color: '#7FD4FF', fontWeight: '600' },
  primaryButton: {
    backgroundColor: '#7FD4FF',
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
    marginTop: 4,
  },
  primaryButtonText: { color: '#0B1026', fontWeight: '800', fontSize: 16 },
  linkRow: { flexDirection: 'row', gap: 8 },
  linkButton: {
    flex: 1,
    backgroundColor: '#1D2748',
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
  },
  linkText: { color: '#7FD4FF', fontWeight: '600' },
});