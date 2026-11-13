import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { Animated, Easing, Platform, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useTheme } from '@/theme';

const FRAMES = [
  require('../../assets/images/running-cat-1.png'),
  require('../../assets/images/running-cat-2.png'),
  require('../../assets/images/running-cat-3.png'),
  require('../../assets/images/running-cat-4.png'),
];
const LOGO_DARK = require('../../assets/images/biralotv-logo.png');
const LOGO_LIGHT = require('../../assets/images/biralotv-logo-light.png');

const FRAME_MS = 110;
const NATIVE_DRIVER = Platform.OS !== 'web';

type Props = {
  running: boolean;
  onFirstFrame: () => void;
};

export function CatSplash({ running, onFirstFrame }: Props) {
  const { colors, dark } = useTheme();
  const { width, height } = useWindowDimensions();
  const [frame, setFrame] = useState(0);
  const [cross] = useState(() => new Animated.Value(0));
  const [bob] = useState(() => new Animated.Value(0));
  const [fade] = useState(() => new Animated.Value(0));

  useEffect(() => {
    const id = setInterval(() => setFrame(f => (f + 1) % FRAMES.length), FRAME_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    cross.setValue(0);
    bob.setValue(0);
    const run = Animated.loop(
      Animated.timing(cross, {
        toValue: 1,
        duration: 2400,
        easing: Easing.linear,
        useNativeDriver: NATIVE_DRIVER,
      }),
    );
    const hop = Animated.loop(
      Animated.sequence([
        Animated.timing(bob, { toValue: -9, duration: 130, easing: Easing.out(Easing.quad), useNativeDriver: NATIVE_DRIVER }),
        Animated.timing(bob, { toValue: 0, duration: 130, easing: Easing.in(Easing.quad), useNativeDriver: NATIVE_DRIVER }),
      ]),
    );
    run.start();
    hop.start();
    return () => {
      run.stop();
      hop.stop();
    };
  }, [cross, bob]);

  useEffect(() => {
    Animated.timing(fade, {
      toValue: running ? 1 : 0,
      duration: running ? 220 : 320,
      easing: Easing.inOut(Easing.quad),
      useNativeDriver: NATIVE_DRIVER,
    }).start();
  }, [fade, running]);

  const catW = Math.min(320, width * 0.62, height * 0.44);
  const catH = catW * 0.75;
  const logoW = Math.min(268, width * 0.62, height * 0.34);
  const logoH = logoW * (552 / 702);

  return (
    <Animated.View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { backgroundColor: colors.bg, opacity: fade }]}
    >
      <View style={[styles.brand, { top: Math.max(24, height * 0.14) }]}>
        <Image
          source={dark ? LOGO_DARK : LOGO_LIGHT}
          style={{ width: logoW, height: logoH }}
          contentFit="contain"
          accessibilityLabel="BiraloTV"
        />
        <View style={styles.dots}>
          {FRAMES.map((_, i) => (
            <View
              key={i}
              style={[styles.dot, { backgroundColor: i === frame ? colors.accent : colors.elevated }]}
            />
          ))}
        </View>
      </View>
      <Animated.View
        style={[
          styles.cat,
          {
            width: catW,
            height: catH,
            left: -catW,
            bottom: height * 0.11,
            transform: [
              { translateX: cross.interpolate({ inputRange: [0, 1], outputRange: [0, width + catW * 2] }) },
              { translateY: bob },
            ],
          },
        ]}
      >
        <Image
          source={FRAMES[frame]}
          style={styles.img}
          contentFit="contain"
          onLoad={onFirstFrame}
          onError={onFirstFrame}
        />
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  brand: { position: 'absolute', alignSelf: 'center', alignItems: 'center' },
  dots: { flexDirection: 'row', marginTop: 14 },
  dot: { width: 7, height: 7, borderRadius: 4, marginHorizontal: 4 },
  cat: { position: 'absolute' },
  img: { width: '100%', height: '100%' },
});
