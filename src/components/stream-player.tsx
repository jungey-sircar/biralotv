import { useEffect } from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';

type Props = {
  stream: string | null;
  style?: StyleProp<ViewStyle>;
};

export function StreamPlayer({ stream, style }: Props) {
  const player = useVideoPlayer(stream, p => {
    void p;
  });

  useEffect(() => {
    if (!stream) return;
    let alive = true;
    player
      .replaceAsync(stream)
      .then(() => {
        if (alive) player.play();
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [stream, player]);

  return (
    <VideoView
      style={style}
      player={player}
      contentFit="contain"
      nativeControls
      allowsPictureInPicture
    />
  );
}
