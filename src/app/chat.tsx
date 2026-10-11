/**
 * General AI chat: free-form conversation with the loaded on-device
 * model (or the dev Ollama backend). Unlike the Sky Guide, the AI can
 * talk about anything - the sky knowledge is just its personality.
 * History is memory-only and resets when the app closes.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
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
import { useSessionStore, type ChatMsg } from '@/state/session';
import { ensureAiReady, generate } from '@/ai/llm';

const SYSTEM_PROMPT =
  'You are AKSA, a friendly stargazing companion on the user\'s phone. ' +
  'Chat about anything the user wants, and happily answer general questions. ' +
  'When astronomy or stargazing comes up, you are knowledgeable and precise. ' +
  'Keep answers short and conversational - two to four sentences unless asked for more. ' +
  'Plain language, no markdown formatting.';

export default function ChatScreen() {
  const generalChat = useSessionStore((s) => s.generalChat);
  const pushGeneralChat = useSessionStore((s) => s.pushGeneralChat);
  const resetGeneralChat = useSessionStore((s) => s.resetGeneralChat);

  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  // Keep the transcript scrolled to the newest message.
  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: true });
  }, [generalChat.length, streamText]);

  const send = useCallback(async () => {
    const question = input.trim();
    if (!question || streaming) return;
    setInput('');
    setNotice(null);
    pushGeneralChat({ role: 'user', content: question });

    const ready = await ensureAiReady();
    if (!ready) {
      setNotice('No AI model loaded - load one from the Models screen first.');
      return;
    }

    setStreaming(true);
    setStreamText('');
    // Read history from the store (not the closure) so rapid sends and
    // the streaming bubble always build on the latest turns.
    const history = useSessionStore
      .getState()
      .generalChat.slice(-12)
      .map((m: ChatMsg) => ({ role: m.role, content: m.content }));
    const result = await generate({
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        ...history.slice(0, -1),
        { role: 'user', content: question },
      ],
      temperature: 0.4,
      maxTokens: 300,
      onToken: (partial) => setStreamText(partial),
    });
    setStreaming(false);
    setStreamText('');
    if (result?.text) {
      pushGeneralChat({ role: 'assistant', content: result.text });
    } else {
      setNotice('Generation failed - try again.');
    }
  }, [input, streaming, pushGeneralChat]);

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      <Stack.Screen options={{ title: 'AI Chat' }} />

      {generalChat.length === 0 && !streaming ? (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyTitle}>Talk to AKSA</Text>
          <Text style={styles.dimText}>
            Ask anything - the sky, the weather, or just chat. Answers come from
            the model loaded on this device (see Models).
          </Text>
        </View>
      ) : (
        <ScrollView
          ref={scrollRef}
          style={styles.transcript}
          contentContainerStyle={styles.transcriptContent}
        >
          {generalChat.map((m, i) => (
            <View
              key={`${i}-${m.role}`}
              style={[styles.bubble, m.role === 'user' ? styles.bubbleUser : styles.bubbleAi]}
            >
              <Text style={styles.bubbleText}>{m.content}</Text>
            </View>
          ))}
          {streaming && (
            <View style={[styles.bubble, styles.bubbleAi]}>
              <Text style={styles.bubbleText}>{streamText || '...'}</Text>
            </View>
          )}
        </ScrollView>
      )}

      {notice && <Text style={styles.notice}>{notice}</Text>}

      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          placeholder="Type a message..."
          placeholderTextColor="#5A648A"
          value={input}
          onChangeText={setInput}
          multiline
        />
        <Pressable
          style={[styles.sendBtn, (!input.trim() || streaming) && styles.sendBtnOff]}
          onPress={send}
          disabled={!input.trim() || streaming}
        >
          <Text style={styles.sendText}>{streaming ? '...' : 'Send'}</Text>
        </Pressable>
      </View>
      {generalChat.length > 0 ? (
        <Pressable onPress={resetGeneralChat}>
          <Text style={styles.clearText}>Clear chat</Text>
        </Pressable>
      ) : null}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0B1026' },
  emptyBox: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32, gap: 8 },
  emptyTitle: { color: '#7FD4FF', fontWeight: '800', fontSize: 20 },
  dimText: { color: '#9AA3C0', fontSize: 14, textAlign: 'center', lineHeight: 20 },
  transcript: { flex: 1 },
  transcriptContent: { padding: 16, gap: 8 },
  bubble: {
    borderRadius: 16,
    paddingVertical: 10,
    paddingHorizontal: 14,
    maxWidth: '85%',
  },
  bubbleUser: {
    backgroundColor: '#1D2748',
    alignSelf: 'flex-end',
  },
  bubbleAi: {
    backgroundColor: '#141B33',
    alignSelf: 'flex-start',
  },
  bubbleText: { color: '#E8ECFF', fontSize: 15, lineHeight: 21 },
  notice: { color: '#E5C15C', fontSize: 13, textAlign: 'center', paddingHorizontal: 16 },
  composer: {
    flexDirection: 'row',
    gap: 8,
    padding: 12,
  },
  input: {
    flex: 1,
    backgroundColor: '#1D2748',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: '#E8ECFF',
    fontSize: 15,
    maxHeight: 110,
  },
  sendBtn: {
    backgroundColor: '#7FD4FF',
    borderRadius: 12,
    paddingHorizontal: 18,
    justifyContent: 'center',
  },
  sendBtnOff: { backgroundColor: '#1D2748' },
  sendText: { color: '#0B1026', fontWeight: '800' },
  clearText: {
    color: '#9AA3C0',
    fontSize: 13,
    textAlign: 'center',
    paddingBottom: 10,
  },
});
