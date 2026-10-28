import { memo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import type { VodItem } from '@/lib/archive';
import { useTheme } from '@/theme';

type Props = {
  item: VodItem;
  onPress: (item: VodItem) => void;
};

export const VodCard = memo(function VodCard({ item, onPress }: Props) {
  const [broken, setBroken] = useState(false);
  const { colors: c } = useTheme();
  const meta = [item.year, item.source === 'archive' ? 'free' : item.rating ? `${item.rating}★` : null]
    .filter(Boolean)
    .join(' · ');

  return (
    <Pressable
      onPress={() => onPress(item)}
      style={({ pressed }) => [
        styles.card,
        pressed && { transform: [{ scale: 0.97 }], opacity: 0.85 },
      ]}
    >
      <View style={[styles.posterWrap, { backgroundColor: c.elevated }]}>
        {item.poster && !broken ? (
          <Image
            source={{ uri: item.poster }}
            style={styles.poster}
            contentFit="cover"
            recyclingKey={item.id}
            cachePolicy="disk"
            onError={() => setBroken(true)}
            transition={150}
          />
        ) : (
          <Text style={[styles.fallback, { color: c.textMuted }]}>
            {item.title.charAt(0).toUpperCase() || '?'}
          </Text>
        )}
        {item.source === 'archive' ? (
          <View style={[styles.badge, { backgroundColor: c.accent }]}>
            <Text style={styles.badgeText}>FREE</Text>
          </View>
        ) : null}
      </View>
      <Text numberOfLines={2} style={[styles.title, { color: c.text }]}>
        {item.title}
      </Text>
      {meta ? (
        <Text numberOfLines={1} style={[styles.meta, { color: c.textMuted }]}>
          {meta}
        </Text>
      ) : null}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  card: {
    gap: 6,
  },
  posterWrap: {
    aspectRatio: 0.7,
    width: '100%',
    borderRadius: 14,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },
  poster: {
    width: '100%',
    height: '100%',
  },
  fallback: {
    fontSize: 30,
    fontWeight: '300',
  },
  badge: {
    position: 'absolute',
    top: 8,
    left: 8,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  title: {
    fontSize: 12.5,
    fontWeight: '700',
    lineHeight: 16,
  },
  meta: {
    fontSize: 11,
  },
});
