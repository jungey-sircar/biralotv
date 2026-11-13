import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { SafeScreen } from '@/components/SafeScreen';
import { TrailerPlayer } from '@/components/trailer-player';
import {
  discoverScraperBase,
  listPlayableOptions,
  pickPlayableStream,
  resolveEpisodeStream,
  resolveMovieStream,
  SCRAPER_SERVERS,
  ScraperError,
  type ScraperServerId,
  useScraperConfig,
} from '@/lib/scraper';
import {
  tmdbDetails,
  tmdbSeasonEpisodes,
  type TmdbDetails,
  type TmdbEpisodeSummary,
} from '@/lib/tmdb';
import { useTheme } from '@/theme';
import { useLocalStore } from '@/lib/store';
import { goBack, openPlayer } from '@/lib/util';

export default function VodDetail() {
  const params = useLocalSearchParams<{ kind?: string; id?: string; title?: string }>();
  const kind = params.kind === 'tv' ? 'tv' : 'movie';
  const id = Number(params.id ?? '');
  const { colors: c } = useTheme();
  const preferredServer = useScraperConfig(s => s.server);
  const [serverChoice, setServerChoice] = useState<ScraperServerId>(preferredServer);
  const [data, setData] = useState<TmdbDetails | null>(null);
  const [error, setError] = useState('');
  const [playing, setPlaying] = useState(false);

  const [season, setSeason] = useState(1);
  const [episode, setEpisode] = useState(1);
  const [episodes, setEpisodes] = useState<TmdbEpisodeSummary[]>([]);
  const [scraperReady, setScraperReady] = useState<boolean | null>(null);
  const [resolving, setResolving] = useState(false);
  const [streamError, setStreamError] = useState('');
  const [needsScraperSetup, setNeedsScraperSetup] = useState(false);

  const inList = useLocalStore(s => (data ? s.inWatchlist(data.item.id) : false));
  const currentMediaId = kind === 'tv' ? `scraper:tv:${id}:${season}:${episode}` : `scraper:movie:${id}`;
  const savedProgress = useLocalStore(s =>
    s.continueWatching.find(c => c.id === currentMediaId || (c.tmdbId === id && c.kind === kind)),
  );
  const toggleList = () => {
    if (data?.item) useLocalStore.getState().toggleWatchlist(data.item);
  };

  const load = useCallback(async () => {
    if (!id) {
      setError('This title has no TMDB id.');
      return;
    }
    setError('');
    try {
      const details = await tmdbDetails(kind, id);
      setData(details);
      if (kind === 'tv' && details.seasons.length > 0) {
        setSeason(prev =>
          details.seasons.some(s => s.season_number === prev)
            ? prev
            : details.seasons[0].season_number,
        );
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'could not load this title');
    }
  }, [kind, id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  useEffect(() => {
    let alive = true;
    discoverScraperBase({ probe: true })
      .then(url => {
        if (alive) setScraperReady(Boolean(url));
      })
      .catch(() => {
        if (alive) setScraperReady(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (kind !== 'tv' || !id) return;
    let alive = true;
    tmdbSeasonEpisodes(id, season)
      .then(list => {
        if (!alive) return;
        setEpisodes(list);
        if (list.length > 0 && !list.some(ep => ep.episode_number === episode)) {
          setEpisode(list[0].episode_number);
        }
      })
      .catch(() => {
        if (alive) setEpisodes([]);
      });
    return () => {
      alive = false;
    };
  }, [kind, id, season, episode]);

  const title = data?.item.title ?? params.title ?? 'Title';
  const meta = [
    data?.item.year,
    kind === 'tv' ? 'Series' : data?.runtime ? `${data.runtime} min` : 'Film',
    data?.item.rating ? `${data.item.rating}★` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  async function watchNow(resumePos?: number) {
    if (!id || resolving) return;
    setResolving(true);
    setStreamError('');
    setNeedsScraperSetup(false);

    // Immediately record movie/show into continue watching so it's stored from the start
    const mediaId = kind === 'tv' ? `scraper:tv:${id}:${season}:${episode}` : `scraper:movie:${id}`;
    useLocalStore.getState().saveContinueWatching({
      id: mediaId,
      title: kind === 'tv' ? `${title} · S${season} E${episode}` : title,
      poster: data?.item.poster,
      backdrop: data?.backdrop || data?.item.poster,
      source: 'stream-scraper',
      kind,
      tmdbId: id,
      season: kind === 'tv' ? season : undefined,
      episode: kind === 'tv' ? episode : undefined,
      position: resumePos ?? savedProgress?.position ?? 0,
      duration: savedProgress?.duration ?? (data?.runtime ? data.runtime * 60 : 0),
    });

    try {
      const res =
        kind === 'tv'
          ? await resolveEpisodeStream(id, season, episode, serverChoice)
          : await resolveMovieStream(id, serverChoice);
      setScraperReady(true);
      const variants = listPlayableOptions(res);
      const chosen = pickPlayableStream(res)?.url;
      if (!chosen) {
        setStreamError('No playable stream was returned by stream-scraper.');
        return;
      }
      openPlayer({
        id: mediaId,
        name: kind === 'tv' ? `${title} · S${season} E${episode}` : title,
        stream: chosen,
        source: `stream-scraper:${res.server}`,
        logo: data?.item.poster ?? '',
        hls: true,
        scraperServer: res.server,
        streamsJson: JSON.stringify(variants),
        subtitlesJson: res.subtitles?.length ? JSON.stringify(res.subtitles) : undefined,
        fresh: true,
        resumePos: resumePos ?? savedProgress?.position ?? 0,
      });
    } catch (e: unknown) {
      if (e instanceof ScraperError && e.code === 'NO_SCRAPER') {
        setScraperReady(false);
        setNeedsScraperSetup(true);
      }
      setStreamError(e instanceof Error ? e.message : 'Could not resolve a stream.');
    } finally {
      setResolving(false);
    }
  }

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

            <View style={[styles.card, { backgroundColor: c.surface }]}>
              <View style={styles.watchHeader}>
                <Text style={[styles.cardTitle, { color: c.text }]}>Watch in app</Text>
                <Text style={[styles.small, { color: scraperReady ? c.textSecondary : c.textMuted }]}>
                  {scraperReady === null
                    ? 'Checking stream-scraper…'
                    : scraperReady
                      ? 'stream-scraper connected'
                      : 'stream-scraper not detected'}
                </Text>
              </View>

              {kind === 'tv' ? (
                <View style={styles.epControls}>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.chipRow}
                  >
                    {data.seasons.length > 0
                      ? data.seasons.map(s => {
                          const active = s.season_number === season;
                          return (
                            <Pressable
                              key={s.season_number}
                              onPress={() => {
                                setSeason(s.season_number);
                                setEpisode(1);
                              }}
                              style={({ pressed }) => [
                                styles.chip,
                                { backgroundColor: active ? c.text : pressed ? c.pressed : c.elevated },
                              ]}
                            >
                              <Text style={[styles.chipText, { color: active ? c.bg : c.textSecondary }]}>
                                S{s.season_number}
                              </Text>
                            </Pressable>
                          );
                        })
                      : [1, 2, 3].map(sNum => {
                          const active = sNum === season;
                          return (
                            <Pressable
                              key={sNum}
                              onPress={() => {
                                setSeason(sNum);
                                setEpisode(1);
                              }}
                              style={({ pressed }) => [
                                styles.chip,
                                { backgroundColor: active ? c.text : pressed ? c.pressed : c.elevated },
                              ]}
                            >
                              <Text style={[styles.chipText, { color: active ? c.bg : c.textSecondary }]}>
                                S{sNum}
                              </Text>
                            </Pressable>
                          );
                        })}
                  </ScrollView>

                  {episodes.length > 0 ? (
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={styles.chipRow}
                    >
                      {episodes.map(ep => {
                        const active = ep.episode_number === episode;
                        return (
                          <Pressable
                            key={ep.episode_number}
                            onPress={() => setEpisode(ep.episode_number)}
                            style={({ pressed }) => [
                              styles.chip,
                              { backgroundColor: active ? c.accent : pressed ? c.pressed : c.elevated },
                            ]}
                          >
                            <Text style={[styles.chipText, { color: active ? '#fff' : c.textSecondary }]}>
                              E{ep.episode_number}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </ScrollView>
                  ) : (
                    <View style={styles.stepperRow}>
                      <Text style={[styles.small, { color: c.textSecondary }]}>Episode</Text>
                      <Pressable
                        onPress={() => setEpisode(e => Math.max(1, e - 1))}
                        style={[styles.stepBtn, { backgroundColor: c.elevated }]}
                      >
                        <Text style={[styles.chipText, { color: c.text }]}>−</Text>
                      </Pressable>
                      <Text style={[styles.stepVal, { color: c.text }]}>{episode}</Text>
                      <Pressable
                        onPress={() => setEpisode(e => e + 1)}
                        style={[styles.stepBtn, { backgroundColor: c.elevated }]}
                      >
                        <Text style={[styles.chipText, { color: c.text }]}>+</Text>
                      </Pressable>
                    </View>
                  )}
                </View>
              ) : null}

              <View style={styles.chipRowWrap}>
                {SCRAPER_SERVERS.map(srv => {
                  const active = serverChoice === srv.id;
                  return (
                    <Pressable
                      key={srv.id}
                      onPress={() => setServerChoice(srv.id)}
                      style={({ pressed }) => [
                        styles.chip,
                        { backgroundColor: active ? c.text : pressed ? c.pressed : c.elevated },
                      ]}
                    >
                      <Text style={[styles.chipText, { color: active ? c.bg : c.textSecondary }]}>
                        {srv.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <View style={styles.actionButtons}>
                <Pressable
                  onPress={() => void watchNow(savedProgress?.position)}
                  disabled={resolving}
                  style={({ pressed }) => [
                    styles.watchBtn,
                    { backgroundColor: pressed || resolving ? c.elevated : c.accent, flex: 1 },
                  ]}
                >
                  {resolving ? <ActivityIndicator size="small" color="#fff" /> : null}
                  <Text style={styles.buttonText}>
                    {resolving
                      ? 'Resolving stream…'
                      : savedProgress && savedProgress.position > 15
                        ? `▶ Resume (${Math.floor(savedProgress.position / 60)}m)`
                        : kind === 'tv'
                          ? `▶ Watch S${season} E${episode}`
                          : '▶ Watch movie'}
                  </Text>
                </Pressable>

                <Pressable
                  onPress={toggleList}
                  style={({ pressed }) => [
                    styles.listBtn,
                    {
                      backgroundColor: inList ? c.text : c.elevated,
                      opacity: pressed ? 0.75 : 1,
                    },
                  ]}
                >
                  <Text style={[styles.listBtnText, { color: inList ? c.bg : c.text }]}>
                    {inList ? '✓ In My List' : '+ My List'}
                  </Text>
                </Pressable>
              </View>

              {savedProgress && savedProgress.position > 15 ? (
                <Pressable
                  onPress={() => void watchNow(0)}
                  disabled={resolving}
                  style={styles.restartBtn}
                >
                  <Text style={[styles.restartBtnText, { color: c.textMuted }]}>
                    ↺ Watch from beginning
                  </Text>
                </Pressable>
              ) : null}

              {streamError ? (
                <View style={styles.streamErrBox}>
                  <Text style={[styles.streamErrText, { color: c.danger }]}>{streamError}</Text>
                  {needsScraperSetup ? (
                    <Pressable onPress={() => router.push('/settings')} hitSlop={6}>
                      <Text style={[styles.link, { color: c.accent }]}>Open Settings to configure ›</Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : null}
            </View>

            <View style={styles.actions}>
              {data.trailerKey ? (
                <Pressable
                  onPress={() => setPlaying(v => !v)}
                  style={({ pressed }) => [styles.button, { backgroundColor: pressed ? c.elevated : c.surface }]}
                >
                  <Text style={[styles.buttonTextAlt, { color: c.text }]}>
                    {playing ? 'Hide trailer' : 'Play trailer'}
                  </Text>
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
              <TrailerPlayer youtubeKey={data.trailerKey} style={styles.player} />
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
  watchHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  epControls: {
    gap: 8,
  },
  chipRow: {
    flexDirection: 'row',
    gap: 8,
  },
  chipRowWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  chipText: {
    fontSize: 12,
    fontWeight: '700',
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  stepBtn: {
    borderRadius: 999,
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepVal: {
    fontSize: 13,
    fontWeight: '800',
    minWidth: 20,
    textAlign: 'center',
  },
  watchBtn: {
    borderRadius: 999,
    paddingVertical: 12,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  actionButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  listBtn: {
    borderRadius: 999,
    paddingVertical: 12,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listBtnText: {
    fontSize: 13,
    fontWeight: '700',
  },
  restartBtn: {
    paddingVertical: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  restartBtnText: {
    fontSize: 12,
    fontWeight: '600',
  },
  streamErrBox: {
    gap: 6,
  },
  streamErrText: {
    fontSize: 12.5,
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
