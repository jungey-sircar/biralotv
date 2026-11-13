import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { SafeScreen } from '@/components/SafeScreen';
import { ScreenError } from '@/components/screen-error';
import { VodRow } from '@/components/vod-row';
import { NetflixHero } from '@/components/netflix-hero';
import { ContinueWatchingRow } from '@/components/continue-watching-row';
import { searchArchive, type VodItem } from '@/lib/archive';
import { msBrowse, useMsConfigured } from '@/lib/media-server';
import {
  tmdbGenreMovies,
  tmdbGenreTV,
  tmdbLatestMovies,
  tmdbOnTheAirTV,
  tmdbPopularMovies,
  tmdbPopularTV,
  tmdbTopRatedMovies,
  tmdbTopRatedTV,
  tmdbTrendingMovies,
  tmdbTrendingTV,
  TMDB_GENRES,
  TMDB_TV_GENRES,
} from '@/lib/tmdb';
import { openVodItem } from '@/lib/util';
import { useLocalStore, watchlistItemToVod } from '@/lib/store';
import { useTheme } from '@/theme';

const HEADER_LOGO_DARK = require('../../assets/images/biralotv-horizontal.png');
const HEADER_LOGO_LIGHT = require('../../assets/images/biralotv-horizontal-light.png');

type FilterKey = 'all' | 'movies' | 'series' | 'favorites';

const FILTER_TABS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'movies', label: 'Movies' },
  { key: 'series', label: 'TV Shows' },
  { key: 'favorites', label: 'My List' },
];

