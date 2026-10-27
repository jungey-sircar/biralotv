import { api, Playlist, PlaylistRow } from '@/lib/api';
import { goBack } from '@/lib/util';
import { useTheme } from '@/theme';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Keyboard, Pressable, ScrollView, Text, TextInput, View, StyleSheet } from 'react-native';
import { SafeScreen } from '@/components/SafeScreen';

export default function Playlists() {
  const { colors: c } = useTheme();
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [mode, setMode] = useState<'url' | 'text'>('url');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const rows = (await api.playlists()) ?? [];
      setPlaylists(rows.map((r: PlaylistRow) => ({
        id: r.playlist?.id ?? r.id ?? 0,
        name: r.playlist?.name ?? r.name ?? 'Unnamed',
        url: r.playlist?.url ?? r.url,
        created_at: r.playlist?.created_at ?? r.created_at ?? '',
        channel_count: r.playlist?.channel_count ?? r.channel_count ?? r.channels ?? 0,
      })));
      setError('');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function add() {
    Keyboard.dismiss();
    if (!name.trim()) {
      setError('Give the playlist a name');
      return;
    }
    setBusy(true);
    setError('');
    try {
      if (mode === 'url') {
        if (!url.trim()) {
          setError('Enter a playlist URL');
          setBusy(false);
          return;
        }
        await api.addPlaylistUrl(name.trim(), url.trim());
      } else {
        if (!text.trim()) {
          setError('Paste the M3U content');
          setBusy(false);
          return;
        }
        await api.addPlaylistText(name.trim(), text.trim());
      }
      setName('');
      setUrl('');
      setText('');
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'failed to add playlist');
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: number) {
    setBusy(true);
    try {
      await api.deletePlaylist(id);
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'failed to delete');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeScreen>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <View style={styles.content}>
          {/* header */}
          <View style={styles.header}>
            <Pressable onPress={() => goBack()} hitSlop={12}>
              <Text style={[styles.backText, { color: c.text }]}>‹</Text>
            </Pressable>
            <Text style={[styles.title, { color: c.text }]}>My Playlists</Text>
          </View>

          {/* add new */}
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
            {error && playlists.length > 0 ? <Text style={[styles.inlineError, { color: c.danger }]}>{error}</Text> : null}
            <Pressable
              onPress={add}
              disabled={busy}
              style={({ pressed }) => [styles.addBtn, { backgroundColor: pressed || busy ? c.elevated : c.accent }]}
            >
              {busy ? <ActivityIndicator size="small" color="#fff" /> : null}
              <Text style={styles.addBtnText}>{busy ? 'Importing…' : 'Add playlist'}</Text>
            </Pressable>
          </View>

          {/* list */}
          {loading ? (
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
                    onPress={() =>
                      router.push({ pathname: '/browse', params: { source: 'user:' + p.name.trim().toLowerCase().replace(/\s+/g, ' ') } })
                    }
                  >
                    <Text style={[styles.playlistName, { color: c.text }]}>{p.name}</Text>
                    <Text style={[styles.playlistMeta, { color: c.textMuted }]}>{p.channel_count} channels · tap to open</Text>
                  </Pressable>
                  <Pressable onPress={() => remove(p.id)} hitSlop={10}>
                    <Text style={[styles.deleteBtnText, { color: c.danger }]}>Delete</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          )}
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
});
