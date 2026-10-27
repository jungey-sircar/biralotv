import { Channel } from '@/lib/api';
import { ChannelCard } from './ChannelCard';
import { FlatList, View, StyleSheet } from 'react-native';

type Props = {
  channels: Channel[];
  onPress: (ch: Channel) => void;
  cols: number;
  gap?: number;
  onEndReached?: () => void;
};

export function ChannelGrid({ channels, onPress, cols, gap = 10, onEndReached }: Props) {
  return (
    <FlatList
      data={channels}
      keyExtractor={c => c.id}
      numColumns={cols}
      key={cols}
      style={styles.list}
      windowSize={11}
      initialNumToRender={24}
      maxToRenderPerBatch={24}
      removeClippedSubviews={false}
      onEndReached={onEndReached}
      onEndReachedThreshold={0.5}
      contentContainerStyle={styles.content}
      renderItem={({ item }) => (
        <View style={{ flex: 1 / cols, maxWidth: `${100 / cols}%`, padding: gap / 2 }}>
          <ChannelCard channel={item} onPress={onPress} />
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  list: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 18,
    paddingTop: 8,
    paddingBottom: 24,
  },
});
