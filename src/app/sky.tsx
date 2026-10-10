/**
 * Sky Detective: a live all-sky map. Tap any dot or search a name to open
 * the object screen, where a five-clue guessing ladder is built from
 * computed data. The map recomputes with the store's location and the
 * current minute (nothing persisted).
 */

import { useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Link, Stack, useRouter, useLocalSearchParams } from 'expo-router';
import { SkyMap } from '@/components/SkyMap';
import { useSessionStore } from '@/state/session';
import { buildSkyMapData } from '@/sky/mapData';
import type { SkyContext } from '@/sky/types';

export default function SkyScreen() {
  const location = useSessionStore((s) => s.location);
  const nightMode = useSessionStore((s) => s.nightMode);
  const params = useLocalSearchParams<{ focus?: string }>();
  const router = useRouter();

  const [tick, setTick] = useState(0);
  const [query, setQuery] = useState('');

  // Recompute once a minute so the map stays live.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  const ctx: SkyContext | null = useMemo(
    () =>
      location
        ? { lat: location.lat, lon: location.lon, tz: location.tz, now: new Date(), label: location.label }
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [location?.lat, location?.lon, tick],
  );

  // Map data rebuilt only when location or minute changes; search filters
  // the cached points (rebuilding the full map per keystroke is wasteful).
  const mapData = useMemo(() => (ctx ? buildSkyMapData(ctx) : null), [ctx]);

  const matches = useMemo(() => {
    if (!mapData || !query.trim()) return [];
    const q = query.trim().toLowerCase();
    return mapData.points
      .filter((p) => p.name && p.name.toLowerCase().includes(q))
      .slice(0, 6);
  }, [query, mapData]);

  if (!ctx) {
    return (
      <View style={styles.centerBox}>
        <Text style={styles.dimText}>Waiting for a location fix...</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: nightMode ? 'Sky Detective (red)' : 'Sky Detective' }} />

      {params.focus && (
        <Text style={styles.dimText}>Focused: {decodeURIComponent(String(params.focus))}</Text>
      )}

      <SkyMap
        ctx={ctx}
        size={Math.min(360, 360)}
        selectedId={params.focus ? String(params.focus) : null}
        onPressObject={(p) => {
          if (p.name) router.push(`/object/${encodeURIComponent(p.name)}`);
        }}
      />

      <Text style={styles.dimText}>
        Hold the map like a planisphere above your head: N on top, E on the left when you face north.
        Tap a dot to start a Detective round.
      </Text>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Find an object</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. Orion, Saturn, M31"
          placeholderTextColor="#5A648A"
          value={query}
          autoCapitalize="none"
          onChangeText={setQuery}
        />
        {matches.map((m) => (
          <Link
            key={`${m.kind}:${m.id}`}
            href={`/object/${encodeURIComponent(m.name)}`}
            asChild
          >
            <Pressable style={styles.matchRow}>
              <Text style={styles.body}>
                {m.name}{' '}
                <Text style={styles.dimText}>
                  ({m.kind}, {Math.round(m.alt)}° up)
                </Text>
              </Text>
            </Pressable>
          </Link>
        ))}
        {query.trim() !== '' && !matches.length && (
          <Text style={styles.dimText}>Nothing named like that above your horizon.</Text>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0B1026' },
  content: { padding: 16, gap: 12, paddingBottom: 40 },
  centerBox: { flex: 1, backgroundColor: '#0B1026', alignItems: 'center', justifyContent: 'center' },
  dimText: { color: '#9AA3C0', fontSize: 13, textAlign: 'center' },
  card: { backgroundColor: '#141B33', borderRadius: 16, padding: 16, gap: 8 },
  cardTitle: { color: '#7FD4FF', fontWeight: '700', fontSize: 15 },
  body: { color: '#E8ECFF', fontSize: 15, lineHeight: 21 },
  input: {
    backgroundColor: '#1D2748',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#E8ECFF',
    fontSize: 15,
  },
  matchRow: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#232C4D' },
});
