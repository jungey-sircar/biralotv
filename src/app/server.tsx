import { api, useConfig } from '@/lib/api';
import { goBack } from '@/lib/util';
import { useTheme } from '@/theme';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View, StyleSheet } from 'react-native';
import { SafeScreen } from '@/components/SafeScreen';

export default function ServerSettings() {
  const server = useConfig(s => s.server);
  const { colors: c } = useTheme();
  const [value, setValue] = useState<string | null>(null);
  const saved = value ?? server;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ok, setOk] = useState<string | null>(null);

  async function saveAndCheck() {
    if (!saved.trim()) {
      setError('Enter a server address');
      return;
    }
    setBusy(true);
    setError('');
    setOk(null);
    try {
      useConfig.getState().setServer(saved.trim());
      const health = await api.health();
      setOk(`Connected · ${health.channels} channels on server`);
    } catch (e: unknown) {
      setError('Could not reach server: ' + (e instanceof Error ? e.message : 'unknown'));
    } finally {
      setBusy(false);
    }
  }

  function triggerScrape(source: string) {
    api.scrapeStart(source, true).catch(() => {});
  }

  return (
    <SafeScreen>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {/* header */}
        <View style={styles.header}>
          <Pressable onPress={() => goBack()} hitSlop={12}>
            <Text style={[styles.backText, { color: c.text }]}>‹</Text>
          </Pressable>
          <Text style={[styles.title, { color: c.text }]}>Server</Text>
        </View>

        {/* address card */}
        <View style={[styles.card, { backgroundColor: c.surface }]}>
          <Text style={[styles.label, { color: c.textMuted }]}>BACKEND ADDRESS</Text>
          <TextInput
            value={saved}
            onChangeText={setValue}
            placeholder="http://192.168.1.10:8080"
            placeholderTextColor={c.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            style={[styles.addressInput, { color: c.text }]}
          />
          <Pressable
            onPress={saveAndCheck}
            disabled={busy}
            style={({ pressed }) => [styles.saveBtn, { backgroundColor: pressed || busy ? c.elevated : c.accent }]}
          >
            {busy ? <ActivityIndicator size="small" color="#fff" /> : null}
            <Text style={styles.saveBtnText}>Save & test</Text>
          </Pressable>
          {ok ? <Text style={styles.okText}>{ok}</Text> : null}
          {error ? <Text style={[styles.errText, { color: c.danger }]}>{error}</Text> : null}
        </View>

        {/* scrape card */}
        <View style={[styles.card, { backgroundColor: c.surface }]}>
          <Text style={[styles.cardTitle, { color: c.text }]}>Refresh sources</Text>
          <Text style={[styles.cardDesc, { color: c.textMuted }]}>
            Pulls fresh channel lists + stream URLs. Runs in the background on your server.
          </Text>
          {['mapple-premium', 'mapple-sports'].map(src => (
            <Pressable
              key={src}
              onPress={() => triggerScrape(src)}
              style={({ pressed }) => [styles.scrapeBtn, { backgroundColor: pressed ? c.elevated : c.surface }]}
            >
              <Text style={[styles.scrapeBtnText, { color: c.textSecondary }]}>{src}</Text>
            </Pressable>
          ))}
        </View>

        {/* privacy card */}
        <View style={[styles.card, { backgroundColor: c.surface }]}>
          <Text style={[styles.cardTitle, { color: c.text }]}>Privacy</Text>
          <Text style={[styles.cardDesc, { color: c.textMuted }]}>
            Favorites and history stay on your local server. Nothing is sent anywhere else.
          </Text>
        </View>
      </ScrollView>
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    gap: 16,
    paddingTop: 8,
  },
  header: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
  },
  backText: {
    fontSize: 22,
    marginTop: -2,
  },
  title: {
    fontWeight: '800',
    fontSize: 18,
    flex: 1,
  },
  card: {
    borderRadius: 16,
    padding: 15,
    gap: 10,
  },
  label: {
    fontSize: 11,
    letterSpacing: 1,
  },
  addressInput: {
    paddingVertical: 12,
    fontSize: 14,
  },
  saveBtn: {
    borderRadius: 999,
    paddingVertical: 12,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  saveBtnText: {
    color: '#fff',
    fontWeight: '700',
  },
  okText: {
    color: '#34c759',
    fontSize: 12,
  },
  errText: {
    fontSize: 12,
  },
  cardTitle: {
    fontWeight: '700',
  },
  cardDesc: {
    fontSize: 12,
  },
  scrapeBtn: {
    borderRadius: 12,
    paddingVertical: 11,
    paddingHorizontal: 12,
  },
  scrapeBtnText: {
    fontWeight: '600',
    fontSize: 13,
  },
});
