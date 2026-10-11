/**
 * Model manager: lists .gguf files found in the app models/ folder,
 * imports a folder via the system picker, downloads the recommended
 * model with progress, and activates one for AI phrasing. Everything
 * here re-scans per launch - nothing is persisted.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Stack } from 'expo-router';
import Constants from 'expo-constants';
import {
  autoSelect,
  deleteModel,
  fmtSize,
  RECOMMENDED_MODEL,
  rescanAndSelect,
  scanPickedFolder,
  SMALL_MODEL,
  type LocalModelInfo,
  type ModelSpec,
} from '@/ai/models';
import {
  cancelModelDownload,
  downloadSnapshot,
  startModelDownload,
  subscribeDownload,
} from '@/ai/download';
import { ensureOllama } from '@/ai/llm';
import { useSessionStore } from '@/state/session';

export default function ModelsScreen() {
  const activeModel = useSessionStore((s) => s.activeModel);
  const setActiveModel = useSessionStore((s) => s.setActiveModel);

  const [models, setModels] = useState<LocalModelInfo[] | null>(null);
  const [scanning, setScanning] = useState(false);
  // Download state lives in a module-level manager: navigating away from
  // this screen (or re-entering it) never cancels the download.
  const download = useSyncExternalStore(subscribeDownload, downloadSnapshot);
  const [status, setStatus] = useState<string | null>(null);
  const [ollamaModel, setOllamaModel] = useState<string | null>(null);
  // Downloaded results already merged into the list (paths).
  const mergedRef = useRef<Set<string>>(new Set());

  /** Fire-and-forget load into llama.rn (idempotent if already loaded). */
  const autoLoad = useCallback((m: LocalModelInfo) => {
    (async () => {
      const { activateModel } = await import('@/ai/models');
      const ctx = await activateModel(m);
      if (ctx) {
        setStatus(`${m.name} ready - AI answers are live.`);
      } else {
        setStatus(`Could not load ${m.name} - AI stays on template answers.`);
      }
    })();
  }, []);

  const scan = useCallback(async () => {
    setScanning(true);
    try {
      const { models: found, picked } = await rescanAndSelect();
      setModels(found);
      setActiveModel(picked);
      const ollama = await ensureOllama();
      setOllamaModel(ollama);
      if (found.length) {
        setStatus(`${found.length} model(s) found - using ${picked?.name ?? 'nothing'}`);
      } else if (ollama) {
        setStatus(`No on-device .gguf models - AI phrasing via local Ollama (${ollama}).`);
      } else {
        setStatus('No .gguf models found yet.');
      }
      // Auto-load the picked model so AI features work immediately -
      // downloading/selecting alone never loaded it into the runtime.
      if (picked) autoLoad(picked);
    } finally {
      setScanning(false);
    }
  }, [setActiveModel]);

  useEffect(() => {
    scan();
    // Intentionally NO cleanup that cancels the download: it must keep
    // running when the user navigates away or minimizes the app.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pick up a finished download from the manager (fires on any screen
  // re-entry too, since the manager survives navigation).
  useEffect(() => {
    const res = download.result;
    if (!res || mergedRef.current.has(res.path)) return;
    mergedRef.current.add(res.path);
    setModels((prev) =>
      prev?.some((m) => m.path === res.path) ? prev : [...(prev ?? []), res],
    );
    // Side effects deliberately OUTSIDE the state updater (an updater
    // must stay pure - calling setActiveModel inside one crashes React).
    const current = useSessionStore.getState().activeModel;
    if (!current) setActiveModel(autoSelect([res]) ?? res);
    setStatus(`Downloaded ${res.name} (${fmtSize(res.sizeBytes)})`);
    // The model is useless until llama.rn loads it - do that right away.
    autoLoad(res);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [download.result]);

  const startDownload = (spec: ModelSpec) => {
    if (download.fraction !== null) return;
    setStatus(`Downloading ${spec.name}...`);
    startModelDownload(spec);
  };

  const cancelDownload = () => {
    cancelModelDownload();
    setStatus('Download cancelled.');
  };

  const importFolder = async () => {
    setStatus('Pick the folder that holds your .gguf files...');
    try {
      const found = await scanPickedFolder();
      if (found.length) {
        setModels((prev) => {
          const merged = [
            ...(prev ?? []),
            ...found.filter((f) => !prev?.some((p) => p.path === f.path)),
          ];
          return merged;
        });
        // Pick a sensible active model from what we now know (kept outside
        // the updater - updaters must be pure).
        const active = useSessionStore.getState().activeModel;
        if (!active) {
          const pick = autoSelect(found) ?? null;
          if (pick) {
            setActiveModel(pick);
            autoLoad(pick);
          } else {
            setActiveModel(null);
          }
        }
        setStatus(`Imported ${found.length} model(s) from the picked folder.`);
      } else {
        setStatus('No .gguf files in that folder.');
      }
    } catch {
      setStatus('Folder import cancelled.');
    }
  };

  const activate = async (m: LocalModelInfo) => {
    setActiveModel(m);
    setStatus(`Loading ${m.name}...`);
    const { activateModel } = await import('@/ai/models');
    const ctx = await activateModel(m, (f) =>
      setStatus(`Loading ${m.name}... ${Math.round(f * 100)}%`),
    );
    if (ctx) {
      setStatus(`${m.name} ready.`);
    } else if (Constants.appOwnership === 'expo') {
      setStatus(
        `On-device models cannot load inside Expo Go (they need a native build). AI phrasing is using local Ollama instead.`,
      );
    } else {
      setStatus(`Could not load ${m.name}.`);
    }
  };

  const remove = async (m: LocalModelInfo) => {
    await deleteModel(m);
    if (activeModel?.path === m.path) setActiveModel(null);
    setModels((prev) => prev?.filter((p) => p.path !== m.path) ?? []);
    setStatus(`Deleted ${m.name}.`);
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: 'Models' }} />

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Why a model?</Text>
        <Text style={styles.body}>
          AKSA computes all positions itself. A small local model (from ~258 MB)
          only rephrases the computed data into friendly chat - and everything
          runs on this device, no account needed. Without a model you get the
          same facts in template wording.
        </Text>
      </View>

      {scanning && (
        <View style={styles.centerBox}>
          <ActivityIndicator color="#7FD4FF" />
          <Text style={styles.dimText}>Scanning for .gguf models...</Text>
        </View>
      )}

      {!scanning && ollamaModel && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Dev backend: Ollama</Text>
          <Text style={styles.body}>
            Detected a local Ollama server running <Text style={{ color: '#7FD4FF' }}>{ollamaModel}</Text>{' '}
            on this machine. On web/Expo Go it handles AI phrasing for testing;
            a device build uses the on-device model below instead.
          </Text>
        </View>
      )}

      {models !== null && models.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>On this device</Text>
          {models.map((m) => {
            const active = activeModel?.path === m.path;
            return (
              <View key={m.path} style={styles.modelRow}>
                <Pressable style={styles.modelInfo} onPress={() => activate(m)}>
                  <Text style={[styles.body, active && styles.activeName]}>
                    {m.name} {active ? '  - active' : ''}
                  </Text>
                  <Text style={styles.dimText}>
                    {fmtSize(m.sizeBytes)}
                    {m.hasChatTemplate ? '' : '  (no chat template - phrasing may look odd)'}
                  </Text>
                </Pressable>
                <Pressable style={styles.deleteBtn} onPress={() => remove(m)}>
                  <Text style={styles.deleteText}>Delete</Text>
                </Pressable>
              </View>
            );
          })}
        </View>
      )}

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Download a model</Text>
        <Text style={styles.body}>
          Small models download fast and answer quickly - best for testing. Bigger
          models phrase answers better but take longer to download and load.
        </Text>
        {download.fraction === null ? (
          <View style={{ gap: 8 }}>
            <Pressable style={styles.primaryButton} onPress={() => startDownload(SMALL_MODEL)}>
              <Text style={styles.primaryButtonText}>Fast test model - {SMALL_MODEL.name.replace('-Instruct-Q4_K_M.gguf', '')} ({fmtSize(SMALL_MODEL.sizeBytes)})</Text>
            </Pressable>
            <Pressable style={styles.linkButton} onPress={() => startDownload(RECOMMENDED_MODEL)}>
              <Text style={styles.linkText}>Better quality - Gemma 3 1B ({fmtSize(RECOMMENDED_MODEL.sizeBytes)})</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.progressBox}>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { flex: Math.max(download.fraction, 0.02) }]} />
            </View>
            <Text style={styles.dimText}>
              {download.name} - {Math.round(download.fraction * 100)}% - keeps running while you browse
            </Text>
            <Pressable style={styles.cancelButton} onPress={cancelDownload}>
              <Text style={styles.cancelText}>Cancel download</Text>
            </Pressable>
          </View>
        )}
        <Pressable style={styles.linkButton} onPress={importFolder}>
          <Text style={styles.linkText}>Import a folder of .gguf files</Text>
        </Pressable>
      </View>

      {status && <Text style={styles.statusText}>{status}</Text>}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0B1026' },
  content: { padding: 16, gap: 12, paddingBottom: 40 },
  card: { backgroundColor: '#141B33', borderRadius: 16, padding: 16, gap: 8 },
  cardTitle: { color: '#7FD4FF', fontWeight: '700', fontSize: 15 },
  body: { color: '#E8ECFF', fontSize: 15, lineHeight: 21 },
  dimText: { color: '#9AA3C0', fontSize: 13 },
  centerBox: { alignItems: 'center', gap: 10, paddingVertical: 30 },
  modelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#232C4D',
    paddingBottom: 8,
  },
  modelInfo: { flex: 1, gap: 2 },
  activeName: { color: '#7FD4FF', fontWeight: '700' },
  deleteBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: '#2A1B2A' },
  deleteText: { color: '#E5646E', fontWeight: '600', fontSize: 13 },
  primaryButton: {
    backgroundColor: '#7FD4FF',
    borderRadius: 14,
    padding: 14,
    alignItems: 'center',
  },
  primaryButtonText: { color: '#0B1026', fontWeight: '800' },
  progressBox: { gap: 6 },
  progressTrack: {
    height: 10,
    borderRadius: 5,
    backgroundColor: '#1D2748',
    overflow: 'hidden',
    flexDirection: 'row',
  },
  progressFill: { backgroundColor: '#7FD4FF', minWidth: 4 },
  cancelButton: {
    borderRadius: 10,
    paddingVertical: 8,
    backgroundColor: '#2A1B2A',
    alignItems: 'center',
  },
  cancelText: { color: '#E5646E', fontWeight: '600', fontSize: 13 },
  linkButton: {
    backgroundColor: '#1D2748',
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
  },
  linkText: { color: '#7FD4FF', fontWeight: '600' },
  statusText: { color: '#9AA3C0', fontSize: 13, textAlign: 'center' },
});
