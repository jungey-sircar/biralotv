import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { WebView } from 'react-native-webview';
import { router, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { SafeScreen } from '@/components/SafeScreen';
import { tmdbDetails, type TmdbDetails } from '@/lib/tmdb';
import { useTheme } from '@/theme';
import { goBack } from '@/lib/util';

export default function VodDetail() {
  const params = useLocalSearchParams<{ kind?: string; id?: string; title?: string }>();
  const kind = params.kind === 'tv' ? 'tv' : 'movie';
  const id = Number(params.id ?? '');
  const { colors: c } = useTheme();
  const [data, setData] = useState<TmdbDetails | null>(null);
  const [error, setError] = useState('');
  const [playing, setPlaying] = useState(false);

  const load = useCallback(async () => {
    if (!id) {
      setError('This title has no TMDB id.');
      return;
    }
    setError('');
    try {
      setData(await tmdbDetails(kind, id));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'could not load this title');
    }
  }, [kind, id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const title = data?.item.title ?? params.title ?? 'Title';
  const meta = [
    data?.item.year,
    kind === 'tv' ? 'Series' : data?.runtime ? `${data.runtime} min` : 'Film',
    data?.item.rating ? `${data.item.rating}★` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  async function openProviders() {
    await WebBrowser.openBrowserAsync(
      `https://www.themoviedb.org/${kind}/${id}/watch?locale=en-US&watch_region=US`,
      { showInRecents: true },
    ).catch(() => {});
  }

  return (
    <SafeScreen>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Pressable onPress={() => goBack()} hitSlop={12}>
            <Text style={[styles.backText, { color: c.text }]}>‹</Text>
          </Pressable>
          <Text numberOfLines={1} style={[styles.headerTitle, { color: c.text }]}>
            {title}
          </Text>
        </View>

        {error ? (
          <View style={styles.card}>
            <Text style={[styles.errorText, { color: c.danger }]}>{error}</Text>
            <Pressable
              onPress={load}
              style={({ pressed }) => [styles.button, { backgroundColor: pressed ? c.elevated : c.accent }]}
            >
              <Text style={styles.buttonText}>Retry</Text>
            </Pressable>
          </View>
        ) : !data ? (
          <View style={styles.loading}>
            <ActivityIndicator size="large" color={c.accent} />
          </View>
        ) : (
          <>
            {data.backdrop ? (
              <Image
                source={{ uri: data.backdrop }}
                style={styles.backdrop}
                contentFit="cover"
                cachePolicy="disk"
                transition={200}
              />
            ) : null}

            <View style={styles.titleRow}>
              {data.item.poster ? (
                <Image
                  source={{ uri: data.item.poster }}
                  style={styles.poster}
                  contentFit="cover"
                  cachePolicy="disk"
                />
              ) : null}
              <View style={styles.titleMeta}>
                <Text style={[styles.title, { color: c.text }]}>{data.item.title}</Text>
                {meta ? <Text style={[styles.meta, { color: c.textMuted }]}>{meta}</Text> : null}
                {data.genres.length ? (
                  <Text style={[styles.genres, { color: c.textSecondary }]}>{data.genres.join(' · ')}</Text>
                ) : null}
              </View>
            </View>

            {data.item.overview ? (
              <Text style={[styles.overview, { color: c.textSecondary }]}>{data.item.overview}</Text>
            ) : null}

            <View style={styles.actions}>
              {data.trailerKey ? (
                <Pressable
                  onPress={() => setPlaying(v => !v)}
                  style={({ pressed }) => [styles.button, { backgroundColor: pressed ? c.elevated : c.accent }]}
                >
                  <Text style={styles.buttonText}>{playing ? 'Hide trailer' : 'Play trailer'}</Text>
                </Pressable>
              ) : null}
              <Pressable
                onPress={() =>
                  router.push({ pathname: '/on-demand', params: { scope: 'films', query: data.item.title } })
                }
                style={({ pressed }) => [styles.button, { backgroundColor: pressed ? c.elevated : c.surface }]}
              >
                <Text style={[styles.buttonTextAlt, { color: c.text }]}>Search free copies</Text>
              </Pressable>
            </View>

            {playing && data.trailerKey ? (
              <WebView
                source={{ uri: `https://www.youtube.com/embed/${data.trailerKey}?autoplay=1` }}
                style={styles.player}
                allowsFullscreenVideo
                allowsInlineMediaPlayback
                mediaPlaybackRequiresUserAction={false}
              />
            ) : null}

            <View style={[styles.card, { backgroundColor: c.surface }]}>
              <Text style={[styles.cardTitle, { color: c.text }]}>Where to watch legally</Text>
              {data.providers.length ? (
                <View style={styles.providerRow}>
                  {data.providers.map(p => (
                    <Pressable
                      key={p.name}
                      onPress={openProviders}
                      style={({ pressed }) => [styles.provider, { backgroundColor: pressed ? c.pressed : c.elevated }]}
                    >
                      <Text style={[styles.providerText, { color: c.text }]} numberOfLines={1}>
                        {p.name}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              ) : (
                <Text style={[styles.small, { color: c.textMuted }]}>
                  No listing for the US region. Open the TMDB watch page to check your country.
                </Text>
              )}
              <Pressable onPress={openProviders} hitSlop={6}>
                <Text style={[styles.link, { color: c.accent }]}>Open full availability ›</Text>
              </Pressable>
              <Text style={[styles.small, { color: c.textMuted }]}>
                biralotv does not host or stream this title. Public-domain and Creative Commons films play
                in-app; everything else opens in your provider app.
              </Text>
            </View>
          </>
        )}
      </ScrollView>
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 20,
    paddingTop: 8,
    gap: 14,
    paddingBottom: 48,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  backText: {
    fontSize: 22,
    marginTop: -2,
  },
  headerTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: '800',
  },
  loading: {
    paddingVertical: 60,
    alignItems: 'center',
  },
  errorText: {
    fontSize: 13,
    marginBottom: 10,
  },
  backdrop: {
    width: '100%',
    height: 200,
    borderRadius: 18,
    backgroundColor: '#000',
  },
  titleRow: {
    flexDirection: 'row',
    gap: 14,
    alignItems: 'flex-start',
  },
  poster: {
    width: 96,
    height: 144,
    borderRadius: 12,
    backgroundColor: '#000',
  },
  titleMeta: {
    flex: 1,
    gap: 6,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    lineHeight: 26,
  },
  meta: {
    fontSize: 12.5,
  },
  genres: {
    fontSize: 12.5,
  },
  overview: {
    fontSize: 13.5,
    lineHeight: 21,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  button: {
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 11,
  },
  buttonText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 13,
  },
  buttonTextAlt: {
    fontWeight: '800',
    fontSize: 13,
  },
  player: {
    width: '100%',
    height: 220,
    borderRadius: 16,
    backgroundColor: '#000',
  },
  card: {
    borderRadius: 16,
    padding: 15,
    gap: 10,
  },
  cardTitle: {
    fontWeight: '800',
    fontSize: 14,
  },
  providerRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  provider: {
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    maxWidth: '100%',
  },
  providerText: {
    fontSize: 12,
    fontWeight: '700',
  },
  link: {
    fontSize: 12.5,
    fontWeight: '800',
  },
  small: {
    fontSize: 11.5,
    lineHeight: 17,
  },
});
