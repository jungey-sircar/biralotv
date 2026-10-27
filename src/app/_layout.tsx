import { useTheme } from '@/theme';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

export default function RootLayout() {
  const { colors, dark } = useTheme();
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
    </SafeAreaProvider>
  );
}
