import { ACCENTS, Mode, useSettings, useTheme } from '@/theme';
import { useState } from 'react';
import { router, Stack } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View, StyleSheet, Switch } from 'react-native';
import { goBack } from '@/lib/util';
import { MS_KINDS, msTest, useMediaServer } from '@/lib/media-server';
import { SafeScreen } from '@/components/SafeScreen';

const MODES: { id: Mode; label: string }[] = [
  { id: 'system', label: 'System' },
  { id: 'dark', label: 'Dark' },
  { id: 'light', label: 'Light' },
];

export default function Settings() {
  const { mode, accent, showAdult, tmdbKey, setMode, setAccent, setShowAdult, setTmdbKey } = useSettings();
  const { colors: c, dark } = useTheme();

  return (
    <SafeScreen>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.header, { height: 52 + 0 }]}>
        <Pressable onPress={goBack} hitSlop={12}>
          <Text style={{ color: c.text, fontSize: 20 }}>‹</Text>
        </Pressable>
        <Text style={[styles.headerTitle, { color: c.text }]}>Settings</Text>
        <View style={{ width: 20 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Section title="Appearance" c={c}>
          <View style={[styles.themeRow, { backgroundColor: c.surface }]}>
            {MODES.map(m => (
              <Pressable
                key={m.id}
                onPress={() => setMode(m.id)}
                style={[
                  styles.themeBtn,
                  { backgroundColor: mode === m.id ? c.accent : 'transparent' },
                ]}
              >
                <Text style={[styles.themeBtnText, { color: mode === m.id ? '#fff' : c.textSecondary }]}>
                  {m.label}
                </Text>
              </Pressable>
            ))}
          </View>

          <Text style={[styles.subLabel, { color: c.textMuted }]}>Accent color</Text>
          <View style={styles.accentRow}>
            {ACCENTS.map(a => (
              <Pressable
                key={a.value}
                onPress={() => setAccent(a.value)}
                style={[
                  styles.swatch,
                  { backgroundColor: a.value },
                  accent === a.value && { 
                    shadowColor: a.value, 
                    elevation: 4,
                    transform: [{ scale: 1.15 }],
                  },
                ]}
              >
                {accent === a.value ? <Text style={styles.swatchCheck}>✓</Text> : null}
              </Pressable>
            ))}
          </View>
        </Section>

        <Section title="Content" c={c}>
          <View style={[styles.rowCard, { backgroundColor: c.surface }]}>
            <View style={styles.rowText}>
              <Text style={[styles.rowTitle, { color: c.text }]}>Show adult channels</Text>
              <Text style={[styles.rowDesc, { color: c.textMuted }]}>Off by default. Channels marked 18+.</Text>
            </View>
            <Switch
              value={showAdult}
              onValueChange={setShowAdult}
              trackColor={{ false: dark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.15)', true: c.accent }}
              thumbColor="#fff"
            />
          </View>
        </Section>

        <Section title="Catalogue" c={c}>
          <View style={[styles.rowCard, { backgroundColor: c.surface }]}>
            <View style={styles.rowText}>
              <Text style={[styles.rowTitle, { color: c.text }]}>TMDB API key</Text>
              <Text style={[styles.rowDesc, { color: c.textMuted }]}>
                Unlocks the full film and anime catalogue with posters, seasons and where to watch. Public
                domain and Creative Commons films play with or without it.
              </Text>
              <TextInput
                value={tmdbKey}
                onChangeText={setTmdbKey}
                placeholder="v3 key or v4 read token"
                placeholderTextColor={c.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
                style={[styles.keyInput, { color: c.text }]}
              />
              <Text style={[styles.keyState, { color: tmdbKey ? c.textMuted : c.textSecondary }]}>
                {tmdbKey ? 'Configured · catalogue tabs are visible' : 'Not set'}
              </Text>
            </View>
          </View>
        </Section>

        <MediaServerSection />

        <Section title="Connection" c={c}>
          <Pressable onPress={() => router.push('/server')} style={[styles.rowCard, { backgroundColor: c.surface }]}>
            <View style={styles.rowText}>
              <Text style={[styles.rowTitle, { color: c.text }]}>Server address</Text>
              <Text style={[styles.rowDesc, { color: c.textMuted }]}>Change or re-check your backend server</Text>
            </View>
            <Text style={{ color: c.textMuted }}>›</Text>
          </Pressable>
        </Section>

        <Section title="About" c={c}>
          <View style={[styles.rowCard, { backgroundColor: c.surface }]}>
            <View style={styles.rowText}>
              <Text style={[styles.rowTitle, { color: c.text }]}>Private by design</Text>
              <Text style={[styles.rowDesc, { color: c.textMuted }]}>
                Everything stays on your local network. No accounts, no tracking.
              </Text>
            </View>
          </View>
        </Section>
      </ScrollView>
    </SafeScreen>
  );
}

function MediaServerSection() {
  const { colors: c } = useTheme();
  const saved = useMediaServer();
  const [kind, setKind] = useState(saved.kind);
  const [url, setUrl] = useState(saved.url);
  const [key, setKey] = useState(saved.key);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [ok, setOk] = useState(false);

  const dirty = kind !== saved.kind || url.trim() !== saved.url || key.trim() !== saved.key;

  async function saveAndTest() {
    setBusy(true);
    setStatus('');
    saved.setKind(kind);
    saved.setUrl(url);
    saved.setKey(key);
    try {
      const info = await msTest();
      setOk(true);
      setStatus(info);
    } catch (e: unknown) {
      setOk(false);
      setStatus(e instanceof Error ? e.message : 'could not reach that server');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Media server" c={c}>
      <View style={[styles.rowCard, { backgroundColor: c.surface }]}>
        <View style={styles.rowText}>
          <Text style={[styles.rowTitle, { color: c.text }]}>Your own library</Text>
          <Text style={[styles.rowDesc, { color: c.textMuted }]}>
            Point biralotv at a Jellyfin, Emby or Plex server on this network. Every film and series on
            it becomes searchable and playable inside the app.
          </Text>

          <View style={[styles.themeRow, { backgroundColor: c.elevated, marginTop: 12 }]}>
            {MS_KINDS.map(k => (
              <Pressable
                key={k.id}
                onPress={() => setKind(k.id)}
                style={[styles.themeBtn, { backgroundColor: kind === k.id ? c.accent : 'transparent' }]}
              >
                <Text style={[styles.themeBtnText, { color: kind === k.id ? '#fff' : c.textSecondary }]}>
                  {k.label}
                </Text>
              </Pressable>
            ))}
          </View>
          <Text style={[styles.keyState, { color: c.textMuted, marginTop: 8 }]}>
            {MS_KINDS.find(k => k.id === kind)?.hint}
          </Text>

          <TextInput
            value={url}
            onChangeText={setUrl}
            placeholder="http://192.168.1.50:8096"
            placeholderTextColor={c.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            style={[styles.field, { backgroundColor: c.elevated, color: c.text }]}
          />
          <TextInput
            value={key}
            onChangeText={setKey}
            placeholder={kind === 'plex' ? 'X-Plex-Token' : 'API key'}
            placeholderTextColor={c.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            style={[styles.field, { backgroundColor: c.elevated, color: c.text }]}
          />

          <View style={styles.serverActions}>
            <Pressable
              onPress={() => void saveAndTest()}
              disabled={busy}
              style={({ pressed }) => [
                styles.saveBtn,
                { backgroundColor: pressed || busy ? c.elevated : c.accent },
              ]}
            >
              {busy ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.saveText}>{dirty ? 'Save & test' : 'Test connection'}</Text>
              )}
            </Pressable>
            {status ? (
              <Text style={[styles.statusText, { color: ok ? c.textSecondary : c.danger }]} numberOfLines={3}>
                {status}
              </Text>
            ) : (
              <Text style={[styles.statusText, { color: c.textMuted }]}>
                {saved.url ? `Saved: ${saved.kind} at ${saved.url}` : 'Not configured'}
              </Text>
            )}
          </View>
        </View>
      </View>
    </Section>
  );
}

function Section({ title, children, c }: { title: string; children: React.ReactNode; c: ReturnType<typeof useTheme>['colors'] }) {
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: c.textMuted }]}>{title.toUpperCase()}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    height: 52,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
  },
  content: {
    padding: 20,
    paddingBottom: 40,
    gap: 4,
  },
  section: {
    marginBottom: 22,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.4,
    marginBottom: 10,
  },
  themeRow: {
    borderRadius: 14,
    padding: 4,
    flexDirection: 'row',
    gap: 4,
  },
  themeBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 10,
  },
  themeBtnText: {
    fontWeight: '700',
    fontSize: 13.5,
  },
  subLabel: {
    fontSize: 12.5,
    marginTop: 16,
    marginBottom: 10,
  },
  accentRow: {
    flexDirection: 'row',
    gap: 14,
  },
  swatch: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swatchCheck: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 14,
  },
  rowCard: {
    borderRadius: 14,
    padding: 15,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  rowText: {
    flex: 1,
  },
  rowTitle: {
    fontWeight: '700',
    fontSize: 14.5,
  },
  rowDesc: {
    fontSize: 12.5,
    marginTop: 3,
  },
  keyInput: {
    marginTop: 10,
    paddingVertical: 8,
    fontSize: 13,
  },
  keyState: {
    fontSize: 11.5,
  },
  field: {
    marginTop: 10,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13.5,
  },
  serverActions: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  saveBtn: {
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 10,
    minWidth: 108,
    alignItems: 'center',
  },
  saveText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 13,
  },
  statusText: {
    flex: 1,
    fontSize: 12,
  },
});
