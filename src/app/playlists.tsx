import { type Channel } from '@/lib/api';
import { fetchPlaylistUrl, parsePlaylistText } from '@/lib/iptv';
import { goBack } from '@/lib/util';
import { useTheme } from '@/theme';
import { router, Stack, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Keyboard, Pressable, ScrollView, Text, TextInput, View, StyleSheet } from 'react-native';
import { SafeScreen } from '@/components/SafeScreen';
import { useLocalStore, useLocalStoreHydrated, type LocalPlaylist } from '@/lib/store';

export default function Playlists() {
  const { colors: c } = useTheme();
  const hydrated = useLocalStoreHydrated();
  const playlists = useLocalStore(s => s.playlists);
  const addPlaylist = useLocalStore(s => s.addPlaylist);
  const removePlaylist = useLocalStore(s => s.removePlaylist);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [mode, setMode] = useState<'url' | 'text'>('url');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useFocusEffect(
    useCallback(() => {
      setError('');
    }, []),
  );

  async function add() {
    Keyboard.dismiss();
    if (!name.trim()) {
      setError('Give the playlist a name');
      return;
    }
    if (mode === 'url' && !url.trim()) {
      setError('Enter a playlist URL');
      return;
    }
    if (mode === 'text' && !text.trim()) {
      setError('Paste the M3U content');
      return;
    }
    setBusy(true);
    setError('');
    try {
      let channels: Channel[];
      if (mode === 'url') {
        channels = await fetchPlaylistUrl(url.trim(), name.trim());
      } else {
        channels = parsePlaylistText(text.trim(), name.trim());
      }
      if (channels.length === 0) {
        setError('No playable channels found in that playlist');
        return;
      }
      const row: LocalPlaylist = {
        id: `p-${Date.now()}`,
        name: name.trim(),
        url: mode === 'url' ? url.trim() : undefined,
        text: mode === 'text' ? text.trim() : undefined,
        channelCount: channels.length,
        createdAt: new Date().toISOString(),
      };
      addPlaylist(row);
      setName('');
      setUrl('');
      setText('');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'failed to add playlist');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeScreen>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <View style={styles.content}>
          <View style={styles.header}>
            <Pressable onPress={() => goBack()} hitSlop={12}>
              <Text style={[styles.backText, { color: c.text }]}>‹</Text>
            </Pressable>
            <Text style={[styles.title, { color: c.text }]}>My Playlists</Text>
          </View>

          <View style={[styles.card, { backgroundColor: c.surface }]}>
            <Text style={[styles.cardTitle, { color: c.text }]}>Add your own playlist (M3U)</Text>
            <View style={styles.modeRow}>
              <ModeChip label="From URL" active={mode === 'url'} color={c} onPress={() => setMode('url')} />
              <ModeChip label="Paste text" active={mode === 'text'} color={c} onPress={() => setMode('text')} />
            </View>
            <Labeled label="Name" color={c}>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="e.g. My premium list"
                placeholderTextColor={c.textMuted}
                style={[styles.input, { color: c.text }]}
              />
            </Labeled>
            {mode === 'url' ? (
              <Labeled label="M3U / M3U8 URL" color={c}>
                <TextInput
                  value={url}
                  onChangeText={setUrl}
                  placeholder="https://…/playlist.m3u"
                  placeholderTextColor={c.textMuted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={[styles.input, { color: c.text }]}
                />
              </Labeled>
            ) : (
              <Labeled label="M3U contents" color={c}>
                <TextInput
                  value={text}
                  onChangeText={setText}
                  placeholder={'#EXTM3U\n#EXTINF:-1 tvg-logo="…" group-title="News",Name\nhttp://stream'}
                  placeholderTextColor={c.textMuted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  multiline
                  style={[styles.input, styles.multilineInput, { color: c.text }]}
                />
              </Labeled>
            )}
            {error ? <Text style={[styles.inlineError, { color: c.danger }]}>{error}</Text> : null}
            <Pressable
              onPress={add}
              disabled={busy}
              style={({ pressed }) => [styles.addBtn, { backgroundColor: pressed || busy ? c.elevated : c.accent }]}
            >
              {busy ? <ActivityIndicator size="small" color="#fff" /> : null}
              <Text style={styles.addBtnText}>{busy ? 'Importing…' : 'Add playlist'}</Text>
            </Pressable>
          </View>

          {!hydrated ? (
            <ActivityIndicator style={styles.listLoader} color={c.accent} />
          ) : playlists.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={[styles.emptyIcon, { color: c.textMuted }]}>≡</Text>
              <Text style={[styles.emptyText, { color: c.textMuted }]}>No playlists yet. Add one above.</Text>
            </View>
          ) : (
            <View style={styles.listGap}>
              {playlists.map(p => (
                <View key={p.id} style={[styles.playlistCard, { backgroundColor: c.surface }]}>
                  <Pressable
                    style={styles.playlistInfo}
                    onPress={() => router.push({ pathname: '/browse', params: { source: `user:${p.id}` } })}
                  >
                    <Text style={[styles.playlistName, { color: c.text }]}>{p.name}</Text>
                    <Text style={[styles.playlistMeta, { color: c.textMuted }]}>
                      {p.channelCount} channels · {p.url ? 'from URL' : 'pasted'}
                    </Text>
                  </Pressable>
                  <Pressable onPress={() => removePlaylist(p.id)} hitSlop={10} disabled={busy}>
                    <Text style={[styles.deleteBtnText, { color: c.danger }]}>Delete</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          )}

          <View style={[styles.note, { backgroundColor: c.surface }]}>
            <Text style={[styles.noteTitle, { color: c.text }]}>iptv-org is always on</Text>
            <Text style={[styles.noteText, { color: c.textMuted }]}>
              Categories, countries and languages load without any server. A backend address is optional.
            </Text>
          </View>
        </View>
      </ScrollView>
    </SafeScreen>
  );
}

function ModeChip({ label, active, color, onPress }: { label: string; active: boolean; color: ReturnType<typeof useTheme>['colors']; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.modeChip,
        { backgroundColor: active ? color.text : pressed ? color.elevated : 'transparent' },
      ]}
    >
      <Text style={[styles.modeChipText, { color: active ? color.bg : color.textSecondary }]}>{label}</Text>
    </Pressable>
  );
}

function Labeled({ label, children, color }: { label: string; children: React.ReactNode; color: ReturnType<typeof useTheme>['colors'] }) {
  return (
    <View style={styles.labeledWrap}>
      <Text style={[styles.labelText, { color: color.textMuted }]}>{label}</Text>
      <View style={[styles.labeledInput, { backgroundColor: color.elevated }]}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 40,
  },
  content: {
    padding: 20,
    gap: 14,
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
    gap: 12,
  },
  cardTitle: {
    fontWeight: '700',
  },
  modeRow: {
    flexDirection: 'row',
    gap: 8,
  },
  input: {
    paddingVertical: 4,
    fontSize: 14,
  },
  multilineInput: {
    fontSize: 12,
    minHeight: 100,
    textAlignVertical: 'top',
  },
  inlineError: {
    fontSize: 12,
  },
  addBtn: {
    borderRadius: 999,
    paddingVertical: 12,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  addBtnText: {
    color: '#fff',
    fontWeight: '700',
  },
  emptyState: {
    alignItems: 'center',
    gap: 8,
    paddingTop: 20,
  },
  emptyIcon: {
    fontSize: 32,
  },
  emptyText: {},
  listGap: {
    gap: 10,
  },
  listLoader: {
    padding: 20,
  },
  playlistCard: {
    borderRadius: 16,
    padding: 15,
    flexDirection: 'row',
    alignItems: 'center',
  },
  playlistInfo: {
    flex: 1,
  },
  playlistName: {
    fontWeight: '700',
  },
  playlistMeta: {
    fontSize: 12,
    marginTop: 2,
  },
  deleteBtnText: {
    fontWeight: '700',
    fontSize: 13,
  },
  modeChip: {
    borderRadius: 999,
    paddingHorizontal: 13,
    paddingVertical: 7,
  },
  modeChipText: {
    fontWeight: '700',
    fontSize: 12,
  },
  labeledWrap: {
    gap: 5,
  },
  labelText: {
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  labeledInput: {
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  note: {
    borderRadius: 16,
    padding: 15,
    gap: 4,
  },
  noteTitle: {
    fontWeight: '700',
    fontSize: 13.5,
  },
  noteText: {
    fontSize: 12.5,
    lineHeight: 18,
  },
});