function Home() {
  const { colors, dark } = useTheme();
  const hasServer = useMsConfigured();

  const [activeFilter, setActiveFilter] = useState<FilterKey>('all');

  // Movies
  const [trendingMovies, setTrendingMovies] = useState<VodItem[]>([]);
  const [popularMovies, setPopularMovies] = useState<VodItem[]>([]);
  const [latestMovies, setLatestMovies] = useState<VodItem[]>([]);
  const [topRatedMovies, setTopRatedMovies] = useState<VodItem[]>([]);

  // TV Shows
  const [trendingTV, setTrendingTV] = useState<VodItem[]>([]);
  const [popularTV, setPopularTV] = useState<VodItem[]>([]);
  const [topRatedTV, setTopRatedTV] = useState<VodItem[]>([]);
  const [onTheAirTV, setOnTheAirTV] = useState<VodItem[]>([]);
  const [actionTV, setActionTV] = useState<VodItem[]>([]);
  const [scifiTV, setScifiTV] = useState<VodItem[]>([]);
  const [dramaTV, setDramaTV] = useState<VodItem[]>([]);
  const [comedyTV, setComedyTV] = useState<VodItem[]>([]);
  const [animationTV, setAnimationTV] = useState<VodItem[]>([]);

  // Movie Genre rows
  const [actionMovies, setActionMovies] = useState<VodItem[]>([]);
  const [scifiMovies, setScifiMovies] = useState<VodItem[]>([]);
  const [comedyMovies, setComedyMovies] = useState<VodItem[]>([]);
  const [horrorMovies, setHorrorMovies] = useState<VodItem[]>([]);
  const [animationMovies, setAnimationMovies] = useState<VodItem[]>([]);

  // Classics & Library
  const [archiveFilms, setArchiveFilms] = useState<VodItem[]>([]);
  const [library, setLibrary] = useState<VodItem[]>([]);

  // Store slices
  const continueWatching = useLocalStore(s => s.continueWatching);
  const watchlist = useLocalStore(s => s.watchlist);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(() => {
    let alive = true;
    const run = async () => {
      try {
        const pTrending = tmdbTrendingMovies(1).catch(() => [] as VodItem[]);
        const pLatest = tmdbLatestMovies(1).catch(() => [] as VodItem[]);
        const pPopular = tmdbPopularMovies(1).catch(() => [] as VodItem[]);
        const pTopRated = tmdbTopRatedMovies(1).catch(() => [] as VodItem[]);

        const pTrendingTV = tmdbTrendingTV(1).catch(() => [] as VodItem[]);
        const pPopularTV = tmdbPopularTV(1).catch(() => [] as VodItem[]);
        const pTopRatedTV = tmdbTopRatedTV(1).catch(() => [] as VodItem[]);
        const pOnTheAirTV = tmdbOnTheAirTV(1).catch(() => [] as VodItem[]);
        const pActionTV = tmdbGenreTV(TMDB_TV_GENRES.ACTION_ADVENTURE, 1).catch(() => [] as VodItem[]);
        const pScifiTV = tmdbGenreTV(TMDB_TV_GENRES.SCIFI_FANTASY, 1).catch(() => [] as VodItem[]);
        const pDramaTV = tmdbGenreTV(TMDB_TV_GENRES.DRAMA, 1).catch(() => [] as VodItem[]);
        const pComedyTV = tmdbGenreTV(TMDB_TV_GENRES.COMEDY, 1).catch(() => [] as VodItem[]);
        const pAnimationTV = tmdbGenreTV(TMDB_TV_GENRES.ANIMATION, 1).catch(() => [] as VodItem[]);

        const pAction = tmdbGenreMovies(TMDB_GENRES.ACTION, 1).catch(() => [] as VodItem[]);
        const pScifi = tmdbGenreMovies(TMDB_GENRES.SCIFI, 1).catch(() => [] as VodItem[]);
        const pComedy = tmdbGenreMovies(TMDB_GENRES.COMEDY, 1).catch(() => [] as VodItem[]);
        const pHorror = tmdbGenreMovies(TMDB_GENRES.HORROR, 1).catch(() => [] as VodItem[]);
        const pAnimation = tmdbGenreMovies(TMDB_GENRES.ANIMATION, 1).catch(() => [] as VodItem[]);

        const pArchive = searchArchive({ rows: 12 }).catch(() => [] as VodItem[]);
        const pLibrary = hasServer
          ? msBrowse({ pageSize: 12, latest: true }).catch(() => [] as VodItem[])
          : Promise.resolve([] as VodItem[]);

        const [
          trending,
          latest,
          popular,
          topRated,
          tvTrending,
          tvPopular,
          tvTopRated,
          tvOnTheAir,
          tvAction,
          tvScifi,
          tvDrama,
          tvComedy,
          tvAnimation,
          action,
          scifi,
          comedy,
          horror,
          animation,
          archive,
          lib,
        ] = await Promise.all([
          pTrending,
          pLatest,
          pPopular,
          pTopRated,
          pTrendingTV,
          pPopularTV,
          pTopRatedTV,
          pOnTheAirTV,
          pActionTV,
          pScifiTV,
          pDramaTV,
          pComedyTV,
          pAnimationTV,
          pAction,
          pScifi,
          pComedy,
          pHorror,
          pAnimation,
          pArchive,
          pLibrary,
        ]);

        if (!alive) return;

        setTrendingMovies(trending);
        setLatestMovies(latest);
        setPopularMovies(popular);
        setTopRatedMovies(topRated);

        setTrendingTV(tvTrending);
        setPopularTV(tvPopular);
        setTopRatedTV(tvTopRated);
        setOnTheAirTV(tvOnTheAir);
        setActionTV(tvAction);
        setScifiTV(tvScifi);
        setDramaTV(tvDrama);
        setComedyTV(tvComedy);
        setAnimationTV(tvAnimation);

        setActionMovies(action);
        setScifiMovies(scifi);
        setComedyMovies(comedy);
        setHorrorMovies(horror);
        setAnimationMovies(animation);
        setArchiveFilms(archive);
        setLibrary(lib);

        setError('');
        setLoading(false);
      } catch {
        if (!alive) return;
        setError('Could not load catalog. Check your internet connection.');
        setLoading(false);
      }
    };
    void run();
    return () => {
      alive = false;
    };
  }, [hasServer]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // Spotlight items for the Netflix Hero billboard (top 6 trending & latest titles with backdrops)
  const spotlightPool =
    activeFilter === 'series'
      ? trendingTV
      : trendingMovies.length > 0
        ? trendingMovies
        : latestMovies;
  const spotlight = spotlightPool.filter(i => Boolean(i.backdrop || i.poster)).slice(0, 6);

  const mylistVods = watchlist.map(watchlistItemToVod);

  const handleOpenItem = (item: VodItem) => {
    void openVodItem(item).then(message => setNotice(message ?? ''));
  };

  const headerView = (
    <View style={styles.header}>
      <View style={styles.headerTop}>
        <Image
          source={dark ? HEADER_LOGO_DARK : HEADER_LOGO_LIGHT}
          style={styles.brandLogo}
          contentFit="contain"
          accessibilityLabel="BiraloTV"
        />
        <View style={styles.headerIcons}>
          <TouchableOpacity
            style={[styles.iconBtn, { backgroundColor: colors.elevated }]}
            onPress={() => router.push({ pathname: '/on-demand', params: { query: '' } })}
            hitSlop={8}
            accessibilityLabel="Search"
          >
            <Text style={[styles.iconText, { color: colors.text }]}>🔍</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.iconBtn, { backgroundColor: colors.elevated }]}
            onPress={() => router.push('/settings')}
            hitSlop={8}
            accessibilityLabel="Settings"
          >
            <Text style={[styles.iconText, { color: colors.text }]}>⚙</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Netflix Filter Tabs */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterPills}
        style={styles.filterScroll}
      >
        {FILTER_TABS.map(tab => {
          const active = activeFilter === tab.key;
          return (
            <TouchableOpacity
              key={tab.key}
              style={[
                styles.filterPill,
                {
                  backgroundColor: active ? colors.text : colors.elevated,
                },
              ]}
              onPress={() => {
                if (tab.key === 'favorites') {
                  router.push('/favorites');
                } else {
                  setActiveFilter(tab.key);
                }
              }}
            >
              <Text
                style={[
                  styles.filterPillText,
                  { color: active ? colors.bg : colors.text },
                ]}
              >
                {tab.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );

  const nothingYet =
    trendingMovies.length === 0 &&
    latestMovies.length === 0 &&
    popularMovies.length === 0 &&
    archiveFilms.length === 0;

  let body;
  if (loading && nothingYet) {
    body = (
      <View style={styles.loadingWrap}>
        <ActivityIndicator size="large" color={colors.accent} />
        <Text style={[styles.loadingText, { color: colors.textMuted }]}>
          Loading BiraloTV…
        </Text>
      </View>
    );
  } else {
    body = (
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* Netflix Featured Hero Billboard */}
        {spotlight.length > 0 ? (
          <NetflixHero
            items={spotlight}
            onPlay={handleOpenItem}
            onInfo={handleOpenItem}
          />
        ) : null}

        <View style={styles.rowsContainer}>
          {/* Continue Watching Row (Saved locally) */}
          <ContinueWatchingRow items={continueWatching} />

          {/* My List Row (Saved locally) */}
          {mylistVods.length > 0 ? (
            <VodRow
              title="My List"
              subtitle="Movies & TV series you saved"
              items={mylistVods}
              onSeeAll={() => router.push('/favorites')}
              onPress={handleOpenItem}
            />
          ) : null}

          {/* Movies / All View */}
          {activeFilter !== 'series' ? (
            <>
              {/* Trending Now (with Netflix Top 10 badges!) */}
              <VodRow
                title="Trending Now"
                subtitle="Top 10 in movies today"
                items={trendingMovies}
                showRanks
                onSeeAll={() =>
                  router.push({ pathname: '/on-demand', params: { scope: 'trending-movies' } })
                }
                onPress={handleOpenItem}
              />

              {/* Popular on BiraloTV */}
              <VodRow
                title="Popular on BiraloTV"
                items={popularMovies}
                onSeeAll={() =>
                  router.push({ pathname: '/on-demand', params: { scope: 'popular-movies' } })
                }
                onPress={handleOpenItem}
              />

              {/* Latest Releases */}
              <VodRow
                title="Latest Releases"
                items={latestMovies}
                onSeeAll={() =>
                  router.push({ pathname: '/on-demand', params: { scope: 'latest-movies' } })
                }
                onPress={handleOpenItem}
              />

              {/* Top Rated */}
              <VodRow
                title="Critically Acclaimed"
                subtitle="Highest rated movies"
                items={topRatedMovies}
                onSeeAll={() =>
                  router.push({ pathname: '/on-demand', params: { scope: 'top-rated-movies' } })
                }
                onPress={handleOpenItem}
              />

              {/* Action & Adventure */}
              <VodRow
                title="Action & Adventure"
                items={actionMovies}
                onSeeAll={() =>
                  router.push({ pathname: '/on-demand', params: { scope: 'action-movies' } })
                }
                onPress={handleOpenItem}
              />

              {/* Sci-Fi & Fantasy */}
              <VodRow
                title="Sci-Fi & Fantasy"
                items={scifiMovies}
                onSeeAll={() =>
                  router.push({ pathname: '/on-demand', params: { scope: 'scifi-movies' } })
                }
                onPress={handleOpenItem}
              />

              {/* Comedy Hits */}
              <VodRow
                title="Comedy Hits"
                items={comedyMovies}
                onSeeAll={() =>
                  router.push({ pathname: '/on-demand', params: { scope: 'comedy-movies' } })
                }
                onPress={handleOpenItem}
              />

              {/* Horror & Thrillers */}
              <VodRow
                title="Horror & Thrillers"
                items={horrorMovies}
                onSeeAll={() =>
                  router.push({ pathname: '/on-demand', params: { scope: 'horror-movies' } })
                }
                onPress={handleOpenItem}
              />

              {/* Animation & Anime */}
              <VodRow
                title="Animation & Anime"
                items={animationMovies}
                onSeeAll={() =>
                  router.push({ pathname: '/on-demand', params: { scope: 'animation-movies' } })
                }
                onPress={handleOpenItem}
              />
            </>
          ) : null}

          {/* Series / TV View */}
          {activeFilter !== 'movies' ? (
            <>
              {activeFilter === 'series' ? (
                <View style={styles.tvBrowseBanner}>
                  <TouchableOpacity
                    style={[styles.tvBrowseBtn, { backgroundColor: colors.accent }]}
                    onPress={() =>
                      router.push({ pathname: '/on-demand', params: { scope: 'trending-tv' } })
                    }
                    activeOpacity={0.8}
                  >
                    <Text style={styles.tvBrowseBtnText}>📺 Browse All TV Shows & Series ›</Text>
                  </TouchableOpacity>
                </View>
              ) : null}

              {/* Trending TV Series */}
              <VodRow
                title="Trending TV Series"
                subtitle="Top 10 most watched shows this week"
                items={trendingTV}
                showRanks
                onSeeAll={() =>
                  router.push({ pathname: '/on-demand', params: { scope: 'trending-tv' } })
                }
                onPress={handleOpenItem}
              />

              {/* Popular TV Shows */}
              <VodRow
                title="Popular TV Shows"
                subtitle="Fan favorites worldwide"
                items={popularTV}
                onSeeAll={() =>
                  router.push({ pathname: '/on-demand', params: { scope: 'popular-tv' } })
                }
                onPress={handleOpenItem}
              />

              {/* Top Rated TV */}
              <VodRow
                title="Critically Acclaimed TV"
                subtitle="Highest rated television series"
                items={topRatedTV}
                onSeeAll={() =>
                  router.push({ pathname: '/on-demand', params: { scope: 'top-rated-tv' } })
                }
                onPress={handleOpenItem}
              />

              {/* Airing Today & On The Air */}
              <VodRow
                title="New & Airing Episodes"
                subtitle="Currently broadcasting series"
                items={onTheAirTV}
                onSeeAll={() =>
                  router.push({ pathname: '/on-demand', params: { scope: 'on-the-air-tv' } })
                }
                onPress={handleOpenItem}
              />

              {/* Action & Adventure TV */}
              <VodRow
                title="Action & Adventure Series"
                items={actionTV}
                onSeeAll={() =>
                  router.push({ pathname: '/on-demand', params: { scope: 'action-tv' } })
                }
                onPress={handleOpenItem}
              />

              {/* Sci-Fi & Fantasy TV */}
              <VodRow
                title="Sci-Fi & Fantasy TV"
                items={scifiTV}
                onSeeAll={() =>
                  router.push({ pathname: '/on-demand', params: { scope: 'scifi-tv' } })
                }
                onPress={handleOpenItem}
              />

              {/* Drama & Thriller Series */}
              <VodRow
                title="Drama & Thriller Series"
                items={dramaTV}
                onSeeAll={() =>
                  router.push({ pathname: '/on-demand', params: { scope: 'drama-tv' } })
                }
                onPress={handleOpenItem}
              />

              {/* Comedy Series */}
              <VodRow
                title="Comedy Series"
                items={comedyTV}
                onSeeAll={() =>
                  router.push({ pathname: '/on-demand', params: { scope: 'comedy-tv' } })
                }
                onPress={handleOpenItem}
              />

              {/* Anime & Animated TV */}
              <VodRow
                title="Anime & Animated TV"
                items={animationTV}
                onSeeAll={() =>
                  router.push({ pathname: '/on-demand', params: { scope: 'anime-tv' } })
                }
                onPress={handleOpenItem}
              />
            </>
          ) : null}

          {/* Free Cinema & Classics */}
          <VodRow
            title="Free to Watch Cinema"
            subtitle="Public domain classics & cult films"
            items={archiveFilms}
            onSeeAll={() =>
              router.push({ pathname: '/on-demand', params: { scope: 'films' } })
            }
            onPress={handleOpenItem}
          />

          {/* Media Server Library */}
          {library.length > 0 ? (
            <VodRow
              title="From Your Library"
              items={library}
              onSeeAll={() =>
                router.push({ pathname: '/on-demand', params: { scope: 'server' } })
              }
              onPress={handleOpenItem}
            />
          ) : null}
        </View>
      </ScrollView>
    );
  }

  return (
    <ScreenError
      error={error}
      onRetry={() => {
        setNotice('');
        load();
      }}
    >
      <SafeScreen bg={colors.bg}>
        {headerView}
        {notice ? (
          <TouchableOpacity
            style={[styles.notice, { backgroundColor: colors.danger }]}
            onPress={() => setNotice('')}
          >
            <Text style={styles.noticeText} numberOfLines={2}>
              {notice}
            </Text>
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
    paddingBottom: 10,
    paddingHorizontal: 22,
    zIndex: 20,
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  brandLogo: {
    width: 200,
    height: 52,
  },
  headerIcons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconText: {
    fontSize: 16,
  },
  filterScroll: {
    marginTop: 10,
    flexGrow: 0,
  },
  filterPills: {
    gap: 8,
    paddingRight: 10,
  },
  filterPill: {
    paddingVertical: 7,
    paddingHorizontal: 16,
    borderRadius: 999,
  },
  filterPillText: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: -0.1,
  },
  rowsContainer: {
    paddingTop: 16,
  },
  loadingWrap: {
    paddingVertical: 120,
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
    fontWeight: '600',
  },
  notice: {
    marginHorizontal: 22,
    marginBottom: 12,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  noticeText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  tvBrowseBanner: {
    paddingHorizontal: 22,
    marginBottom: 16,
  },
  tvBrowseBtn: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tvBrowseBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
});
