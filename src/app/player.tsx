import { api, apiBase, Channel } from '@/lib/api';
import {
  fetchEpisodeSubtitles,
  fetchMovieSubtitles,
  listPlayableOptions,
  parseScraperChannelId,
  pickPlayableStream,
  resolveEpisodeStream,
  resolveMovieStream,
  type ConcreteScraperServer,
  type ScraperStreamVariant,
  useScraperConfig,
} from '@/lib/scraper';
import {
  mergeSubtitleLists,
  parseSubtitlesParam,
  pickDefaultSubtitleTrack,
  SUBTITLE_SIZE_CHOICES,
  type SubtitleTrackItem,
  useSubtitlePrefs,
} from '@/lib/subtitles';
import { useLocalStore } from '@/lib/store';
import { goBack } from '@/lib/util';
import { useTheme } from '@/theme';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { SafeScreen } from '@/components/SafeScreen';
import { StreamPlayer } from '@/components/stream-player';

const MB_UA = 'Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36';
function embedUrl(ch: Channel): string | null {
  if (!ch.number) return null;
  if (ch.source.startsWith('mapple-premium') || ch.source.startsWith('mapple-sports')) {
    return `https://dlive.sx/stream/stream-${ch.number}.php`;
  }
  return null;
}

const SCRAPER_SERVERS: { id: ConcreteScraperServer; label: string }[] = [
  { id: 'server1', label: 'Server 1' },
  { id: 'server2', label: 'Server 2' },
  { id: 'server3', label: 'Server 3' },
];

function parseConcreteServer(raw?: string): ConcreteScraperServer | undefined {
  if (raw === 'server1' || raw === 'server2' || raw === 'server3') return raw;
  return undefined;
}

function parseStreamsParam(raw?: string): ScraperStreamVariant[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (v): v is ScraperStreamVariant =>
        Boolean(v) && typeof v === 'object' && typeof v.url === 'string' && typeof v.quality === 'string',
    );
  } catch {
    return [];
  }
}

type PlayerParams = {
  id: string;
  name?: string;
  stream?: string;
  source?: string;
  logo?: string;
  number?: string;
  hls?: string;
  scraperServer?: string;
  streamsJson?: string;
  subtitlesJson?: string;
  fresh?: string;
  resumePos?: string;
};

function subtitleSourceBadge(source?: string): string {
  if (!source) return '';
  if (source === 'opensubtitles') return 'OpenSubtitles';
  if (source === 'archive') return 'Archive';
  if (source === 'server1') return 'Server 1';
  if (source === 'server2') return 'Server 2';
  if (source === 'server3') return 'Server 3';
  return source;
}

export default function Player() {
  const params = useLocalSearchParams<PlayerParams>();
  const sessionKey = `${params.id ?? ''}|${params.fresh ?? ''}|${params.stream ?? ''}`;
  return <PlayerSession key={sessionKey} params={params} />;
}

