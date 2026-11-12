import { ACCENTS, Mode, useSettings, useTheme } from '@/theme';
import { useEffect, useState } from 'react';
import { router, Stack } from 'expo-router';
import { ActivityIndicator, Platform, Pressable, ScrollView, Switch, Text, TextInput, View, StyleSheet } from 'react-native';
import { goBack } from '@/lib/util';
import { MS_KINDS, msTest, useMediaServer } from '@/lib/media-server';
import {
  getBuiltInScraperUrl,
  SCRAPER_SERVERS,
  scraperHostSuggestionFromBackend,
  testScraper,
  useScraperConfig,
} from '@/lib/scraper';
import {
  SUBTITLE_LANG_CHOICES,
  SUBTITLE_SIZE_CHOICES,
  useSubtitlePrefs,
} from '@/lib/subtitles';
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
              <Text style={[styles.rowTitle, { color: c.text }]}>TMDB API key (optional)</Text>
              <Text style={[styles.rowDesc, { color: c.textMuted }]}>
                Latest Movies and search work out of the box without a key. Add your own key here to
                query api.themoviedb.org directly.
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
                {tmdbKey ? 'Configured · using personal TMDB key' : 'Using built-in keyless catalogue'}
              </Text>
            </View>
          </View>
        </Section>

        <MovieScraperSection />

        <SubtitlesSection />

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

