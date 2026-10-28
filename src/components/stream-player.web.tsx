import HlsLib, { ErrorTypes, Events } from 'hls.js';
import { useEffect, useRef } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';

type Props = {
  stream: string | null;
  style?: StyleProp<ViewStyle>;
};

const HLS_RE = /\.m3u8([?#]|$)/i;

export function StreamPlayer({ stream }: Props) {
  const ref = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !stream) return;

    let hls: HlsLib | null = null;
    let netRetries = 0;
    const mseOk =
      typeof MediaSource !== 'undefined' &&
      MediaSource.isTypeSupported('video/mp4; codecs="avc1.42E01E,mp4a.40.2"');
    if (HLS_RE.test(stream) && mseOk) {
      hls = new HlsLib({ lowLatencyMode: false, backBufferLength: 60 });
      hls.loadSource(stream);
      hls.attachMedia(el);
      hls.on(Events.MANIFEST_PARSED, () => {
        netRetries = 0;
        void el.play().catch(() => {});
      });
      hls.on(Events.ERROR, (_event, data) => {
        if (!data.fatal || !hls) return;
        if (data.type === ErrorTypes.NETWORK_ERROR && netRetries < 3) {
          netRetries += 1;
          hls.startLoad();
        } else if (data.type === ErrorTypes.MEDIA_ERROR && netRetries < 3) {
          netRetries += 1;
          hls.recoverMediaError();
        } else hls.destroy();
      });
    } else {
      el.src = stream;
      void el.play().catch(() => {});
    }

    return () => {
      hls?.destroy();
      el.removeAttribute('src');
      el.load();
    };
  }, [stream]);

  return (
    <video
      ref={ref}
      controls
      playsInline
      style={{ width: '100%', height: '100%', display: 'block', backgroundColor: '#000' }}
    />
  );
}