function PlayerSession({ params }: { params: PlayerParams }) {
  const id = params.id ?? '';
  const server = apiBase();
  const { colors: c } = useTheme();
  const subEnabled = useSubtitlePrefs(s => s.enabled);
  const preferredSubLang = useSubtitlePrefs(s => s.preferredLanguage);
  const subTextSize = useSubtitlePrefs(s => s.textSize);
  const setSubTextSize = useSubtitlePrefs(s => s.setTextSize);

  const scraperTarget = useMemo(() => parseScraperChannelId(id), [id]);
  const initialStreams = useMemo(() => parseStreamsParam(params.streamsJson), [params.streamsJson]);
  const initialSubtitles = useMemo(() => parseSubtitlesParam(params.subtitlesJson), [params.subtitlesJson]);

  const [remote, setRemote] = useState<Channel | null>(null);
  const [resolvedStream, setResolvedStream] = useState('');
  const [variants, setVariants] = useState<ScraperStreamVariant[]>(initialStreams);
  const [subtitles, setSubtitles] = useState<SubtitleTrackItem[]>(initialSubtitles);
  const [subOverride, setSubOverride] = useState<
    { mode: 'off' } | { mode: 'track'; id: string } | null
  >(null);
  const [subtitleOffsetSec, setSubtitleOffsetSec] = useState(0);
  const [subPickerOpen, setSubPickerOpen] = useState(false);
  const [subNote, setSubNote] = useState('');
  const [subsLoading, setSubsLoading] = useState(false);

  const [activeServer, setActiveServer] = useState<ConcreteScraperServer | undefined>(() =>
    parseConcreteServer(params.scraperServer),
  );
  const [scraperBusy, setScraperBusy] = useState(() =>
    Boolean(scraperTarget && !(params.fresh === '1' && params.stream)),
  );
  const [error, setError] = useState('');
  const [playbackError, setPlaybackError] = useState('');
  const resolveSeq = useRef(0);

  const initialPos = useMemo(() => {
    if (params.resumePos) {
      const p = Number(params.resumePos);
      if (Number.isFinite(p) && p > 0) return p;
    }
    const saved = useLocalStore.getState().continueWatching.find(c => c.id === id);
    if (saved && saved.position > 5) {
      if (saved.duration > 0 && saved.position / saved.duration > 0.95) return 0;
      return saved.position;
    }
    return 0;
  }, [id, params.resumePos]);

  const currentPosRef = useRef(initialPos);
  const currentDurRef = useRef(0);

  const flushProgress = useCallback(() => {
    const pos = currentPosRef.current;
    const dur = currentDurRef.current;
    if (id && pos > 0) {
      useLocalStore.getState().updatePlaybackProgress(id, pos, dur);
    }
  }, [id]);

  const lastProgressSaveRef = useRef(0);
  const handleProgress = useCallback(
    ({ position, duration }: { position: number; duration: number }) => {
      currentPosRef.current = position;
      if (duration > 0) currentDurRef.current = duration;
      const now = Date.now();
      if (now - lastProgressSaveRef.current >= 2000) {
        lastProgressSaveRef.current = now;
        useLocalStore.getState().updatePlaybackProgress(id, position, duration);
      }
    },
    [id],
  );

  // 1. Flush progress when player component unmounts
  useEffect(() => {
    return () => {
      flushProgress();
    };
  }, [flushProgress]);

  // 2. Flush progress when app moves to background (Android / iOS app exit/switch)
  useEffect(() => {
    const sub = AppState.addEventListener('change', nextState => {
      if (nextState !== 'active') {
        flushProgress();
      }
    });
    return () => sub.remove();
  }, [flushProgress]);

  // 3. Flush progress on desktop window close / beforeunload
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const onExit = () => flushProgress();
    window.addEventListener('beforeunload', onExit);
    window.addEventListener('pagehide', onExit);
    return () => {
      window.removeEventListener('beforeunload', onExit);
      window.removeEventListener('pagehide', onExit);
    };
  }, [flushProgress]);

  const fromParams = useMemo<Channel | null>(() => {
    if (!id) return null;
    return {
      id,
      name: params.name || 'Live channel',
      stream: params.stream || undefined,
      source: params.source || '',
      logo: params.logo || undefined,
      number: params.number ? Number(params.number) : undefined,
      updated: '',
    };
  }, [id, params.name, params.stream, params.source, params.logo, params.number]);

  const resolveScraper = useCallback(
    async (serverPref?: ConcreteScraperServer | 'auto') => {
      if (!scraperTarget) return;
      const reqId = ++resolveSeq.current;
      setScraperBusy(true);
      setError('');
      setPlaybackError('');
      try {
        const res =
          scraperTarget.kind === 'tv'
            ? await resolveEpisodeStream(
                scraperTarget.tmdbId,
                scraperTarget.season,
                scraperTarget.episode,
                serverPref,
              )
            : await resolveMovieStream(scraperTarget.tmdbId, serverPref);
        if (resolveSeq.current !== reqId) return;
        const list = listPlayableOptions(res);
        const chosen = pickPlayableStream(res)?.url ?? '';
        if (!chosen) {
          setError('No playable stream was found for this title.');
          return;
        }
        setVariants(list);
        setActiveServer(res.server);
        setResolvedStream(chosen);
        setSubNote('');
        setSubOverride(null);
        setSubtitles(prev =>
          mergeSubtitleLists(
            res.subtitles ?? [],
            prev.filter(s => s.source === 'opensubtitles'),
          ),
        );
      } catch (e: unknown) {
        if (resolveSeq.current !== reqId) return;
        setError(e instanceof Error ? e.message : 'failed to resolve stream');
      } finally {
        if (resolveSeq.current === reqId) setScraperBusy(false);
      }
    },
    [scraperTarget],
  );

  useEffect(() => {
    if (!scraperTarget) return;
    if (params.fresh === '1' && params.stream) return;
    const fallbackServer =
      parseConcreteServer(params.scraperServer) ?? useScraperConfig.getState().server;
    let alive = true;
    const run = async () => {
      try {
        const res =
          scraperTarget.kind === 'tv'
            ? await resolveEpisodeStream(
                scraperTarget.tmdbId,
                scraperTarget.season,
                scraperTarget.episode,
                fallbackServer,
              )
            : await resolveMovieStream(scraperTarget.tmdbId, fallbackServer);
        if (!alive) return;
        const list = listPlayableOptions(res);
        const chosen = pickPlayableStream(res)?.url ?? '';
        if (!chosen) {
          setError('No playable stream was found for this title.');
          return;
        }
        setVariants(list);
        setActiveServer(res.server);
        setResolvedStream(chosen);
        setSubNote('');
        setSubOverride(null);
        setSubtitles(prev =>
          mergeSubtitleLists(
            res.subtitles ?? [],
            prev.filter(s => s.source === 'opensubtitles'),
          ),
        );
      } catch (e: unknown) {
        if (alive) setError(e instanceof Error ? e.message : 'failed to resolve stream');
      } finally {
        if (alive) setScraperBusy(false);
      }
    };
    void run();
    return () => {
      alive = false;
    };
  }, [scraperTarget, params.fresh, params.stream, params.scraperServer]);

  const channel = useMemo<Channel | null>(() => {
    const base = remote ?? fromParams;
    if (!base) return null;
    if (!resolvedStream && !activeServer) return base;
    return {
      ...base,
      stream: resolvedStream || base.stream,
      source: activeServer ? `stream-scraper:${activeServer}` : base.source,
    };
  }, [remote, fromParams, resolvedStream, activeServer]);

  const fav = useLocalStore(s => (channel ? s.favorites.some(f => f.id === channel.id) : false));

  useEffect(() => {
    if (scraperTarget || fromParams?.stream || !server || !id) return;
    let alive = true;
    api
      .channel(id)
      .then(ch => {
        if (alive) setRemote(ch);
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : 'failed to load channel');
      });
    return () => {
      alive = false;
    };
  }, [scraperTarget, fromParams, id, server]);

  useEffect(() => {
    if (!id) router.replace('/');
  }, [id]);

  function toggleFav() {
    if (!channel) return;
    if (fav) api.removeFavorite(channel.id);
    else api.addFavorite(channel);
  }

  const isEmbed = channel ? embedUrl(channel) !== null : false;
  const stream = useMemo(() => {
    if (!channel || isEmbed) return undefined;
    if (resolvedStream) return resolvedStream;
    if (scraperTarget && params.fresh !== '1') return undefined;
    return channel.stream;
  }, [channel, isEmbed, resolvedStream, scraperTarget, params.fresh]);

  useEffect(() => {
    if (channel && (!scraperTarget || Boolean(channel.stream))) {
      api.addRecent(channel);
    }
    const isVodMedia =
      scraperTarget !== null ||
      id.startsWith('scraper:') ||
      id.startsWith('tmdb:') ||
      id.startsWith('archive:') ||
      id.startsWith('server:') ||
      id.startsWith('ms:') ||
      id.startsWith('pluto:');

    if (channel && stream && isVodMedia) {
      useLocalStore.getState().saveContinueWatching({
        id,
        title: channel.name,
        poster: channel.logo,
        source: channel.source,
        stream,
        kind: scraperTarget?.kind,
        tmdbId: scraperTarget?.tmdbId,
        season: scraperTarget && scraperTarget.kind === 'tv' ? scraperTarget.season : undefined,
        episode: scraperTarget && scraperTarget.kind === 'tv' ? scraperTarget.episode : undefined,
        position: currentPosRef.current > 0 ? currentPosRef.current : initialPos,
        duration: currentDurRef.current > 0 ? currentDurRef.current : 0,
      });
    }
  }, [channel, scraperTarget, stream, id, initialPos]);

  const isHls =
    params.hls === '1'
      ? true
      : params.hls === '0'
        ? false
        : scraperTarget !== null
          ? true
          : undefined;

  const webSrc = useMemo(() => (channel ? embedUrl(channel) : null), [channel]);
  const resolving =
    scraperBusy || (!!server && !!id && !scraperTarget && !remote && !fromParams?.stream && !error);
  const displayError = error || playbackError;

  const subsEnrichedRef = useRef(false);
  useEffect(() => {
    if (!scraperTarget || !stream || subsEnrichedRef.current) return;
    subsEnrichedRef.current = true;
    let alive = true;
    const req =
      scraperTarget.kind === 'tv'
        ? fetchEpisodeSubtitles(scraperTarget.tmdbId, scraperTarget.season, scraperTarget.episode)
        : fetchMovieSubtitles(scraperTarget.tmdbId);
    void Promise.resolve().then(() => {
      if (alive) setSubsLoading(true);
    });
    req
      .then(extra => {
        if (!alive || extra.length === 0) return;
        setSubtitles(prev => mergeSubtitleLists(prev, extra));
      })
      .finally(() => {
        if (alive) setSubsLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [scraperTarget, stream]);

  const selectedSubId = useMemo(() => {
    if (subOverride?.mode === 'off') return null;
    if (subOverride?.mode === 'track') {
      if (subtitles.some(s => s.id === subOverride.id)) return subOverride.id;
    }
    if (!subEnabled || subtitles.length === 0) return null;
    return pickDefaultSubtitleTrack(subtitles, preferredSubLang)?.id ?? null;
  }, [subOverride, subtitles, subEnabled, preferredSubLang]);

  const activeSubTrack = useMemo(
    () => (selectedSubId ? subtitles.find(s => s.id === selectedSubId) ?? null : null),
    [subtitles, selectedSubId],
  );

  const offsetLabel =
    Math.abs(subtitleOffsetSec) < 0.05
      ? '0.0s'
      : `${subtitleOffsetSec > 0 ? '+' : ''}${subtitleOffsetSec.toFixed(1)}s`;

  return (
    <SafeScreen noBottom>
      {!channel ? (
        <View style={styles.center}>
          <Text style={[styles.errorTitle, { color: c.text }]}>Nothing to play</Text>
          <Text style={[styles.errorMsg, { color: c.textSecondary }]}>
            {displayError || 'This screen was opened without a channel. Go back and pick one from the list.'}
          </Text>
          <Pressable
            onPress={goBack}
            style={({ pressed }) => [styles.errorBtn, { backgroundColor: pressed ? c.elevated : c.accent }]}
          >
            <Text style={styles.errorBtnText}>Back to channels</Text>
          </Pressable>
        </View>
      ) : null}

      {channel && displayError ? (
        <View style={styles.center}>
          <Text style={[styles.errorTitle, { color: c.text }]}>
            Can&apos;t play this {scraperTarget ? 'title' : 'channel'}
          </Text>
          <Text style={[styles.errorMsg, { color: c.textSecondary }]}>{displayError}</Text>
          {scraperTarget ? (
            <View style={styles.errorActions}>
              {SCRAPER_SERVERS.map(srv => {
                const active = activeServer === srv.id;
                return (
                  <Pressable
                    key={srv.id}
                    disabled={scraperBusy}
                    onPress={() => void resolveScraper(srv.id)}
                    style={({ pressed }) => [
                      styles.pill,
                      { backgroundColor: active ? c.accent : pressed ? c.pressed : c.surface },
                    ]}
                  >
                    <Text style={[styles.pillText, { color: active ? '#fff' : c.textSecondary }]}>
                      {srv.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}
          <View style={styles.errorActions}>
            {scraperTarget ? (
              <Pressable
                onPress={() => {
                  const nextOnPlaybackErr: ConcreteScraperServer =
                    activeServer === 'server1'
                      ? 'server2'
                      : activeServer === 'server2'
                        ? 'server3'
                        : 'server1';
                  void resolveScraper(playbackError && activeServer ? nextOnPlaybackErr : activeServer ?? 'auto');
                }}
                style={({ pressed }) => [styles.errorBtn, { backgroundColor: pressed ? c.elevated : c.accent }]}
              >
                <Text style={styles.errorBtnText}>
                  {playbackError && activeServer ? 'Try next server' : 'Retry'}
                </Text>
              </Pressable>
            ) : null}
            {scraperTarget ? (
              <Pressable
                onPress={() => router.push('/settings')}
                style={({ pressed }) => [styles.errorBtn, { backgroundColor: pressed ? c.pressed : c.surface }]}
              >
                <Text style={[styles.errorBtnText, { color: c.text }]}>Settings</Text>
              </Pressable>
            ) : null}
            <Pressable
              onPress={goBack}
              style={({ pressed }) => [
                styles.errorBtn,
                { backgroundColor: pressed ? c.elevated : scraperTarget ? c.surface : c.accent },
              ]}
            >
              <Text style={[styles.errorBtnText, scraperTarget ? { color: c.text } : null]}>Back</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {channel && !displayError ? (
        <View style={styles.videoWrap}>
          <View style={styles.topBar}>
            <Pressable onPress={goBack} hitSlop={12}>
              <Text style={styles.topBarBack}>‹</Text>
            </Pressable>
            <Text numberOfLines={1} style={styles.topBarTitle}>
              {channel.name}
            </Text>
            {!isEmbed && (subtitles.length > 0 || scraperTarget) ? (
              <Pressable
                onPress={() => setSubPickerOpen(true)}
                hitSlop={8}
                style={({ pressed }) => [
                  styles.ccBtn,
                  {
                    backgroundColor: activeSubTrack
                      ? c.accent
                      : pressed
                        ? c.pressed
                        : 'rgba(255,255,255,0.16)',
                  },
                ]}
              >
                <Text style={styles.ccBtnText} numberOfLines={1}>
                  {subsLoading && subtitles.length === 0
                    ? 'CC …'
                    : activeSubTrack
                      ? `CC · ${activeSubTrack.label}`
                      : 'CC · Off'}
                </Text>
              </Pressable>
            ) : null}
            <Pressable onPress={toggleFav} hitSlop={12}>
              <Text style={[styles.topBarFav, { color: fav ? c.accent : '#fff' }]}>{fav ? '♥' : '♡'}</Text>
            </Pressable>
          </View>

          {scraperTarget && (variants.length > 0 || activeServer) ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.controlsBar}
              contentContainerStyle={styles.controlsRow}
            >
              {SCRAPER_SERVERS.map(srv => {
                const active = activeServer === srv.id;
                return (
                  <Pressable
                    key={srv.id}
                    disabled={scraperBusy}
                    onPress={() => void resolveScraper(srv.id)}
                    style={({ pressed }) => [
                      styles.pill,
                      { backgroundColor: active ? c.accent : pressed ? c.pressed : c.surface },
                    ]}
                  >
                    <Text style={[styles.pillText, { color: active ? '#fff' : c.textSecondary }]}>
                      {srv.label}
                    </Text>
                  </Pressable>
                );
              })}
              {variants.length > 1
                ? variants.map(v => {
                    const active = stream === v.url;
                    return (
                      <Pressable
                        key={`${v.quality}-${v.url}`}
                        onPress={() => {
                          setPlaybackError('');
                          setResolvedStream(v.url);
                        }}
                        style={({ pressed }) => [
                          styles.pill,
                          { backgroundColor: active ? c.text : pressed ? c.pressed : c.surface },
                        ]}
                      >
                        <Text style={[styles.pillText, { color: active ? c.bg : c.textSecondary }]}>
                          {v.quality}
                        </Text>
                      </Pressable>
                    );
                  })
                : null}
            </ScrollView>
          ) : null}

          {isEmbed ? (
            <WebView
              source={{ uri: webSrc as string }}
              style={styles.video}
              userAgent={MB_UA}
              javaScriptEnabled
              domStorageEnabled
              mediaPlaybackRequiresUserAction={false}
              allowsFullscreenVideo
              allowsInlineMediaPlayback
              mixedContentMode="always"
              setSupportMultipleWindows={false}
              onShouldStartLoadWithRequest={req => {
                if (req.isTopFrame && req.url.startsWith('http')) {
                  return req.url.includes('dlive.sx') || req.url.includes('dembed.st') || req.url.includes('mapple');
                }
                return true;
              }}
              startInLoadingState
              renderLoading={() => (
                <View style={styles.center}>
                  <ActivityIndicator size="large" color={c.accent} />
                </View>
              )}
            />
          ) : resolving ? (
            <View style={styles.center}>
              <ActivityIndicator size="large" color={c.accent} />
              <Text style={[styles.loadingText, { color: c.textSecondary }]}>
                {scraperTarget ? 'Resolving movie stream…' : 'Loading stream…'}
              </Text>
            </View>
          ) : stream ? (
            <StreamPlayer
              stream={stream}
              isHls={isHls}
              title={channel.name}
              artwork={channel.logo}
              subtitles={subtitles}
              selectedSubtitleId={selectedSubId}
              subtitleOffsetSec={subtitleOffsetSec}
              subtitleSize={subTextSize}
              initialPosition={initialPos}
              onProgress={handleProgress}
              onNativeSubtitleSelect={track => {
                setSubOverride(track ? { mode: 'track', id: track.id } : { mode: 'off' });
                setSubNote('');
              }}
              onSubtitleError={msg => setSubNote(msg)}
              onError={msg => setPlaybackError(msg)}
              style={styles.video}
            />
          ) : (
            <View style={styles.center}>
              <Text style={[styles.errorMsg, { color: c.textSecondary }]}>
                No stream URL available for this {scraperTarget ? 'title' : 'channel'}.
              </Text>
              <Pressable
                onPress={goBack}
                style={({ pressed }) => [styles.errorBtn, { backgroundColor: pressed ? c.elevated : c.accent }]}
              >
                <Text style={styles.errorBtnText}>Back</Text>
              </Pressable>
            </View>
          )}
        </View>
      ) : null}

      <Modal
        visible={subPickerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setSubPickerOpen(false)}
      >
        <View style={styles.modalRoot}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setSubPickerOpen(false)} />
          <View style={[styles.subSheet, { backgroundColor: c.elevated }]}>
            <View style={styles.subSheetHeader}>
              <View>
                <Text style={[styles.subSheetTitle, { color: c.text }]}>Subtitles</Text>
                <Text style={[styles.subSheetMeta, { color: c.textMuted }]}>
                  {subsLoading && subtitles.length === 0
                    ? 'Searching for subtitles…'
                    : `${subtitles.length} ${subtitles.length === 1 ? 'track' : 'tracks'} available`}
                </Text>
              </View>
              <Pressable
                onPress={() => setSubPickerOpen(false)}
                style={({ pressed }) => [
                  styles.pill,
                  { backgroundColor: pressed ? c.pressed : c.surface },
                ]}
              >
                <Text style={[styles.pillText, { color: c.text }]}>Done</Text>
              </Pressable>
            </View>

            <View style={styles.subToolsRow}>
              <View style={styles.subToolGroup}>
                <Text style={[styles.subToolLabel, { color: c.textMuted }]}>Sync</Text>
                <Pressable
                  onPress={() => setSubtitleOffsetSec(s => Math.round((s - 0.5) * 10) / 10)}
                  style={[styles.pill, { backgroundColor: c.surface }]}
                >
                  <Text style={[styles.pillText, { color: c.text }]}>−0.5s</Text>
                </Pressable>
                <Pressable
                  onPress={() => setSubtitleOffsetSec(0)}
                  style={[styles.pill, { backgroundColor: c.surface }]}
                >
                  <Text style={[styles.pillText, { color: subtitleOffsetSec === 0 ? c.textMuted : c.accent }]}>
                    {offsetLabel}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => setSubtitleOffsetSec(s => Math.round((s + 0.5) * 10) / 10)}
                  style={[styles.pill, { backgroundColor: c.surface }]}
                >
                  <Text style={[styles.pillText, { color: c.text }]}>+0.5s</Text>
                </Pressable>
              </View>

              <View style={styles.subToolGroup}>
                <Text style={[styles.subToolLabel, { color: c.textMuted }]}>Size</Text>
                {SUBTITLE_SIZE_CHOICES.map(sz => {
                  const active = subTextSize === sz.id;
                  return (
                    <Pressable
                      key={sz.id}
                      onPress={() => setSubTextSize(sz.id)}
                      style={[styles.pill, { backgroundColor: active ? c.accent : c.surface }]}
                    >
                      <Text style={[styles.pillText, { color: active ? '#fff' : c.textSecondary }]}>
                        {sz.label[0]}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {subNote ? (
              <Text style={[styles.subNoteText, { color: c.danger }]}>{subNote}</Text>
            ) : null}

            <ScrollView style={styles.subList} contentContainerStyle={styles.subListContent}>
              <Pressable
                onPress={() => {
                  setSubOverride({ mode: 'off' });
                  setSubNote('');
                  setSubPickerOpen(false);
                }}
                style={({ pressed }) => [
                  styles.subRow,
                  {
                    backgroundColor:
                      selectedSubId === null ? c.accent : pressed ? c.pressed : c.surface,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.subRowLabel,
                    { color: selectedSubId === null ? '#fff' : c.text },
                  ]}
                >
                  Off
                </Text>
                <Text
                  style={[
                    styles.subRowSource,
                    { color: selectedSubId === null ? 'rgba(255,255,255,0.85)' : c.textMuted },
                  ]}
                >
                  {selectedSubId === null ? 'Active' : 'Disable captions'}
                </Text>
              </Pressable>

              {subtitles.map(track => {
                const active = selectedSubId === track.id;
                const badge = subtitleSourceBadge(track.source);
                return (
                  <Pressable
                    key={track.id}
                    onPress={() => {
                      setSubOverride({ mode: 'track', id: track.id });
                      setSubNote('');
                      setSubPickerOpen(false);
                    }}
                    style={({ pressed }) => [
                      styles.subRow,
                      { backgroundColor: active ? c.accent : pressed ? c.pressed : c.surface },
                    ]}
                  >
                    <Text
                      numberOfLines={1}
                      style={[styles.subRowLabel, { color: active ? '#fff' : c.text }]}
                    >
                      {track.label}
                    </Text>
                    <Text
                      style={[
                        styles.subRowSource,
                        { color: active ? 'rgba(255,255,255,0.85)' : c.textMuted },
                      ]}
                    >
                      {badge}
                    </Text>
                  </Pressable>
                );
              })}

              {subsLoading && subtitles.length === 0 ? (
                <View style={styles.subLoadingRow}>
                  <ActivityIndicator size="small" color={c.accent} />
                  <Text style={[styles.subRowSource, { color: c.textMuted }]}>Loading subtitles…</Text>
                </View>
              ) : null}

              {!subsLoading && subtitles.length === 0 ? (
                <Text style={[styles.subRowSource, { color: c.textMuted, paddingVertical: 12, textAlign: 'center' }]}>
                  No subtitles were found for this stream.
                </Text>
              ) : null}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10,
    padding: 24,
  },
  loadingText: {
    marginTop: 6,
  },
  errorTitle: {
    fontWeight: '800',
    fontSize: 16,
  },
  errorMsg: {
    textAlign: 'center',
  },
  errorActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 10,
    marginTop: 4,
  },
  errorBtn: {
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  errorBtnText: {
    color: '#fff',
    fontWeight: '700',
  },
  videoWrap: {
    flex: 1,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 8,
  },
  topBarBack: {
    color: '#fff',
    fontSize: 22,
  },
  topBarFav: {
    fontSize: 20,
  },
  topBarTitle: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
    flex: 1,
    opacity: 0.9,
  },
  controlsBar: {
    flexGrow: 0,
    paddingBottom: 8,
  },
  controlsRow: {
    paddingHorizontal: 16,
    gap: 8,
    alignItems: 'center',
  },
  pill: {
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 5,
  },
  pillText: {
    fontSize: 11.5,
    fontWeight: '700',
  },
  video: {
    flex: 1,
    width: '100%',
  },
  ccBtn: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    maxWidth: 150,
  },
  ccBtnText: {
    color: '#fff',
    fontSize: 11.5,
    fontWeight: '700',
  },
  modalRoot: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.72)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  subSheet: {
    width: '100%',
    maxWidth: 460,
    maxHeight: '82%',
    borderRadius: 18,
    padding: 16,
    gap: 12,
  },
  subSheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  subSheetTitle: {
    fontSize: 16,
    fontWeight: '800',
  },
  subSheetMeta: {
    fontSize: 12,
    marginTop: 2,
  },
  subToolsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 8,
  },
  subToolGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  subToolLabel: {
    fontSize: 11.5,
    fontWeight: '700',
  },
  subNoteText: {
    fontSize: 12,
  },
  subList: {
    maxHeight: 340,
  },
  subListContent: {
    gap: 6,
  },
  subRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
  },
  subRowLabel: {
    flex: 1,
    fontSize: 13.5,
    fontWeight: '700',
  },
  subRowSource: {
    fontSize: 11.5,
    fontWeight: '600',
  },
  subLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
  },
});
