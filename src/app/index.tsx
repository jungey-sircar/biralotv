import type { Channel } from '@/lib/api';

const { useCallback, useState } = require('react');
const { ScrollView, StyleSheet, Text, TouchableOpacity, View } = require('react-native');
const { router, useFocusEffect } = require('expo-router');
const { SafeScreen } = require('@/components/SafeScreen');
const { ChannelRow } = require('@/components/row');
const { ScreenError, ScreenLoading } = require('@/components/screen-error');
const { useLocalStore } = require('@/lib/store');
const {
  IPTV_CATEGORIES,
  POPULAR_COUNTRIES,
  fetchCategoryChannels,
  fetchCountryChannels,
} = require('@/lib/iptv');
const { filterAdult, useSettings, useTheme } = require('@/theme');

const FEATURED_NAMES = ['News', 'Movies', 'Kids', 'Music', 'Sports'];
const COUNTRY_CODES = ['us', 'gb', 'de'];

type Section = { title: string; channels: Channel[] };

async function loadSection(
  title: string,
  fetcher: () => Promise<Channel[]>,
  showAdult: boolean,
): Promise<Section | null> {
  try {
    const channels = filterAdult(await fetcher(), showAdult).slice(0, 24);
    if (channels.length === 0) return null;
    return { title, channels };
  } catch (e) {
    void e;
    return null;
  }
}

function Home() {
  const { colors } = useTheme();
  const showAdult = useSettings((s) => s.showAdult);
  const [sections, setSections] = useState<Section[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');

  const load = useCallback(() => {
    const run = async () => {
      try {
        const store = useLocalStore.getState();
        const recents = store.recents.slice(0, 20);
        const favorites = store.favorites.slice(0, 20);
        const tasks = [];
        if (recents.length > 0) {
          tasks.push(loadSection('Continue watching', () => Promise.resolve(recents), showAdult));
        }
        if (favorites.length > 0) {
          tasks.push(loadSection('My channels', () => Promise.resolve(favorites), showAdult));
        }
        for (const name of FEATURED_NAMES) {
          const category = IPTV_CATEGORIES.find(
            (c) => c.name.toLowerCase() === name.toLowerCase(),
          );
          if (!category) continue;
          tasks.push(loadSection(category.name, () => fetchCategoryChannels(category.id), showAdult));
        }
        for (const code of COUNTRY_CODES) {
          const country = POPULAR_COUNTRIES.find((c) => c.code === code);
          if (!country) continue;
          tasks.push(loadSection(country.name, () => fetchCountryChannels(country.code), showAdult));
        }
        const results = await Promise.all(tasks);
        setSections(results.filter((s): s is Section => s !== null));
        setError('');
        setLoading(false);
      } catch (e) {
        void e;
        setError('Could not load channels. Check your connection or add a playlist.');
        setLoading(false);
      }
    };
    void run();
  }, [showAdult]);

  useFocusEffect(useCallback(() => {
    load();
  }, [load]));

  const headerView = (
    <View style={[styles.header, { borderColor: colors.border }]}>
      <View style={styles.headerRow}>
        <View style={styles.headerText}>
          <Text style={[styles.title, { color: colors.text }]}>biraloTV</Text>
          <Text style={[styles.subtitle, { color: colors.muted }]}>
            Free live TV from iptv-org playlists
          </Text>
        </View>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.links}
        style={styles.linksScroll}
      >
        {HEADER_LINKS.map((link) => (
          <TouchableOpacity
            key={link.href}
            style={[styles.link, { backgroundColor: colors.shadow }, { borderColor: colors.border }]}
            onPress={() => router.push(link.href)}
          >
            <Text style={[styles.linkText, { color: colors.text }]}>{link.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );

  let body;
  if (loading) {
    body = <ScreenLoading message="Loading channels..." />;
  } else if (sections.length === 0) {
    body = (
      <View style={styles.empty}>
        <Text style={[styles.emptyTitle, { color: colors.text }]}>No channels yet</Text>
        <Text style={[styles.emptyText, { color: colors.muted }]}>
          Add a playlist to get started, or check your connection.
        </Text>
        <TouchableOpacity
          style={[styles.link, { backgroundColor: colors.shadow }, { borderColor: colors.border }, styles.center]}
          onPress={() => router.push('/playlists')}
        >
          <Text style={[styles.linkText, { color: colors.text }]}>Add playlist</Text>
        </TouchableOpacity>
      </View>
    );
  } else {
    body = (
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {sections.map((section) => (
          <ChannelRow key={section.title} title={section.title} channels={section.channels} />
        ))}
      </ScrollView>
    );
  }

  return (
    <ScreenError error={error} onRetry={load}>
      <SafeScreen bg={colors.bg}>
        {headerView}
        {body}
      </SafeScreen>
    </ScreenError>
  );
}

export default Home;

const styles = StyleSheet.create({
  scroll: {
    paddingBottom: 48,
  },
  header: {
    paddingTop: 8,
    paddingBottom: 20,
    paddingHorizontal: 24,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerRow: {
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  headerText: {},
  title: {
    fontSize: 32,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  subtitle: {
    marginTop: 4,
    fontSize: 13,
  },
  linksScroll: {
    marginTop: 16,
    flexGrow: 0,
  },
  links: {
    gap: 10,
    paddingRight: 24,
  },
  headerLinks: {},
  link: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  linkText: {
    fontSize: 14,
    fontWeight: '600',
  },
  empty: {
    paddingVertical: 80,
    alignItems: 'center',
  },
  emptyTitle: {
    fontSize: 22,
    fontWeight: '700',
  },
  emptyText: {
    marginTop: 8,
    fontSize: 14,
    textAlign: 'center',
    paddingHorizontal: 40,
    lineHeight: 20,
  },
  center: {
    marginTop: 24,
  },
});

module.exports = Home;
