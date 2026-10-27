import { useTheme } from '@/theme';
import { ReactNode } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export function ScreenWrapper({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const { colors: c } = useTheme();
  return <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top, paddingBottom: insets.bottom }}>{children}</View>;
}

export function ScreenError({ error, onRetry, children }: { error: string; onRetry: () => void; children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const { colors: c } = useTheme();
  if (!error) return <>{children}</>;
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: c.bg,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 24,
        paddingTop: insets.top + 24,
        paddingBottom: insets.bottom + 24,
        gap: 14,
      }}
    >
      <Text style={{ color: c.text, fontWeight: '700', fontSize: 16 }}>Something went wrong</Text>
      <Text style={{ color: c.textSecondary, textAlign: 'center' }}>{error}</Text>
      <Pressable
        onPress={onRetry}
        style={({ pressed }) => ({ backgroundColor: pressed ? c.elevated : c.accent, borderRadius: 999, paddingHorizontal: 22, paddingVertical: 11 })}
      >
        <Text style={{ color: '#fff', fontWeight: '700' }}>Try again</Text>
      </Pressable>
    </View>
  );
}

export function ScreenLoading({ message }: { message?: string }) {
  const { colors: c } = useTheme();
  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 }}>
      <ActivityIndicator size="large" color={c.accent} />
      {message ? <Text style={{ color: c.textSecondary, fontSize: 13 }}>{message}</Text> : null}
    </View>
  );
}
