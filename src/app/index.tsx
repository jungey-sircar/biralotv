import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { SafeScreen } from '@/components/SafeScreen';
import { ChannelRow } from '@/components/row';
import { ScreenError } from '@/components/screen-error';
import { VodRow } from '@/components/vod-row';
import type { Channel } from '@/lib/api';
import { searchArchive, type VodItem } from '@/lib/archive';
import { msBrowse, useMsConfigured } from '@/lib/media-server';
import { tmdbLatestMovies, tmdbTrendingMovies } from '@/lib/tmdb';
import { openVodItem } from '@/lib/util';
import { useLocalStore } from '@/lib/store';
import {
  IPTV_CATEGORIES,
  POPULAR_COUNTRIES,
  fetchCategoryChannels,
  fetchCountryChannels,
} from '@/lib/iptv';
import { filterAdult, useSettings, useTheme } from '@/theme';

const FEATURED_NAMES = ['News', 'Movies', 'Kids', 'Music', 'Sports'];
const COUNTRY_CODES = ['us', 'gb', 'de'];
const HEADER_LOGO_DARK = require('../../assets/images/biralotv-horizontal.png');
const HEADER_LOGO_LIGHT = require('../../assets/images/biralotv-horizontal-light.png');
const HEADER_LINKS = [
  { key: 'latest-movies', label: 'Latest Movies', onPress: () => router.push({ pathname: '/on-demand', params: { scope: 'latest-movies' } }) },
  { key: 'on-demand', label: 'On Demand', onPress: () => router.push('/on-demand') },
  { key: 'browse', label: 'Live TV', onPress: () => router.push('/browse') },
  { key: 'search', label: 'Search TV', onPress: () => router.push('/channel-search') },
  { key: 'playlists', label: 'Playlists', onPress: () => router.push('/playlists') },
  { key: 'settings', label: 'Settings', onPress: () => router.push('/settings') },
] as const;

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
  const { colors, dark } = useTheme();
  const showAdult = useSettings(s => s.showAdult);
  const hasServer = useMsConfigured();
  const [sections, setSections] = useState<Section[]>([]);
  const [latestMovies, setLatestMovies] = useState<VodItem[]>([]);
  const [trendingMovies, setTrendingMovies] = useState<VodItem[]>([]);
  const [vod, setVod] = useState<VodItem[]>([]);
  const [library, setLibrary] = useState<VodItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(() => {
    const run = async () => {
      try {
        const store = useLocalStore.getState();
        const recents = store.recents.slice(0, 20);
        const favorites = store.favorites.slice(0, 20);
        const latestPromise = tmdbLatestMovies(1)
          .catch(() => [] as VodItem[])
          .then(items => {
            setLatestMovies(items.slice(0, 14));
            return items;
          });
        const trendingPromise = tmdbTrendingMovies(1)
          .catch(() => [] as VodItem[])
          .then(items => {
            setTrendingMovies(items.slice(0, 14));
            return items;
          });
        const filmsPromise = searchArchive({ rows: 10 })
          .catch(() => [] as VodItem[])
          .then(items => {
            setVod(items);
            return items;
          });
        const libraryPromise = (hasServer ? msBrowse({ pageSize: 10, latest: true }) : Promise.resolve([] as VodItem[]))
          .catch(() => [] as VodItem[])
          .then(items => {
            setLibrary(items);
            return items;
          });
        const tasks: Promise<Section | null>[] = [];
        if (recents.length > 0) {
          tasks.push(loadSection('Continue watching', () => Promise.resolve(recents), showAdult));
        }
        if (favorites.length > 0) {
          tasks.push(loadSection('My channels', () => Promise.resolve(favorites), showAdult));
        }
        for (const name of FEATURED_NAMES) {
          const category = IPTV_CATEGORIES.find(
            c => c.name.toLowerCase() === name.toLowerCase(),
          );
          if (!category) continue;
          tasks.push(loadSection(category.name, () => fetchCategoryChannels(category.id), showAdult));
        }
        for (const code of COUNTRY_CODES) {
          const country = POPULAR_COUNTRIES.find(c => c.code === code);
          if (!country) continue;
          tasks.push(loadSection(country.name, () => fetchCountryChannels(country.code), showAdult));
        }
        const results = await Promise.all(tasks);
        setSections(results.filter((s): s is Section => s !== null));
        await Promise.all([latestPromise, trendingPromise, filmsPromise, libraryPromise]);
        setError('');
        setLoading(false);
      } catch (e) {
        void e;
        setError('Could not load channels. Check your connection or add a playlist.');
        setLoading(false);
      }
    };
    void run();
  }, [showAdult, hasServer]);

  useFocusEffect(useCallback(() => {
    load();
  }, [load]));

  const headerView = (
    <View style={styles.header}>
      <View style={styles.headerRow}>
        <Image
          source={dark ? HEADER_LOGO_DARK : HEADER_LOGO_LIGHT}
          style={styles.brandLogo}
          contentFit="contain"
          accessibilityLabel="BiraloTV"
        />
        <Text style={[styles.subtitle, { color: colors.textMuted }]}>
          Live TV from iptv-org, plus latest movies and free films on demand
        </Text>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.links}
        style={styles.linksScroll}
      >
        {HEADER_LINKS.map(link => (
          <TouchableOpacity
            key={link.key}
            style={[styles.link, { backgroundColor: colors.elevated }]}
            onPress={link.onPress}
          >
            <Text style={[styles.linkText, { color: colors.text }]}>{link.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );

  const nothingYet =
    sections.length === 0 &&
    latestMovies.length === 0 &&
    trendingMovies.length === 0 &&
    vod.length === 0 &&
    library.length === 0;

  let body;
  if (loading && nothingYet) {
    body = (
      <View style={styles.empty}>
        <Text style={[styles.emptyText, { color: colors.textMuted }]}>Loading channels & movies…</Text>
      </View>
    );
  } else if (nothingYet) {
    body = (
      <View style={styles.empty}>
        <Text style={[styles.emptyTitle, { color: colors.text }]}>No channels yet</Text>
        <Text style={[styles.emptyText, { color: colors.textMuted }]}>
          Add a playlist to get started, or check your connection.
        </Text>
        <TouchableOpacity
          style={[styles.link, styles.center, { backgroundColor: colors.elevated }]}
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
        <VodRow
          title="From your library"
          items={library}
          onSeeAll={() => router.push({ pathname: '/on-demand', params: { scope: 'server' } })}
          onPress={item => {
            void openVodItem(item).then(message => setNotice(message ?? ''));
          }}
        />
        <VodRow
          title="Latest movies"
          items={latestMovies}
          onSeeAll={() => router.push({ pathname: '/on-demand', params: { scope: 'latest-movies' } })}
          onPress={item => {
            void openVodItem(item).then(message => setNotice(message ?? ''));
          }}
        />
        <VodRow
          title="Trending movies"
          items={trendingMovies}
          onSeeAll={() => router.push({ pathname: '/on-demand', params: { scope: 'trending-movies' } })}
          onPress={item => {
            void openVodItem(item).then(message => setNotice(message ?? ''));
          }}
        />
        <VodRow
          title="Free to watch"
          items={vod}
          onSeeAll={() => router.push({ pathname: '/on-demand', params: { scope: 'films' } })}
          onPress={item => {
            void openVodItem(item).then(message => setNotice(message ?? ''));
          }}
        />
        {sections.map(section => (
          <ChannelRow key={section.title} title={section.title} channels={section.channels} />
        ))}
      </ScrollView>
    );
  }

  return (
    <ScreenError error={error} onRetry={() => { setNotice(''); load(); }}>
      <SafeScreen bg={colors.bg}>
        {headerView}
        {notice ? (
          <TouchableOpacity style={[styles.notice, { backgroundColor: colors.danger }]} onPress={() => setNotice('')}>
            <Text style={styles.noticeText} numberOfLines={2}>{notice}</Text>
          </TouchableOpacity>
        ) : null}
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
  },
  headerRow: {
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  brandLogo: {
    width: 216,
    height: 56,
    marginBottom: 4,
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
  link: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 12,
  },
  linkText: {
    fontSize: 14,
    fontWeight: '600',
  },
  empty: {
    paddingVertical: 80,
    alignItems: 'center',
  },
  notice: {
    marginHorizontal: 24,
    marginBottom: 12,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  noticeText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
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
