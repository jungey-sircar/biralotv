import { ACCENTS, Mode, useSettings, useTheme } from '@/theme';
import { router, Stack } from 'expo-router';
import { Pressable, ScrollView, Text, TextInput, View, StyleSheet, Switch } from 'react-native';
import { goBack } from '@/lib/util';
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
});
