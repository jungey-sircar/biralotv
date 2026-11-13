import { memo } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { VodItem } from '@/lib/archive';
import { VodCard } from './vod-card';
import { useTheme } from '@/theme';

type Props = {
  title: string;
  subtitle?: string;
  items: VodItem[];
  onPress: (item: VodItem) => void;
  onSeeAll?: () => void;
  showRanks?: boolean;
  cardWidth?: number;
};

export const VodRow = memo(function VodRow({
  title,
  subtitle,
  items,
  onPress,
  onSeeAll,
  showRanks = false,
  cardWidth = 118,
}: Props) {
  const { colors: c } = useTheme();
  if (!items || items.length === 0) return null;

  return (
    <View style={styles.row}>
      <View style={styles.header}>
        <View style={styles.titleWrap}>
          <Text style={[styles.title, { color: c.text }]}>{title}</Text>
          {subtitle ? (
            <Text style={[styles.subtitle, { color: c.textMuted }]}>{subtitle}</Text>
          ) : null}
        </View>
        {onSeeAll ? (
          <TouchableOpacity onPress={onSeeAll} hitSlop={10} style={styles.seeAllBtn}>
            <Text style={[styles.seeAll, { color: c.accent }]}>See all ›</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scroller}
      >
        {items.map((item, idx) => (
          <View key={item.id} style={[styles.cell, { width: cardWidth }]}>
            <VodCard
              item={item}
              onPress={onPress}
              rank={showRanks ? idx + 1 : undefined}
            />
          </View>
        ))}
      </ScrollView>
    </View>
  );
});

const styles = StyleSheet.create({
  row: {
    marginBottom: 24,
    gap: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingHorizontal: 22,
    gap: 12,
  },
  titleWrap: {
    gap: 2,
    flexShrink: 1,
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 12,
    fontWeight: '500',
  },
  seeAllBtn: {
    paddingVertical: 2,
  },
  seeAll: {
    fontSize: 13,
    fontWeight: '700',
  },
  scroller: {
    paddingHorizontal: 22,
    gap: 12,
  },
  cell: {
    flexShrink: 0,
  },
});
