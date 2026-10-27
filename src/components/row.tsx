import { Channel } from '@/lib/api';
import { useTheme } from '@/theme';
import { ChannelCard } from './ChannelCard';
import { FlatList, Text, View, StyleSheet } from 'react-native';
import { openPlayer } from '@/lib/util';

const CARD = 92;

export function ChannelRow({ title, channels }: { title: string; channels: Channel[] }) {
  const { colors: c } = useTheme();
  return (
    <View style={styles.container}>
      <Text style={[styles.title, { color: c.text }]}>{title}</Text>
      <FlatList
        horizontal
        data={channels}
        keyExtractor={ch => ch.id}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.listContent}
        initialNumToRender={8}
        removeClippedSubviews
        renderItem={({ item }) => (
          <ChannelCard channel={item} width={CARD} onPress={openPlayer} />
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 16,
  },
  title: {
    fontWeight: '700',
    fontSize: 15,
    marginHorizontal: 20,
    marginBottom: 10,
  },
  listContent: {
    paddingHorizontal: 20,
    gap: 10,
  },
});
