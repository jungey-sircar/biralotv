import type { StyleProp, ViewStyle } from 'react-native';
import { WebView } from 'react-native-webview';

type Props = {
  youtubeKey: string;
  style?: StyleProp<ViewStyle>;
};

export function TrailerPlayer({ youtubeKey, style }: Props) {
  return (
    <WebView
      source={{ uri: `https://www.youtube.com/embed/${youtubeKey}?autoplay=1` }}
      style={style}
      allowsFullscreenVideo
      allowsInlineMediaPlayback
      mediaPlaybackRequiresUserAction={false}
    />
  );
}

