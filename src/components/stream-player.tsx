import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleProp, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { useEventListener } from 'expo';
import {
  useVideoPlayer,
  VideoView,
  type SubtitleTrack,
  type VideoPlayer,
  type VideoSource,
} from 'expo-video';
import {
  fetchSubtitleCues,
  findActiveSubtitleText,
  SUBTITLE_SIZE_CHOICES,
  type SubtitleCue,
  type SubtitleTextSize,
  type SubtitleTrackItem,
} from '@/lib/subtitles';

type Props = {
  stream: string | null;
  isHls?: boolean;
  title?: string;
  artwork?: string;
  subtitles?: SubtitleTrackItem[];
  selectedSubtitleId?: string | null;
  subtitleOffsetSec?: number;
  subtitleSize?: SubtitleTextSize;
  initialPosition?: number;
  onProgress?: (progress: { position: number; duration: number }) => void;
  onNativeSubtitleSelect?: (track: SubtitleTrackItem | null) => void;
  onSubtitleError?: (message: string) => void;
  onError?: (message: string) => void;
  style?: StyleProp<ViewStyle>;
};

const HLS_RE = /\.m3u8([?#]|$)/i;
const PROXY_STREAM_RE = /\/v1\/stream\/[a-f0-9]+/i;
const EMPTY_TRACKS: SubtitleTrack[] = [];
const EMPTY_CUES: SubtitleCue[] = [];

function assignNativeSubtitle(target: VideoPlayer, track: SubtitleTrack | null) {
  try {
    target.subtitleTrack = track;
  } catch {}
}

function findNativeSubtitleMatch(
  nativeTracks: SubtitleTrack[],
  selected: SubtitleTrackItem,
): SubtitleTrack | null {
  if (nativeTracks.length === 0) return null;
  const targetLabel = selected.label.trim().toLowerCase();
  if (targetLabel) {
    const byName = nativeTracks.find(
      t => t.name && t.name.trim().toLowerCase() === targetLabel,
    );
    if (byName) return byName;
  }
  // Never match external OpenSubtitles tracks by language alone; they aren't inside the HLS manifest.
  if (selected.source === 'opensubtitles') return null;
  const baseLang = selected.language.trim().toLowerCase().split('-')[0];
  if (!baseLang || baseLang === 'und') return null;
  const langHits = nativeTracks.filter(
    t => t.language.trim().toLowerCase().split('-')[0] === baseLang && !t.name,
  );
  return langHits.length === 1 ? langHits[0] : null;
}

export function StreamPlayer({
  stream,
  isHls,
  title,
  artwork,
  subtitles,
  selectedSubtitleId,
  subtitleOffsetSec = 0,
  subtitleSize = 'medium',
  initialPosition = 0,
  onProgress,
  onNativeSubtitleSelect,
  onSubtitleError,
  onError,
  style,
}: Props) {
  const player = useVideoPlayer(null, p => {
    p.timeUpdateEventInterval = 0.5;
  });
  const triedFallbackRef = useRef(false);
  const currentStreamRef = useRef<string | null>(null);
  const onErrorRef = useRef(onError);
  const onSubErrRef = useRef(onSubtitleError);
  const onNativeSubRef = useRef(onNativeSubtitleSelect);
  const onProgressRef = useRef(onProgress);
  const subtitlesRef = useRef<SubtitleTrackItem[]>(subtitles ?? []);
  const programmaticSubRef = useRef(false);
  const usingNativeTrackRef = useRef(false);
  const needsOverlayTicksRef = useRef(false);

  const [nativeTracksEntry, setNativeTracksEntry] = useState<{
    uri: string;
    tracks: SubtitleTrack[];
  }>({ uri: '', tracks: EMPTY_TRACKS });
  const [overlayState, setOverlayState] = useState<{
    key: string;
    cues: SubtitleCue[];
  }>({ key: '', cues: EMPTY_CUES });
  const [playbackTime, setPlaybackTime] = useState<{ uri: string; time: number }>({
    uri: '',
    time: 0,
  });

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    onSubErrRef.current = onSubtitleError;
  }, [onSubtitleError]);

  useEffect(() => {
    onNativeSubRef.current = onNativeSubtitleSelect;
  }, [onNativeSubtitleSelect]);

  useEffect(() => {
    onProgressRef.current = onProgress;
  }, [onProgress]);

  useEffect(() => {
    subtitlesRef.current = subtitles ?? [];
  }, [subtitles]);

  const selectedTrack = useMemo(
    () => (selectedSubtitleId ? (subtitles ?? []).find(s => s.id === selectedSubtitleId) ?? null : null),
    [subtitles, selectedSubtitleId],
  );

  const nativeTracks = useMemo(
    () => (stream && nativeTracksEntry.uri === stream ? nativeTracksEntry.tracks : EMPTY_TRACKS),
    [stream, nativeTracksEntry],
  );

  const sizeChoice = useMemo(
    () => SUBTITLE_SIZE_CHOICES.find(c => c.id === subtitleSize) ?? SUBTITLE_SIZE_CHOICES[1],
    [subtitleSize],
  );

  useEventListener(player, 'statusChange', ({ status, error }) => {
    if (status !== 'error') return;
    const activeUrl = currentStreamRef.current;
    if (activeUrl && PROXY_STREAM_RE.test(activeUrl) && !triedFallbackRef.current) {
      triedFallbackRef.current = true;
      void player
        .replaceAsync({
          uri: activeUrl,
          contentType: 'progressive',
          metadata: title || artwork ? { title, artwork } : undefined,
        })
        .then(() => player.play())
        .catch(() => {
          onErrorRef.current?.(error?.message || 'Playback failed.');
        });
      return;
    }
    onErrorRef.current?.(error?.message || 'Playback failed.');
  });

  useEventListener(player, 'sourceLoad', ({ availableSubtitleTracks }) => {
    const uri = currentStreamRef.current ?? '';
    setNativeTracksEntry({ uri, tracks: availableSubtitleTracks ?? EMPTY_TRACKS });
  });

  useEventListener(player, 'availableSubtitleTracksChange', ({ availableSubtitleTracks }) => {
    const uri = currentStreamRef.current ?? '';
    setNativeTracksEntry({ uri, tracks: availableSubtitleTracks ?? EMPTY_TRACKS });
  });

  useEventListener(player, 'subtitleTrackChange', ({ subtitleTrack }) => {
    if (programmaticSubRef.current) return;
    if (!subtitleTrack) {
      if (usingNativeTrackRef.current) {
        usingNativeTrackRef.current = false;
        onNativeSubRef.current?.(null);
      }
      return;
    }
    const list = subtitlesRef.current;
    const nameLower = (subtitleTrack.name ?? '').trim().toLowerCase();
    const matched =
      (nameLower ? list.find(s => s.label.trim().toLowerCase() === nameLower) : undefined) ??
      list.find(
        s =>
          s.source !== 'opensubtitles' &&
          s.language.trim().toLowerCase().split('-')[0] ===
            subtitleTrack.language.trim().toLowerCase().split('-')[0],
      );
    if (matched) {
      usingNativeTrackRef.current = true;
      onNativeSubRef.current?.(matched);
    }
  });

  useEventListener(player, 'timeUpdate', ({ currentTime }) => {
    onProgressRef.current?.({ position: currentTime, duration: player.duration || 0 });
    if (!needsOverlayTicksRef.current) return;
    const uri = currentStreamRef.current ?? '';
    if (!uri) return;
    setPlaybackTime(prev => (prev.uri === uri && prev.time === currentTime ? prev : { uri, time: currentTime }));
  });

  useEffect(() => {
    currentStreamRef.current = stream;
    triedFallbackRef.current = false;
    usingNativeTrackRef.current = false;
    needsOverlayTicksRef.current = false;

    if (!stream) {
      void player.replaceAsync(null).catch(() => {});
      return;
    }

    const wantsHls =
      isHls ?? (HLS_RE.test(stream) || PROXY_STREAM_RE.test(stream));
    const source: VideoSource = {
      uri: stream,
      contentType: wantsHls ? 'hls' : 'auto',
      metadata: title || artwork ? { title, artwork } : undefined,
    };

    let alive = true;
    player
      .replaceAsync(source)
      .then(() => {
        if (!alive) return;
        if (initialPosition && initialPosition > 0) {
          try {
            player.currentTime = initialPosition;
          } catch {}
        }
        player.play();
      })
      .catch((e: unknown) => {
        if (alive) onErrorRef.current?.(e instanceof Error ? e.message : 'Playback failed.');
      });
    return () => {
      alive = false;
    };
  }, [stream, isHls, title, artwork, player, initialPosition]);

  const offsetIsZero = Math.abs(subtitleOffsetSec ?? 0) < 0.05;
  const nativeMatch = useMemo(
    () => (selectedTrack && offsetIsZero ? findNativeSubtitleMatch(nativeTracks, selectedTrack) : null),
    [selectedTrack, offsetIsZero, nativeTracks],
  );

  const overlayKey = stream && selectedTrack && !nativeMatch ? `${stream}|${selectedTrack.id}` : '';

  useEffect(() => {
    const applyNative = (track: SubtitleTrack | null) => {
      programmaticSubRef.current = true;
      assignNativeSubtitle(player, track);
      setTimeout(() => {
        programmaticSubRef.current = false;
      }, 0);
    };

    if (!stream || !selectedTrack) {
      usingNativeTrackRef.current = false;
      needsOverlayTicksRef.current = false;
      applyNative(null);
      return;
    }

    if (nativeMatch) {
      usingNativeTrackRef.current = true;
      needsOverlayTicksRef.current = false;
      applyNative(nativeMatch);
      return;
    }

    // Fallback to synchronized RN overlay (single-variant playlists, timing offset, Archive MP4, OpenSubtitles).
    usingNativeTrackRef.current = false;
    needsOverlayTicksRef.current = true;
    applyNative(null);

    let active = true;
    const ctl = new AbortController();
    const fetchKey = overlayKey;
    fetchSubtitleCues(selectedTrack.url, ctl.signal)
      .then(cues => {
        if (!active) return;
        setOverlayState({ key: fetchKey, cues });
      })
      .catch((err: unknown) => {
        if (!active || (err instanceof Error && err.name === 'AbortError')) return;
        setOverlayState({ key: fetchKey, cues: EMPTY_CUES });
        onSubErrRef.current?.(err instanceof Error ? err.message : 'Could not load subtitle track.');
      });

    return () => {
      active = false;
      ctl.abort();
    };
  }, [player, stream, selectedTrack, nativeMatch, overlayKey]);

  const overlayText = useMemo(() => {
    if (!overlayKey || overlayState.key !== overlayKey || overlayState.cues.length === 0) {
      return '';
    }
    const t = stream && playbackTime.uri === stream ? playbackTime.time : 0;
    return findActiveSubtitleText(overlayState.cues, t, subtitleOffsetSec ?? 0);
  }, [overlayKey, overlayState, stream, playbackTime, subtitleOffsetSec]);

  return (
    <View style={[styles.wrap, style]}>
      <VideoView
        style={StyleSheet.absoluteFill}
        player={player}
        contentFit="contain"
        nativeControls
        allowsPictureInPicture
        buttonOptions={{ showSubtitles: nativeTracks.length > 0 }}
      />
      {overlayText ? (
        <View pointerEvents="none" style={styles.overlayWrap}>
          <View style={styles.captionBox}>
            <Text
              style={[
                styles.captionText,
                {
                  fontSize: sizeChoice.px,
                  lineHeight: Math.round(sizeChoice.px * 1.32),
                },
              ]}
            >
              {overlayText}
            </Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: '#000',
  },
  overlayWrap: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 56,
    alignItems: 'center',
  },
  captionBox: {
    backgroundColor: 'rgba(0, 0, 0, 0.74)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    maxWidth: '94%',
  },
  captionText: {
    color: '#fff',
    fontWeight: '600',
    textAlign: 'center',
    textShadowColor: 'rgba(0, 0, 0, 0.9)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
});
