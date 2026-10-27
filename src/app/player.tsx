import { api, useConfig, Channel } from '@/lib/api';
import { goBack } from '@/lib/util';
import { useTheme } from '@/theme';
import { Redirect, useLocalSearchParams } from 'expo-router';
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
  const params = useLocalSearchParams<{ id: string; name: string }>();
  const server = useConfig(s => s.server);
  const { colors: c } = useTheme();
  const [channel, setChannel] = useState<Channel | null>(null);
  const [fav, setFav] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const ch = await api.channel(params.id);
        if (!alive) return;
        setChannel(ch);
        api.logRecent(ch.id).catch(() => {});
      } catch (e: unknown) {
        if (alive) setError(e instanceof Error ? e.message : 'failed to load channel');
      }
    })();
    return () => {
      alive = false;
    };
  }, [params.id]);

  async function toggleFav() {
    if (!channel) return;
    try {
      if (fav) {
        await api.favRemove(channel.id);
        setFav(false);
      } else {
        await api.favAdd(channel.id);
        setFav(true);
      }
    } catch {}
  }

  const isEmbed = channel ? embedUrl(channel) !== null : false;

  const player = useVideoPlayer(channel && !isEmbed && channel.stream ? channel.stream : null, p => {
    void p;
  });

  useEffect(() => {
    let alive = true;
    if (channel && !isEmbed && channel.stream) {
      player
        .replaceAsync(channel.stream)
        .then(() => {
          if (alive) player.play();
        })
        .catch(() => {});
    }
    return () => {
      alive = false;
    };
  }, [channel, isEmbed, player]);

  const webSrc = useMemo(() => (channel ? embedUrl(channel) : null), [channel]);

  if (!server) return <Redirect href="/setup" />;

  return (
    <SafeScreen noBottom>
      {!channel && !error ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={c.accent} />
          <Text style={[styles.loadingText, { color: c.textSecondary }]}>Loading stream…</Text>
        </View>
      ) : null}

      {error ? (
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

      {channel ? (
        <View style={styles.videoWrap}>
          {/* top bar */}
          <View style={styles.topBar}>
            <Pressable onPress={goBack} hitSlop={12}>
              <Text style={styles.topBarBack}>‹</Text>
            </Pressable>
            <Text numberOfLines={1} style={styles.topBarTitle}>
              {params.name}
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
          ) : (
            <>
              {channel.stream ? (
                <VideoView
                  style={styles.video}
                  player={player}
                  contentFit="contain"
                  nativeControls
                  allowsPictureInPicture
                />
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
            </>
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
