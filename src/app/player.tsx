import { api, apiBase, Channel } from '@/lib/api';
import { useLocalStore } from '@/lib/store';
import { goBack } from '@/lib/util';
import { useTheme } from '@/theme';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View, StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';
import { useVideoPlayer, VideoView } from 'expo-video';
import { SafeScreen } from '@/components/SafeScreen';

const MB_UA = 'Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36';
function embedUrl(ch: Channel): string | null {
  if (!ch.number) return null;
  if (ch.source.startsWith('mapple-premium') || ch.source.startsWith('mapple-sports')) {
    return `https://dlive.sx/stream/stream-${ch.number}.php`;
  }
  return null;
}

export default function Player() {
  const params = useLocalSearchParams<{
    id: string;
    name?: string;
    stream?: string;
    source?: string;
    logo?: string;
    number?: string;
  }>();
  const id = params.id ?? '';
  const server = apiBase();
  const { colors: c } = useTheme();
  const [remote, setRemote] = useState<Channel | null>(null);
  const [error, setError] = useState('');

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

  const channel = remote ?? fromParams;
  const fav = useLocalStore(s => (channel ? s.favorites.some(f => f.id === channel.id) : false));

  useEffect(() => {
    if (fromParams?.stream || !server || !id) return;
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
  }, [fromParams, id, server]);

  useEffect(() => {
    if (!id) router.replace('/');
  }, [id]);

  useEffect(() => {
    if (channel) api.addRecent(channel);
  }, [channel]);

  function toggleFav() {
    if (!channel) return;
    if (fav) api.removeFavorite(channel.id);
    else api.addFavorite(channel);
  }

  const isEmbed = channel ? embedUrl(channel) !== null : false;
  const stream = channel && !isEmbed ? channel.stream : undefined;

  const player = useVideoPlayer(stream ?? null, p => {
    void p;
  });

  useEffect(() => {
    let alive = true;
    if (stream) {
      player
        .replaceAsync(stream)
        .then(() => {
          if (alive) player.play();
        })
        .catch(() => {});
    }
    return () => {
      alive = false;
    };
  }, [stream, player]);

  const webSrc = useMemo(() => (channel ? embedUrl(channel) : null), [channel]);
  const resolving = !!server && !!id && !remote && !fromParams?.stream && !error;

  return (
    <SafeScreen noBottom>
      {!channel ? (
        <View style={styles.center}>
          <Text style={[styles.errorTitle, { color: c.text }]}>Nothing to play</Text>
          <Text style={[styles.errorMsg, { color: c.textSecondary }]}>
            {error || 'This screen was opened without a channel. Go back and pick one from the list.'}
          </Text>
          <Pressable
            onPress={goBack}
            style={({ pressed }) => [styles.errorBtn, { backgroundColor: pressed ? c.elevated : c.accent }]}
          >
            <Text style={styles.errorBtnText}>Back to channels</Text>
          </Pressable>
        </View>
      ) : null}

      {channel && error ? (
        <View style={styles.center}>
          <Text style={[styles.errorTitle, { color: c.text }]}>Can&apos;t play this channel</Text>
          <Text style={[styles.errorMsg, { color: c.textSecondary }]}>{error}</Text>
          <Pressable
            onPress={goBack}
            style={({ pressed }) => [styles.errorBtn, { backgroundColor: pressed ? c.elevated : c.accent }]}
          >
            <Text style={styles.errorBtnText}>Back</Text>
          </Pressable>
        </View>
      ) : null}

      {channel && !error ? (
        <View style={styles.videoWrap}>
          <View style={styles.topBar}>
            <Pressable onPress={goBack} hitSlop={12}>
              <Text style={styles.topBarBack}>‹</Text>
            </Pressable>
            <Text numberOfLines={1} style={styles.topBarTitle}>
              {channel.name}
            </Text>
            <Pressable onPress={toggleFav} hitSlop={12}>
              <Text style={[styles.topBarFav, { color: fav ? c.accent : '#fff' }]}>{fav ? '♥' : '♡'}</Text>
            </Pressable>
          </View>

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
          ) : stream ? (
            <VideoView
              style={styles.video}
              player={player}
              contentFit="contain"
              nativeControls
              allowsPictureInPicture
            />
          ) : resolving ? (
            <View style={styles.center}>
              <ActivityIndicator size="large" color={c.accent} />
              <Text style={[styles.loadingText, { color: c.textSecondary }]}>Loading stream…</Text>
            </View>
          ) : (
            <View style={styles.center}>
              <Text style={[styles.errorMsg, { color: c.textSecondary }]}>
                No stream URL available for this channel.
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
  video: {
    flex: 1,
    width: '100%',
  },
});
