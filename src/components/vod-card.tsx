import { memo, useState } from 'react';
import { Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import type { VodItem } from '@/lib/archive';
import { useLocalStore } from '@/lib/store';
import { useTheme } from '@/theme';

type Props = {
  item: VodItem;
  onPress: (item: VodItem) => void;
  rank?: number;
  showWatchlistBtn?: boolean;
};

export const VodCard = memo(function VodCard({
  item,
  onPress,
  rank,
  showWatchlistBtn = true,
}: Props) {
  const [broken, setBroken] = useState(false);
  const { colors: c } = useTheme();
  const inList = useLocalStore(s => s.inWatchlist(item.id));

  const toggleList = (e: { stopPropagation?: () => void }) => {
    e.stopPropagation?.();
    useLocalStore.getState().toggleWatchlist(item);
  };

  const meta = [
    item.year,
    item.source === 'archive' ? 'Free' : item.tmdbKind === 'tv' ? 'Series' : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Pressable
      onPress={() => onPress(item)}
      style={({ pressed }) => [
        styles.card,
        pressed && { transform: [{ scale: 0.96 }], opacity: 0.88 },
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

        {/* Netflix Top 10 Red Badge */}
        {typeof rank === 'number' && rank <= 10 ? (
          <View style={styles.rankBadge}>
            <Text style={styles.rankBadgeText}>TOP 10</Text>
          </View>
        ) : item.source === 'archive' ? (
          <View style={[styles.freeBadge, { backgroundColor: c.accent }]}>
            <Text style={styles.freeBadgeText}>FREE</Text>
          </View>
        ) : null}

        {/* Rating Pill Top Right */}
        {item.rating ? (
          <View style={styles.ratingBadge}>
            <Text style={styles.ratingText}>★ {item.rating.toFixed(1)}</Text>
          </View>
        ) : null}

        {/* Quick Add to Watchlist Icon Button */}
        {showWatchlistBtn ? (
          <TouchableOpacity
            style={[styles.quickListBtn, inList && styles.quickListBtnActive]}
            onPress={toggleList}
            hitSlop={8}
          >
            <Text style={styles.quickListIcon}>{inList ? '✓' : '+'}</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <Text numberOfLines={1} style={[styles.title, { color: c.text }]}>
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
    gap: 5,
    width: '100%',
  },
  posterWrap: {
    aspectRatio: 0.68,
    width: '100%',
    borderRadius: 8,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
    elevation: 4,
  },
  poster: {
    width: '100%',
    height: '100%',
  },
  fallback: {
    fontSize: 28,
    fontWeight: '300',
  },
  rankBadge: {
    position: 'absolute',
    top: 6,
    left: 6,
    backgroundColor: '#E50914',
    borderRadius: 3,
    paddingHorizontal: 5,
    paddingVertical: 2,
    zIndex: 5,
  },
  rankBadgeText: {
    color: '#fff',
    fontSize: 8.5,
    fontWeight: '900',
    letterSpacing: 0.4,
  },
  freeBadge: {
    position: 'absolute',
    top: 6,
    left: 6,
    borderRadius: 3,
    paddingHorizontal: 5,
    paddingVertical: 2,
    zIndex: 5,
  },
  freeBadgeText: {
    color: '#fff',
    fontSize: 8.5,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  ratingBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1.5,
    zIndex: 5,
  },
  ratingText: {
    color: '#ffc107',
    fontSize: 9.5,
    fontWeight: '800',
  },
  quickListBtn: {
    position: 'absolute',
    bottom: 6,
    right: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.4)',
    zIndex: 6,
  },
  quickListBtnActive: {
    backgroundColor: '#E50914',
    borderColor: '#E50914',
  },
  quickListIcon: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '800',
    marginTop: -1,
  },
  title: {
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 15,
  },
  meta: {
    fontSize: 11,
    lineHeight: 14,
  },
});