function MovieScraperSection() {
  const { colors: c } = useTheme();
  const saved = useScraperConfig();
  const [url, setUrl] = useState(saved.url);
  const [builtInUrl, setBuiltInUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [ok, setOk] = useState(false);

  useEffect(() => {
    void getBuiltInScraperUrl().then(setBuiltInUrl).catch(() => {});
  }, []);

  const dirty = url.trim().replace(/\/+$/, '') !== saved.url;
  const backendSuggestion = scraperHostSuggestionFromBackend();
  const quickFills = [
    ...(backendSuggestion ? [backendSuggestion] : []),
    'http://127.0.0.1:8080',
    ...(Platform.OS === 'android' ? ['http://10.0.2.2:8080'] : []),
  ];

  async function saveAndTest(override?: string) {
    const nextUrl = override !== undefined ? override : url;
    setBusy(true);
    setStatus('');
    saved.setUrl(nextUrl);
    try {
      const info = await testScraper(nextUrl);
      setOk(true);
      setStatus(info);
    } catch (e: unknown) {
      setOk(false);
      setStatus(e instanceof Error ? e.message : 'could not reach stream-scraper');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Movie scraper" c={c}>
      <View style={[styles.rowCard, { backgroundColor: c.surface }]}>
        <View style={styles.rowText}>
          <Text style={[styles.rowTitle, { color: c.text }]}>stream-scraper</Text>
          <Text style={[styles.rowDesc, { color: c.textMuted }]}>
            Resolves latest movies and TV streams via Server 1, 2, or 3. Built into the Android APK
            and Desktop app; leave blank to use it automatically, or enter a custom LAN URL.
          </Text>
          {builtInUrl && !saved.url ? (
            <Text style={[styles.keyState, { color: c.textSecondary, marginTop: 8 }]}>
              Built-in scraper running at {builtInUrl}
            </Text>
          ) : null}

          <View style={[styles.themeRow, { backgroundColor: c.elevated, marginTop: 12 }]}>
            {SCRAPER_SERVERS.map(s => (
              <Pressable
                key={s.id}
                onPress={() => saved.setServer(s.id)}
                style={[styles.themeBtn, { backgroundColor: saved.server === s.id ? c.accent : 'transparent' }]}
              >
                <Text style={[styles.themeBtnText, { color: saved.server === s.id ? '#fff' : c.textSecondary }]}>
                  {s.label}
                </Text>
              </Pressable>
            ))}
          </View>
          <Text style={[styles.keyState, { color: c.textMuted, marginTop: 8 }]}>
            {SCRAPER_SERVERS.find(s => s.id === saved.server)?.hint}
          </Text>

          <TextInput
            value={url}
            onChangeText={setUrl}
            placeholder="Auto-detect (or http://192.168.1.50:8080)"
            placeholderTextColor={c.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            style={[styles.field, { backgroundColor: c.elevated, color: c.text }]}
          />

          <View style={styles.quickRow}>
            <Pressable
              onPress={() => {
                setUrl('');
                void saveAndTest('');
              }}
              style={[styles.quickPill, { backgroundColor: c.elevated }]}
            >
              <Text style={[styles.quickText, { color: c.textSecondary }]}>Auto</Text>
            </Pressable>
            {quickFills.map(item => (
              <Pressable
                key={item}
                onPress={() => setUrl(item)}
                style={[styles.quickPill, { backgroundColor: c.elevated }]}
              >
                <Text style={[styles.quickText, { color: c.textSecondary }]}>
                  {item.replace(/^https?:\/\//, '')}
                </Text>
              </Pressable>
            ))}
          </View>

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
                <Text style={styles.saveText}>{dirty ? 'Save & test' : 'Test scraper'}</Text>
              )}
            </Pressable>
            {status ? (
              <Text style={[styles.statusText, { color: ok ? c.textSecondary : c.danger }]} numberOfLines={3}>
                {status}
              </Text>
            ) : (
              <Text style={[styles.statusText, { color: c.textMuted }]}>
                {saved.url
                  ? `Saved: ${saved.url}`
                  : builtInUrl
                    ? Platform.OS === 'android'
                      ? 'Built-in (APK)'
                      : 'Built-in (Desktop)'
                    : 'Auto-detect'}
              </Text>
            )}
          </View>
        </View>
      </View>
    </Section>
  );
}

function SubtitlesSection() {
  const { colors: c, dark } = useTheme();
  const { enabled, preferredLanguage, textSize, setEnabled, setPreferredLanguage, setTextSize } =
    useSubtitlePrefs();

  return (
    <Section title="Subtitles" c={c}>
      <View style={[styles.rowCard, { backgroundColor: c.surface }]}>
        <View style={styles.rowText}>
          <Text style={[styles.rowTitle, { color: c.text }]}>Auto-enable subtitles</Text>
          <Text style={[styles.rowDesc, { color: c.textMuted }]}>
            Automatically load your preferred subtitle language on streamed movies and shows when
            available.
          </Text>
        </View>
        <Switch
          value={enabled}
          onValueChange={setEnabled}
          trackColor={{ false: dark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.15)', true: c.accent }}
          thumbColor="#fff"
        />
      </View>

      <View style={[styles.rowCard, { backgroundColor: c.surface, marginTop: 10 }]}>
        <View style={styles.rowText}>
          <Text style={[styles.rowTitle, { color: c.text }]}>Preferred language</Text>
          <View style={styles.quickRow}>
            {SUBTITLE_LANG_CHOICES.map(lang => {
              const active = preferredLanguage === lang.code;
              return (
                <Pressable
                  key={lang.code}
                  onPress={() => setPreferredLanguage(lang.code)}
                  style={[styles.quickPill, { backgroundColor: active ? c.accent : c.elevated }]}
                >
                  <Text style={[styles.quickText, { color: active ? '#fff' : c.textSecondary }]}>
                    {lang.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={[styles.rowTitle, { color: c.text, marginTop: 16 }]}>Caption size</Text>
          <View style={[styles.themeRow, { backgroundColor: c.elevated, marginTop: 10 }]}>
            {SUBTITLE_SIZE_CHOICES.map(sz => {
              const active = textSize === sz.id;
              return (
                <Pressable
                  key={sz.id}
                  onPress={() => setTextSize(sz.id)}
                  style={[styles.themeBtn, { backgroundColor: active ? c.accent : 'transparent' }]}
                >
                  <Text style={[styles.themeBtnText, { color: active ? '#fff' : c.textSecondary }]}>
                    {sz.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>
    </Section>
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
  quickRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  quickPill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  quickText: {
    fontSize: 11.5,
    fontWeight: '600',
  },
});
