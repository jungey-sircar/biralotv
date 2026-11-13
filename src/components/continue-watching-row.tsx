import { memo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import { type ContinueWatchingItem, useLocalStore } from '@/lib/store';
import { useTheme } from '@/theme';
import { openPlayer } from '@/lib/util';
import { router } from 'expo-router';

type Props = {
  items: ContinueWatchingItem[];
  onDismiss?: (id: string) => void;
};

function formatTimeLeft(position: number, duration: number): string {
  if (duration <= 0) return `${Math.max(1, Math.floor(position / 60))}m watched`;
  const leftSec = Math.max(0, duration - position);
  const leftMin = Math.round(leftSec / 60);
  if (leftMin < 1) return 'Almost finished';
  if (leftMin < 60) return `${leftMin}m left`;
  const hrs = Math.floor(leftMin / 60);
  const mins = leftMin % 60;
  return `${hrs}h ${mins}m left`;
}

export const ContinueWatchingRow = memo(function ContinueWatchingRow({ items, onDismiss }: Props) {
  const { colors: c } = useTheme();

  if (!items || items.length === 0) return null;

  const handleResume = (item: ContinueWatchingItem) => {
    // If it's a TMDB or Scraper item, resume in Player
    if (item.stream) {
      openPlayer({
        id: item.id,
        name: item.title,
        stream: item.stream,
        source: item.source,
        logo: item.poster,
        resumePos: item.position,
        fresh: true,
      });
    } else if (item.tmdbId) {
      // Open detail which will offer Resume
      router.push({
        pathname: '/vod-detail',
        params: {
          kind: item.kind ?? 'movie',
          id: String(item.tmdbId),
          title: item.title,
        },
      });
    } else {
      openPlayer({
        id: item.id,
        name: item.title,
        stream: item.stream,
        source: item.source,
        logo: item.poster,
        resumePos: item.position,
      });
    }
  };

  const handleRemove = (id: string) => {
    useLocalStore.getState().removeContinueWatching(id);
    onDismiss?.(id);
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.titleWrap}>
          <Text style={[styles.title, { color: c.text }]}>Continue Watching</Text>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{items.length}</Text>
          </View>
        </View>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
      >
        {items.map(item => {
          const pct =
            item.duration > 0
              ? Math.min(100, Math.max(4, Math.round((item.position / item.duration) * 100)))
              : 15;
          const imageUri = item.backdrop || item.poster;
          const subText =
            item.kind === 'tv' && item.season && item.episode
              ? `S${item.season}:E${item.episode} · ${formatTimeLeft(item.position, item.duration)}`
              : formatTimeLeft(item.position, item.duration);

          return (
            <View key={item.id} style={styles.card}>
              <Pressable
                onPress={() => handleResume(item)}
                style={({ pressed }) => [
                  styles.thumbWrap,
                  { backgroundColor: c.elevated },
                  pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] },
                ]}
              >
                {imageUri ? (
                  <Image
                    source={{ uri: imageUri }}
                    style={styles.thumb}
                    contentFit="cover"
                    cachePolicy="disk"
                    transition={150}
                  />
                ) : (
                  <View style={[styles.thumb, styles.fallback]}>
                    <Text style={[styles.fallbackText, { color: c.textMuted }]}>
                      {item.title.charAt(0).toUpperCase()}
                    </Text>
                  </View>
                )}

                {/* Dark Vignette Overlay */}
                <View style={styles.thumbOverlay} />

                {/* Center Play Circle */}
                <View style={styles.playCircle}>
                  <Text style={styles.playIcon}>▶</Text>
                </View>

                {/* Dismiss Button */}
                <TouchableOpacity
                  style={styles.dismissBtn}
                  onPress={() => handleRemove(item.id)}
                  hitSlop={10}
                >
                  <Text style={styles.dismissText}>✕</Text>
                </TouchableOpacity>

                {/* Red Netflix-style Progress Bar */}
                <View style={styles.progressTrack}>
                  <View style={[styles.progressFill, { width: `${pct}%` }]} />
                </View>
              </Pressable>

              {/* Title & Episode info */}
              <View style={styles.cardInfo}>
                <Text numberOfLines={1} style={[styles.cardTitle, { color: c.text }]}>
                  {item.title}
                </Text>
                <Text numberOfLines={1} style={[styles.cardSub, { color: c.textMuted }]}>
                  {subText}
                </Text>
              </View>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    marginBottom: 26,
    gap: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 22,
  },
  titleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  badge: {
    backgroundColor: '#E50914',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 8,
  },
  badgeText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '800',
  },
  scroll: {
    paddingHorizontal: 22,
    gap: 14,
  },
  card: {
    width: 172,
    gap: 6,
  },
  thumbWrap: {
    width: '100%',
    aspectRatio: 1.55,
    borderRadius: 8,
    overflow: 'hidden',
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
  },
  thumb: {
    width: '100%',
    height: '100%',
  },
  thumbOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
  },
  playCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    borderWidth: 2,
    borderColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 5,
  },
  playIcon: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '900',
    marginLeft: 2,
  },
  dismissBtn: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  dismissText: {
    color: 'rgba(255, 255, 255, 0.85)',
    fontSize: 10,
    fontWeight: '800',
  },
  progressTrack: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#E50914',
  },
  fallback: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  fallbackText: {
    fontSize: 28,
    fontWeight: '800',
  },
  cardInfo: {
    gap: 2,
    paddingHorizontal: 2,
  },
  cardTitle: {
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 17,
  },
  cardSub: {
    fontSize: 11.5,
    fontWeight: '600',
  },
});
