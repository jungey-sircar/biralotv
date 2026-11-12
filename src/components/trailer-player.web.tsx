import type { StyleProp, ViewStyle } from 'react-native';

type Props = {
  youtubeKey: string;
  style?: StyleProp<ViewStyle>;
};

export function TrailerPlayer({ youtubeKey }: Props) {
  return (
    <div
      style={{
        width: '100%',
        height: 220,
        borderRadius: 16,
        overflow: 'hidden',
        backgroundColor: '#000',
      }}
    >
      <iframe
        src={`https://www.youtube.com/embed/${youtubeKey}?autoplay=1`}
        title="Trailer"
        style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
        allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
        allowFullScreen
      />
    </div>
  );
}

