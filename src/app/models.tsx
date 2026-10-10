/**
 * Model manager: lists .gguf files found in the app models/ folder,
 * imports a folder via the system picker, downloads the recommended
 * model with progress, and activates one for AI phrasing. Everything
 * here re-scans per launch - nothing is persisted.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Stack } from 'expo-router';
import {
  autoSelect,
  deleteModel,
  downloadRecommended,
  fmtSize,
  RECOMMENDED_MODEL,
  rescanAndSelect,
  scanPickedFolder,
  type DownloadHandle,
  type LocalModelInfo,
} from '@/ai/models';
import { ensureOllama } from '@/ai/llm';
import { useSessionStore } from '@/state/session';

export default function ModelsScreen() {
  const activeModel = useSessionStore((s) => s.activeModel);
  const setActiveModel = useSessionStore((s) => s.setActiveModel);

  const [models, setModels] = useState<LocalModelInfo[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [downloadFrac, setDownloadFrac] = useState<number | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [ollamaModel, setOllamaModel] = useState<string | null>(null);
  const downloadRef = useRef<DownloadHandle | null>(null);

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
    } finally {
      setScanning(false);
    }
  }, [setActiveModel]);

  useEffect(() => {
    scan();
    return () => downloadRef.current?.cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startDownload = () => {
    if (downloadFrac !== null) return;
    setStatus(`Downloading ${RECOMMENDED_MODEL.name}...`);
    setDownloadFrac(0);
    const handle = downloadRecommended(setDownloadFrac);
    downloadRef.current = handle;
    handle.promise.then((info) => {
      downloadRef.current = null;
      setDownloadFrac(null);
      if (info) {
        setModels((prev) => {
          const next = [...(prev ?? []), info];
          setActiveModel(autoSelect(next));
          return next;
        });
        setStatus(`Downloaded ${info.name} (${fmtSize(info.sizeBytes)})`);
      } else {
        setStatus('Download cancelled or failed.');
      }
    });
  };

  const importFolder = async () => {
    setStatus('Pick the folder that holds your .gguf files...');
    try {
      const found = await scanPickedFolder();
      // Imported files are referenced in place; merge into the list.
      setModels((prev) => {
        const merged = [...(prev ?? []), ...found.filter((f) => !prev?.some((p) => p.path === f.path))];
        setActiveModel(autoSelect(merged) ?? activeModel);
        return merged;
      });
      setStatus(
        found.length
          ? `Imported ${found.length} model(s) from the picked folder.`
          : 'No .gguf files in that folder.',
      );
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
    setStatus(ctx ? `${m.name} ready.` : `Could not load ${m.name}.`);
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
          AKSA computes all positions itself. A small local model (about 0.8 GB)
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
        <Text style={styles.cardTitle}>Get the recommended model</Text>
        <Text style={styles.body}>
          {RECOMMENDED_MODEL.name} (~{fmtSize(RECOMMENDED_MODEL.sizeBytes)}) - Gemma 3 1B
          instruct, 4-bit. Downloaded over Wi-Fi into the app's models folder.
        </Text>
        {downloadFrac === null ? (
          <Pressable style={styles.primaryButton} onPress={startDownload}>
            <Text style={styles.primaryButtonText}>Download model</Text>
          </Pressable>
        ) : (
          <View style={styles.progressBox}>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { flex: downloadFrac }]} />
            </View>
            <Text style={styles.dimText}>{Math.round(downloadFrac * 100)}%</Text>
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
  linkButton: {
    backgroundColor: '#1D2748',
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
  },
  linkText: { color: '#7FD4FF', fontWeight: '600' },
  statusText: { color: '#9AA3C0', fontSize: 13, textAlign: 'center' },
});
