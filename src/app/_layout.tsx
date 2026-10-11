import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import type { Theme } from '@react-navigation/native';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { StyleSheet, useColorScheme, View } from 'react-native';

import { useSessionStore } from '@/state/session';

SplashScreen.preventAutoHideAsync().catch(() => {});

export const unstable_settings = {
  anchor: 'index',
};

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const nightMode = useSessionStore((s) => s.nightMode);

  // expo-router does not hide the splash screen itself - once the root
  // layout has mounted, fade it out so the app beneath becomes visible.
  // Without this, Android/iOS sit on the splash forever (web has no
  // splash, which is why this never showed up there).
  useEffect(() => {
    SplashScreen.hideAsync().catch(() => {});
  }, []);

  const theme = nightMode
    ? AKSA_NIGHT_THEME
    : colorScheme === 'dark'
      ? AKSA_DARK_THEME
      : AKSA_LIGHT_THEME;

  return (
    <ThemeProvider value={theme}>
      <StatusBar style="light" />
      <View style={{ flex: 1 }}>
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: theme.colors.background },
            headerTitleStyle: { color: theme.colors.text },
            headerTintColor: theme.colors.primary,
            contentStyle: { backgroundColor: theme.colors.background },
            animation: 'fade',
          }}
        >
          <Stack.Screen name="index" options={{ title: 'AKSA' }} />
          <Stack.Screen name="guide" options={{ title: 'Sky Guide' }} />
          <Stack.Screen name="sky" options={{ title: 'Sky Detective' }} />
          <Stack.Screen name="missions" options={{ title: 'Missions' }} />
          <Stack.Screen name="models" options={{ title: 'Models' }} />
          <Stack.Screen
            name="object/[id]"
            options={{ title: 'Object', headerBackTitle: 'Sky' }}
          />
        </Stack>
        {nightMode && (
          <View
            pointerEvents="none"
            style={styles.nightTint}
          />
        )}
      </View>
    </ThemeProvider>
  );
}

const AKSA_LIGHT_THEME: Theme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary: '#7FD4FF',
    background: '#0B1026',
    card: '#141B33',
    text: '#E8ECFF',
    border: '#232C4D',
    notification: '#7FD4FF',
  },
};

const AKSA_DARK_THEME: Theme = {
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

/** Red-light theme that preserves dark adaptation. */
const AKSA_NIGHT_THEME: Theme = {
  ...DarkTheme,
  dark: true,
  colors: {
    ...DarkTheme.colors,
    primary: '#FF6B5B',
    background: '#120404',
    card: '#1C0808',
    text: '#FFB4A8',
    border: '#3A1210',
    notification: '#FF6B5B',
  },
};

const styles = StyleSheet.create({
  nightTint: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(255, 32, 16, 0.30)',
    mixBlendMode: 'multiply',
  },
});