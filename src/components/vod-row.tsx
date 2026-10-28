import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { VodItem } from '@/lib/archive';
import { VodCard } from './vod-card';
import { useTheme } from '@/theme';

type Props = {
  title: string;
  items: VodItem[];
  onPress: (item: VodItem) => void;
  onSeeAll?: () => void;
};

export function VodRow({ title, items, onPress, onSeeAll }: Props) {
  const { colors: c } = useTheme();
  if (items.length === 0) return null;
  return (
    <View style={styles.row}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: c.text }]}>{title}</Text>
        {onSeeAll ? (
          <TouchableOpacity onPress={onSeeAll}>
            <Text style={[styles.seeAll, { color: c.accent }]}>See all</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scroller}
      >
        {items.map(item => (
          <View key={item.id} style={styles.cell}>
            <VodCard item={item} onPress={onPress} />
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    marginBottom: 22,
    gap: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    gap: 12,
  },
  title: {
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: -0.3,
    flexShrink: 1,
  },
  seeAll: {
    fontSize: 13,
    fontWeight: '700',
  },
  scroller: {
    paddingHorizontal: 24,
    gap: 12,
  },
  cell: {
    width: 108,
  },
});
