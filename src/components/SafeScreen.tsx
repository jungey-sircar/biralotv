import { ReactNode } from 'react';
import { View, ViewStyle, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/theme';

type Props = {
  children: ReactNode;
  bg?: string;
  style?: ViewStyle | ViewStyle[];
  /** skip bottom inset (e.g. player full-bleed) */
  noBottom?: boolean;
  /** skip top inset (e.g. player full-bleed) */
  noTop?: boolean;
};

export function SafeScreen({ children, style, noBottom, noTop }: Props) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  return (
    <View
      style={[
        styles.base,
        {
          backgroundColor: colors.bg,
          paddingTop: noTop ? 0 : insets.top,
          paddingBottom: noBottom ? 0 : insets.bottom,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    flex: 1,
  },
});
