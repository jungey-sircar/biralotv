import { CatSplash } from '@/components/cat-splash';
import { useTheme } from '@/theme';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const SPLASH_MS = 1700;

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const { colors, dark } = useTheme();
  const [frameReady, setFrameReady] = useState(false);
  const [phase, setPhase] = useState<'running' | 'leaving' | 'gone'>('running');

  useEffect(() => {
    if (phase === 'gone') return;
    if (frameReady || phase !== 'running') void SplashScreen.hideAsync();
  }, [phase, frameReady]);

  useEffect(() => {
    if (phase !== 'running') return;
    const t = setTimeout(() => setPhase('leaving'), SPLASH_MS);
    return () => clearTimeout(t);
  }, [phase]);

  useEffect(() => {
    if (phase !== 'leaving') return;
    const t = setTimeout(() => setPhase('gone'), 340);
    return () => clearTimeout(t);
  }, [phase]);

  return (
    <SafeAreaProvider>
      <StatusBar style={dark ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="player" options={{ animation: 'fade' }} />
      </Stack>
      {phase !== 'gone' && (
        <CatSplash running={phase === 'running'} onFirstFrame={() => setFrameReady(true)} />
      )}
    </SafeAreaProvider>
  );
}
