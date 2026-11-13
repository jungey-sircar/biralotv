import { memo, useCallback, useEffect, useState } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import type { VodItem } from '@/lib/archive';
import { useLocalStore } from '@/lib/store';
import { useTheme } from '@/theme';

type Props = {
  items: VodItem[];
  onPlay: (item: VodItem) => void;
  onInfo: (item: VodItem) => void;
};

export const NetflixHero = memo(function NetflixHero({ items, onPlay, onInfo }: Props) {
  const { colors: c } = useTheme();
  const { width } = useWindowDimensions();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const inList = useLocalStore(s => (items[index] ? s.inWatchlist(items[index].id) : false));

  const validItems = items.filter(i => Boolean(i.backdrop || i.poster));
  const activeItem = validItems[index % Math.max(1, validItems.length)];

  // Auto-advance slides every 6.5s unless paused
  useEffect(() => {
    if (paused || validItems.length <= 1) return;
    const timer = setInterval(() => {
      setIndex(prev => (prev + 1) % validItems.length);
    }, 6500);
    return () => clearInterval(timer);
  }, [paused, validItems.length]);

  const toggleWatchlist = useCallback(() => {
    if (activeItem) {
      useLocalStore.getState().toggleWatchlist(activeItem);
    }
  }, [activeItem]);

  if (!activeItem) return null;

  const bgImage = activeItem.backdrop || activeItem.poster;
  const ratingText = activeItem.rating ? `★ ${activeItem.rating.toFixed(1)}` : null;
  const metaYear = activeItem.year ? String(activeItem.year) : '2026';
  const isSeries = activeItem.tmdbKind === 'tv';

  const heroHeight = width >= 768 ? 480 : 420;

  return (
    <View
      style={[styles.container, { height: heroHeight }]}
      onTouchStart={() => setPaused(true)}
      onTouchEnd={() => setPaused(false)}
    >
      {/* Backdrop Image */}
      {bgImage ? (
        <Image
          source={{ uri: bgImage }}
          style={styles.backdrop}
          contentFit="cover"
          contentPosition="top center"
          priority="high"
          cachePolicy="disk"
          transition={300}
        />
      ) : null}

      {/* Layered Gradient Fades to create true Netflix vignette */}
      {Platform.OS === 'web' ? (
        <View
          style={
            [
              styles.webGradient,
              {
                backgroundImage: `linear-gradient(to top, ${c.bg} 0%, rgba(10,10,12,0.85) 35%, rgba(10,10,12,0.4) 65%, transparent 100%), linear-gradient(to right, ${c.bg} 0%, rgba(10,10,12,0.7) 45%, transparent 100%)`,
              } as unknown as Record<string, unknown>,
            ] as unknown as Record<string, unknown>
          }
        />
      ) : (
        <>
          <View style={[styles.scrimBase, { backgroundColor: c.bg, opacity: 0.35 }]} />
          <View style={[styles.bottomFade1, { backgroundColor: c.bg, opacity: 0.45 }]} />
          <View style={[styles.bottomFade2, { backgroundColor: c.bg, opacity: 0.8 }]} />
          <View style={[styles.bottomFade3, { backgroundColor: c.bg, opacity: 1.0 }]} />
          <View style={[styles.leftVignette, { backgroundColor: c.bg, opacity: 0.55 }]} />
        </>
      )}

      {/* Hero Content */}
      <View style={styles.content}>
        {/* Netflix Top 10 / Featured Badge */}
        <View style={styles.badgeRow}>
          <View style={styles.topBadge}>
            <Text style={styles.topBadgeText}>
              {index === 0 ? '🔥 #1 IN MOVIES TODAY' : isSeries ? 'TOP 10 SERIES' : 'TOP 10 TODAY'}
            </Text>
          </View>
        </View>

        {/* Title */}
        <Text numberOfLines={2} style={styles.title}>
          {activeItem.title}
        </Text>

        {/* Metadata pills */}
        <View style={styles.metaRow}>
          {ratingText ? (
            <View style={styles.ratingPill}>
              <Text style={styles.ratingText}>{ratingText}</Text>
            </View>
          ) : null}
          <Text style={styles.metaYear}>{metaYear}</Text>
          <View style={styles.hdBadge}>
            <Text style={styles.hdText}>HD</Text>
          </View>
          <Text style={styles.metaKind}>{isSeries ? 'Series' : 'Movie'}</Text>
        </View>

        {/* Synopsis */}
        {activeItem.overview ? (
          <Text numberOfLines={2} style={styles.overview}>
            {activeItem.overview}
          </Text>
        ) : null}

        {/* Buttons Row (Play, + My List, Info) */}
        <View style={styles.btnRow}>
          <Pressable
            onPress={() => onPlay(activeItem)}
            style={({ pressed }) => [
              styles.playBtn,
              pressed && { transform: [{ scale: 0.96 }], opacity: 0.9 },
            ]}
          >
            <Text style={styles.playIcon}>▶</Text>
            <Text style={styles.playText}>Play</Text>
          </Pressable>

          <Pressable
            onPress={toggleWatchlist}
            style={({ pressed }) => [
              styles.listBtn,
              inList && styles.listBtnActive,
              pressed && { opacity: 0.75 },
            ]}
          >
            <Text style={styles.listBtnIcon}>{inList ? '✓' : '+'}</Text>
            <Text style={styles.listBtnText}>{inList ? 'In List' : 'My List'}</Text>
          </Pressable>

          <Pressable
            onPress={() => onInfo(activeItem)}
            style={({ pressed }) => [styles.infoBtn, pressed && { opacity: 0.75 }]}
          >
            <Text style={styles.infoBtnIcon}>ⓘ</Text>
            <Text style={styles.infoBtnText}>Info</Text>
          </Pressable>
        </View>
      </View>

      {/* Slider Indicators (dots) & Arrows */}
      {validItems.length > 1 ? (
        <View style={styles.sliderControls}>
          <TouchableOpacity
            onPress={() => setIndex(prev => (prev - 1 + validItems.length) % validItems.length)}
            style={styles.arrowBtn}
            hitSlop={12}
          >
            <Text style={styles.arrowText}>‹</Text>
          </TouchableOpacity>

          <View style={styles.dotsRow}>
            {validItems.slice(0, 6).map((_, i) => {
              const isActive = i === index % Math.min(6, validItems.length);
              return (
                <TouchableOpacity
                  key={i}
                  onPress={() => setIndex(i)}
                  style={[styles.dot, isActive ? styles.dotActive : styles.dotInactive]}
                />
              );
            })}
          </View>

          <TouchableOpacity
            onPress={() => setIndex(prev => (prev + 1) % validItems.length)}
            style={styles.arrowBtn}
            hitSlop={12}
          >
            <Text style={styles.arrowText}>›</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    width: '100%',
    position: 'relative',
    overflow: 'hidden',
    justifyContent: 'flex-end',
    backgroundColor: '#0a0a0c',
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    width: '100%',
    height: '100%',
  },
  webGradient: {
    ...StyleSheet.absoluteFill,
  },
  scrimBase: {
    ...StyleSheet.absoluteFill,
  },
  leftVignette: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    width: '60%',
  },
  bottomFade1: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 180,
  },
  bottomFade2: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 90,
  },
  bottomFade3: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 30,
  },
  content: {
    paddingHorizontal: 22,
    paddingBottom: 26,
    zIndex: 10,
    maxWidth: 620,
    gap: 10,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  topBadge: {
    backgroundColor: '#E50914',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  topBadgeText: {
    color: '#ffffff',
    fontSize: 10.5,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  title: {
    color: '#ffffff',
    fontSize: 32,
    fontWeight: '900',
    letterSpacing: -0.6,
    lineHeight: 38,
    textShadowColor: 'rgba(0, 0, 0, 0.85)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  ratingPill: {
    backgroundColor: 'rgba(255, 180, 0, 0.22)',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(255, 180, 0, 0.5)',
  },
  ratingText: {
    color: '#ffc107',
    fontSize: 12,
    fontWeight: '800',
  },
  metaYear: {
    color: 'rgba(255, 255, 255, 0.85)',
    fontSize: 13,
    fontWeight: '700',
  },
  hdBadge: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.5)',
  },
  hdText: {
    color: 'rgba(255, 255, 255, 0.85)',
    fontSize: 10.5,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  metaKind: {
    color: 'rgba(255, 255, 255, 0.65)',
    fontSize: 13,
    fontWeight: '600',
  },
  overview: {
    color: 'rgba(255, 255, 255, 0.82)',
    fontSize: 13,
    lineHeight: 18,
    textShadowColor: 'rgba(0, 0, 0, 0.7)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  btnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 4,
  },
  playBtn: {
    backgroundColor: '#ffffff',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 22,
    paddingVertical: 10,
    borderRadius: 6,
    gap: 6,
  },
  playIcon: {
    color: '#000000',
    fontSize: 14,
    fontWeight: '900',
  },
  playText: {
    color: '#000000',
    fontSize: 14.5,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  listBtn: {
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 6,
    gap: 6,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  listBtnActive: {
    backgroundColor: 'rgba(229, 9, 20, 0.35)',
    borderColor: '#E50914',
  },
  listBtnIcon: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800',
  },
  listBtnText: {
    color: '#ffffff',
    fontSize: 13.5,
    fontWeight: '700',
  },
  infoBtn: {
    backgroundColor: 'rgba(255, 255, 255, 0.16)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 6,
    gap: 5,
  },
  infoBtnIcon: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800',
  },
  infoBtnText: {
    color: '#ffffff',
    fontSize: 13.5,
    fontWeight: '700',
  },
  sliderControls: {
    position: 'absolute',
    bottom: 24,
    right: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    zIndex: 20,
  },
  arrowBtn: {
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.25)',
  },
  arrowText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
    marginTop: -2,
  },
  dotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  dot: {
    height: 5,
    borderRadius: 2.5,
  },
  dotActive: {
    width: 18,
    backgroundColor: '#E50914',
  },
  dotInactive: {
    width: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.4)',
  },
});
