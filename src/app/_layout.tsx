import { DarkTheme, ThemeProvider } from 'expo-router';
import type { Theme } from '@react-navigation/native';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';

SplashScreen.preventAutoHideAsync().catch(() => {});

export const unstable_settings = {
  anchor: 'index',
};

const AKSA_THEME: Theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: '#7FD4FF',
    background: '#0B1026',
    card: '#141B33',
    text: '#E8ECFF',
    border: '#232C4D',
    notification: '#7FD4FF',
  },
};

const SCREEN_OPTIONS = {
  headerStyle: { backgroundColor: AKSA_THEME.colors.background },
  headerTitleStyle: { color: AKSA_THEME.colors.text },
  headerTintColor: AKSA_THEME.colors.primary,
  contentStyle: { backgroundColor: AKSA_THEME.colors.background },
  animation: 'fade' as const,
};

export default function RootLayout() {
  // expo-router does not hide the splash screen itself - once the root
  // layout has mounted, fade it out so the app beneath becomes visible.
  useEffect(() => {
    SplashScreen.hideAsync().catch(() => {});
  }, []);

  return (
    <ThemeProvider value={AKSA_THEME}>
      <StatusBar style="light" />
      <Stack screenOptions={SCREEN_OPTIONS}>
        <Stack.Screen name="index" options={{ title: 'AKSA' }} />
        <Stack.Screen name="guide" options={{ title: 'Sky Guide' }} />
        <Stack.Screen name="chat" options={{ title: 'AI Chat' }} />
        <Stack.Screen name="sky" options={{ title: 'Sky Detective' }} />
        <Stack.Screen name="missions" options={{ title: 'Missions' }} />
        <Stack.Screen name="models" options={{ title: 'Models' }} />
        <Stack.Screen name="object/[id]" options={{ title: 'Object', headerBackTitle: 'Sky' }} />
      </Stack>
    </ThemeProvider>
  );
}
