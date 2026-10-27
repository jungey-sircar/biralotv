import { memo, useState } from 'react';
import { Text, View, Pressable, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { Channel } from '@/lib/api';
import { useTheme } from '@/theme';

type Props = {
  channel: Channel;
  onPress: (ch: Channel) => void;
  width?: number;
};

export const ChannelCard = memo(function ChannelCard({ channel, onPress, width }: Props) {
  const [broken, setBroken] = useState(false);
  const { colors: c } = useTheme();
  const label = channel.name.trim();
  const logo = channel.logo || undefined;

  return (
    <Pressable
      onPress={() => onPress(channel)}
      style={({ pressed }) => [
        styles.card,
        width != null && { width },
        pressed && { transform: [{ scale: 0.96 }], opacity: 0.85 },
      ]}
    >
      <View style={[styles.thumbWrap, { backgroundColor: c.elevated }]}>
        {logo && !broken ? (
          <Image
            source={{ uri: logo }}
            style={styles.logo}
            contentFit="contain"
            recyclingKey={channel.id}
            cachePolicy="disk"
            onError={() => setBroken(true)}
            transition={150}
          />
        ) : (
          <Text style={[styles.fallbackText, { color: c.textMuted }]}>
            {label.charAt(0).toUpperCase() || '?'}
          </Text>
        )}
      </View>
      <Text numberOfLines={1} style={[styles.label, { color: c.textSecondary }]}>
        {label}
      </Text>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  card: {
    gap: 6,
  },
  thumbWrap: {
    aspectRatio: 1,
    width: '100%',
    borderRadius: 14,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },
  logo: {
    width: '76%',
    height: '76%',
  },
  fallbackText: {
    fontSize: 26,
    fontWeight: '300',
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    paddingHorizontal: 2,
  },
});
