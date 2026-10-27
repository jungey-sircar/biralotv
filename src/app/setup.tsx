import { api, useConfig, apiBase } from '@/lib/api';
import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View, StyleSheet } from 'react-native';
import { useTheme } from '@/theme';
import { router } from 'expo-router';
import { SafeScreen } from '@/components/SafeScreen';
import * as Device from 'expo-device';

export default function Setup() {
  const current = useConfig(s => s.server);
  const { colors: c } = useTheme();
  const isEmulator = Platform.OS === 'android' && !Device.isDevice;
  const [value, setValue] = useState<string | null>(
    isEmulator ? 'http://10.0.2.2:8080' : null,
  );
  const saved = value ?? current;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function connect() {
    if (!saved.trim()) {
      setErr('Enter a server address');
      return;
    }
    setBusy(true);
    setErr('');
    useConfig.getState().setServer(saved.trim());
    try {
      const cfg = await api.health();
      if (!cfg.ok) throw new Error('server responded but not ok');
      router.replace('/');
    } catch (e: unknown) {
      setErr('Could not reach server (' + apiBase() + '): ' + (e instanceof Error ? e.message : 'unknown'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeScreen>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'android' ? undefined : 'padding'}
        style={styles.container}
      >
        <Text style={[styles.title, { color: c.text }]}>biralotv</Text>
        <Text style={[styles.subtitle, { color: c.textSecondary }]}>
          Enter your biralo backend address (Go server). Everything stays local.
        </Text>
        <View style={[styles.inputWrap, { backgroundColor: c.surface }]}>
          <TextInput
            value={saved}
            onChangeText={setValue}
            placeholder="http://192.168.18.6:8080"
            placeholderTextColor={c.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            onSubmitEditing={connect}
            style={[styles.input, { color: c.text }]}
          />
        </View>

        <View style={styles.suggestionsRow}>
          <Text style={[styles.suggestionLabel, { color: c.textMuted }]}>Quick fill:</Text>
          {['http://192.168.18.6:8080', 'http://10.0.2.2:8080'].map(url => (
            <Pressable
              key={url}
              onPress={() => setValue(url)}
              style={({ pressed }) => [
                styles.suggestionPill,
                { backgroundColor: pressed ? c.elevated : c.surface, borderColor: c.elevated },
              ]}
            >
              <Text style={[styles.suggestionText, { color: c.textSecondary }]}>
                {url.replace('http://', '')}
              </Text>
            </Pressable>
          ))}
        </View>

        {err ? <Text style={[styles.error, { color: c.danger }]}>{err}</Text> : null}
        <Pressable
          onPress={connect}
          disabled={busy}
          style={({ pressed }) => [styles.connectBtn, { backgroundColor: pressed || busy ? c.elevated : c.accent }]}
        >
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.connectBtnText}>Connect</Text>
          )}
        </Pressable>
        <Text style={styles.hint}>
          Run it on the PC where you started the Go backend and use its LAN IP.
        </Text>
      </KeyboardAvoidingView>
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    justifyContent: 'center',
    gap: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    textAlign: 'center',
  },
  subtitle: {
    textAlign: 'center',
  },
  inputWrap: {
    borderRadius: 14,
    paddingHorizontal: 14,
  },
  input: {
    paddingVertical: 14,
    fontSize: 15,
  },
  error: {
    textAlign: 'center',
  },
  connectBtn: {
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: 'center',
  },
  connectBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 16,
  },
  hint: {
    textAlign: 'center',
    fontSize: 12,
  },
  suggestionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: -4,
  },
  suggestionLabel: {
    fontSize: 12,
  },
  suggestionPill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  suggestionText: {
    fontSize: 12,
    fontWeight: '500',
  },
});
