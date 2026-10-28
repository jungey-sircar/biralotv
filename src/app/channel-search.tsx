import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { SafeScreen } from '@/components/SafeScreen';
import { ChannelGrid } from '@/components/grid';
import type { Channel } from '@/lib/api';
import { searchAllChannels } from '@/lib/iptv';
import { filterAdult, useSettings, useTheme } from '@/theme';
import { goBack, openPlayer } from '@/lib/util';

export default function ChannelSearch() {
  const { colors: c } = useTheme();
  const showAdult = useSettings(s => s.showAdult);
  const dims = useWindowDimensions();
  const cols = useMemo(() => {
    const horiz = dims.width > dims.height;
    const usable = Math.max(320, dims.width - (horiz ? 90 : 36));
    return Math.min(8, Math.max(3, Math.floor(usable / 116)));
  }, [dims.width, dims.height]);

  const [input, setInput] = useState('');
  const [q, setQ] = useState('');
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setQ(input.trim()), 300);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [input]);

  const run = useCallback(
    async (term: string) => {
      if (!term) {
        setChannels([]);
        setError('');
        setLoading(false);
        return;
      }
      setLoading(true);
      setError('');
      try {
        const hits = await searchAllChannels(term);
        setChannels(filterAdult(hits, showAdult));
      } catch (e: unknown) {
        setChannels([]);
        setError(e instanceof Error ? e.message : 'could not reach the channel guide');
      } finally {
        setLoading(false);
      }
    },
    [showAdult],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void run(q);
  }, [run, q]);

  return (
    <SafeScreen>
      <View style={styles.headerArea}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => goBack()} hitSlop={12}>
            <Text style={[styles.backText, { color: c.text }]}>‹</Text>
          </Pressable>
          <Text style={[styles.headerTitle, { color: c.text }]}>Search channels</Text>
          {channels.length > 0 ? (
            <Text style={[styles.count, { color: c.textMuted }]}>{channels.length}</Text>
          ) : null}
        </View>
        <View style={[styles.searchBox, { backgroundColor: c.surface }]}>
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder="Any channel in the iptv-org guide…"
            placeholderTextColor={c.textMuted}
            style={[styles.searchInput, { color: c.text }]}
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
            autoFocus
          />
        </View>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={c.accent} />
          <Text style={[styles.hint, { color: c.textMuted }]}>
            {channels.length > 0 ? 'Searching…' : 'Loading the full channel guide…'}
          </Text>
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={[styles.hint, { color: c.textSecondary }]}>{error}</Text>
          <Pressable
            onPress={() => void run(q)}
            style={({ pressed }) => [styles.retryBtn, { backgroundColor: pressed ? c.elevated : c.accent }]}
          >
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : q && channels.length === 0 ? (
        <View style={styles.center}>
          <Text style={[styles.hint, { color: c.textSecondary }]}>No channel matches “{q}”.</Text>
        </View>
      ) : channels.length > 0 ? (
        <View style={styles.gridArea}>
          <ChannelGrid channels={channels} cols={cols} onPress={openPlayer} />
        </View>
      ) : (
        <View style={styles.center}>
          <Text style={[styles.hint, { color: c.textMuted }]}>
            Type a channel name, sport, genre or country. The whole iptv-org guide is searched, not just
            one shelf.
          </Text>
        </View>
      )}
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  headerArea: {
    paddingTop: 8,
    paddingHorizontal: 20,
    gap: 10,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  backText: {
    fontSize: 22,
    marginTop: -2,
  },
  headerTitle: {
    fontWeight: 800,
    fontSize: 16,
    flex: 1,
  },
  count: {
    fontSize: 12,
  },
  searchBox: {
    borderRadius: 14,
    paddingHorizontal: 14,
  },
  searchInput: {
    paddingVertical: 10,
    fontSize: 14,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
    padding: 28,
  },
  hint: {
    textAlign: 'center',
    fontSize: 13,
    lineHeight: 19,
  },
  retryBtn: {
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  retryText: {
    color: '#fff',
    fontWeight: '700',
  },
  gridArea: {
    flex: 1,
  },
});
