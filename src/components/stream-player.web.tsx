import HlsLib, { ErrorDetails, ErrorTypes, Events } from 'hls.js';
import { useEffect, useMemo, useRef } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import {
  fetchSubtitleCues,
  SUBTITLE_SIZE_CHOICES,
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
  onNativeSubtitleSelect?: (track: SubtitleTrackItem | null) => void;
  onSubtitleError?: (message: string) => void;
  onError?: (message: string) => void;
  style?: StyleProp<ViewStyle>;
};

const HLS_RE = /\.m3u8([?#]|$)/i;
const PROXY_STREAM_RE = /\/v1\/stream\/[a-f0-9]+/i;
const CUE_STYLE_ID = 'biralotv-cue-style';

export function StreamPlayer({
  stream,
  isHls,
  subtitles,
  selectedSubtitleId,
  subtitleOffsetSec = 0,
  subtitleSize = 'medium',
  onSubtitleError,
  onError,
}: Props) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const trackNodesRef = useRef<Map<string, TextTrack>>(new Map());
  const onErrorRef = useRef(onError);
  const onSubErrRef = useRef(onSubtitleError);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    onSubErrRef.current = onSubtitleError;
  }, [onSubtitleError]);

  const selectedTrack = useMemo(
    () => (selectedSubtitleId ? (subtitles ?? []).find(s => s.id === selectedSubtitleId) ?? null : null),
    [subtitles, selectedSubtitleId],
  );

  const cueFontSize = useMemo(
    () => (SUBTITLE_SIZE_CHOICES.find(c => c.id === subtitleSize) ?? SUBTITLE_SIZE_CHOICES[1]).webRem,
    [subtitleSize],
  );

  useEffect(() => {
    if (typeof document === 'undefined') return;
    let styleEl = document.getElementById(CUE_STYLE_ID) as HTMLStyleElement | null;
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = CUE_STYLE_ID;
      document.head.appendChild(styleEl);
    }
    styleEl.textContent =
      `video::cue { font-size: ${cueFontSize}; line-height: 1.35; ` +
      `color: #ffffff; background-color: rgba(0, 0, 0, 0.72); ` +
      `text-shadow: 0 1px 3px rgba(0, 0, 0, 0.9); }`;
  }, [cueFontSize]);

  useEffect(() => {
    const el = ref.current;
    if (!el || !stream) return;

    let hls: HlsLib | null = null;
    let netRetries = 0;
    let triedDirectFallback = false;
    let active = true;

    const handleNativeError = () => {
      if (!active || !el.getAttribute('src')) return;
      onErrorRef.current?.('This video stream could not be decoded or reached.');
    };
    el.addEventListener('error', handleNativeError);

    const playDirect = () => {
      if (!active) return;
      el.src = stream;
      void el.play().catch(() => {});
    };

    const wantsHls = isHls ?? (HLS_RE.test(stream) || PROXY_STREAM_RE.test(stream));
    const mseOk =
      typeof MediaSource !== 'undefined' &&
      MediaSource.isTypeSupported('video/mp4; codecs="avc1.42E01E,mp4a.40.2"');

    if (wantsHls && mseOk) {
      hls = new HlsLib({
        lowLatencyMode: false,
        backBufferLength: 60,
        enableWebVTT: false,
        enableIMSC1: false,
        renderTextTracksNatively: false,
      });
      hls.subtitleDisplay = false;
      hls.subtitleTrack = -1;
      hls.loadSource(stream);
      hls.attachMedia(el);
      hls.on(Events.MANIFEST_PARSED, () => {
        netRetries = 0;
        void el.play().catch(() => {});
      });
      hls.on(Events.ERROR, (_event, data) => {
        if (!active || !data.fatal || !hls) return;
        const manifestErr =
          data.details === ErrorDetails.MANIFEST_PARSING_ERROR ||
          data.details === ErrorDetails.MANIFEST_LOAD_ERROR;
        if (manifestErr && PROXY_STREAM_RE.test(stream) && !triedDirectFallback) {
          triedDirectFallback = true;
          hls.destroy();
          hls = null;
          playDirect();
          return;
        }
        if (data.type === ErrorTypes.NETWORK_ERROR && netRetries < 3) {
          netRetries += 1;
          hls.startLoad();
        } else if (data.type === ErrorTypes.MEDIA_ERROR && netRetries < 3) {
          netRetries += 1;
          hls.recoverMediaError();
        } else {
          hls.destroy();
          hls = null;
          onErrorRef.current?.(`Playback error (${data.details}).`);
        }
      });
    } else {
      playDirect();
    }

    return () => {
      active = false;
      el.removeEventListener('error', handleNativeError);
      hls?.destroy();
      for (let i = 0; i < el.textTracks.length; i++) {
        el.textTracks[i].mode = 'disabled';
      }
      el.removeAttribute('src');
      el.load();
    };
  }, [stream, isHls]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const disableAll = () => {
      for (let i = 0; i < el.textTracks.length; i++) {
        el.textTracks[i].mode = 'disabled';
      }
    };

    if (!stream || !selectedTrack) {
      disableAll();
      return;
    }

    let active = true;
    const ctl = new AbortController();
    const offset = Number.isFinite(subtitleOffsetSec) ? subtitleOffsetSec : 0;
    const trackKey = `${selectedTrack.id}|${selectedTrack.label}|${selectedTrack.language}`;

    const applyCues = async () => {
      try {
        const cues = await fetchSubtitleCues(selectedTrack.url, ctl.signal);
        if (!active || ref.current !== el) return;

        let tt = trackNodesRef.current.get(trackKey);
        if (!tt) {
          tt = el.addTextTrack('subtitles', selectedTrack.label, selectedTrack.language || 'und');
          trackNodesRef.current.set(trackKey, tt);
        }

        for (let i = 0; i < el.textTracks.length; i++) {
          if (el.textTracks[i] !== tt) {
            el.textTracks[i].mode = 'disabled';
          }
        }

        // Chromium leaves tt.cues === null while mode === 'disabled'.
        tt.mode = 'hidden';
        if (tt.cues) {
          while (tt.cues.length > 0) {
            tt.removeCue(tt.cues[0]);
          }
        }
        const VTTCueCtor = typeof VTTCue !== 'undefined' ? VTTCue : null;
        if (VTTCueCtor) {
          for (const c of cues) {
            const start = Math.max(0, c.start + offset);
            const end = Math.max(start + 0.05, c.end + offset);
            try {
              tt.addCue(new VTTCueCtor(start, end, c.text));
            } catch {}
          }
        }
        tt.mode = 'showing';
      } catch (err: unknown) {
        if (!active || (err instanceof Error && err.name === 'AbortError')) return;
        disableAll();
        onSubErrRef.current?.(err instanceof Error ? err.message : 'Could not load subtitle track.');
      }
    };

    void applyCues();

    const onMeta = () => {
      if (!active) return;
      const tt = trackNodesRef.current.get(trackKey);
      if (tt) tt.mode = 'showing';
    };
    el.addEventListener('loadedmetadata', onMeta);

    return () => {
      active = false;
      ctl.abort();
      el.removeEventListener('loadedmetadata', onMeta);
    };
  }, [stream, selectedTrack, subtitleOffsetSec]);

  return (
    <video
      ref={ref}
      controls
      playsInline
      style={{
        width: '100%',
        height: '100%',
        display: 'block',
        backgroundColor: '#000',
        objectFit: 'contain',
      }}
    />
  );
}
