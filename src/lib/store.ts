import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Channel } from './api';
import type { VodItem } from './archive';

export type LocalPlaylist = {
  id: string;
  name: string;
  url?: string;
  text?: string;
  channelCount: number;
  createdAt: string;
};

export type WatchlistItem = {
  id: string;
  title: string;
  year?: number;
  poster?: string;
  backdrop?: string;
  overview?: string;
  source: string;
  tmdbId?: number;
  tmdbKind?: 'movie' | 'tv';
  rating?: number;
  addedAt: number;
};

export type ContinueWatchingItem = {
  id: string;
  title: string;
  poster?: string;
  backdrop?: string;
  source: string;
  stream?: string;
  kind?: 'movie' | 'tv';
  tmdbId?: number;
  season?: number;
  episode?: number;
  episodeTitle?: string;
  position: number; // in seconds
  duration: number; // in seconds
  lastWatched: number; // ms timestamp
};

export function vodToWatchlistItem(item: VodItem | WatchlistItem): WatchlistItem {
  return {
    id: item.id,
    title: item.title,
    year: item.year,
    poster: item.poster,
    backdrop: 'backdrop' in item ? item.backdrop : undefined,
    overview: item.overview,
    source: item.source,
    tmdbId: item.tmdbId,
    tmdbKind: item.tmdbKind,
    rating: item.rating,
    addedAt: 'addedAt' in item && typeof item.addedAt === 'number' ? item.addedAt : Date.now(),
  };
}

export function watchlistItemToVod(item: WatchlistItem): VodItem {
  return {
    id: item.id,
    title: item.title,
    year: item.year,
    poster: item.poster,
    backdrop: item.backdrop,
    overview: item.overview,
    source: (item.source as VodItem['source']) || 'tmdb',
    tmdbId: item.tmdbId,
    tmdbKind: item.tmdbKind,
    rating: item.rating,
  };
}

type LocalStoreState = {
  // Legacy / Channel favorites & recents
  favorites: Channel[];
  recents: Channel[];
  playlists: LocalPlaylist[];

  addFavorite: (ch: Channel) => void;
  removeFavorite: (id: string) => void;
  isFavorite: (id: string) => boolean;

  addRecent: (ch: Channel) => void;

  addPlaylist: (playlist: LocalPlaylist) => void;
  removePlaylist: (id: string) => void;

  // Netflix-style Watchlist / Favorites (Movies & TV Series)
  watchlist: WatchlistItem[];
  addToWatchlist: (item: VodItem | WatchlistItem) => void;
  removeFromWatchlist: (id: string) => void;
  inWatchlist: (id: string) => boolean;
  toggleWatchlist: (item: VodItem | WatchlistItem) => boolean;

  // Netflix-style Continue Watching (Playback progress)
  continueWatching: ContinueWatchingItem[];
  saveContinueWatching: (item: Omit<ContinueWatchingItem, 'lastWatched'> & { lastWatched?: number }) => void;
  updatePlaybackProgress: (id: string, position: number, duration?: number) => void;
  removeContinueWatching: (id: string) => void;
  clearContinueWatching: () => void;
};

export const useLocalStore = create<LocalStoreState>()(
  persist(
    (set, get) => ({
      favorites: [],
      recents: [],
      playlists: [],
      watchlist: [],
      continueWatching: [],

      addFavorite: (ch: Channel) =>
        set(s => {
          if (s.favorites.some(f => f.id === ch.id)) return s;
          return { favorites: [ch, ...s.favorites] };
        }),

      removeFavorite: (id: string) =>
        set(s => ({ favorites: s.favorites.filter(f => f.id !== id) })),

      isFavorite: (id: string) => get().favorites.some(f => f.id === id),

      addRecent: (ch: Channel) =>
        set(s => {
          const filtered = s.recents.filter(r => r.id !== ch.id);
          return { recents: [ch, ...filtered].slice(0, 50) };
        }),

      addPlaylist: (playlist: LocalPlaylist) =>
        set(s => {
          const filtered = s.playlists.filter(p => p.id !== playlist.id);
          return { playlists: [...filtered, playlist] };
        }),

      removePlaylist: (id: string) =>
        set(s => ({ playlists: s.playlists.filter(p => p.id !== id) })),

      // Watchlist implementations
      addToWatchlist: (item: VodItem | WatchlistItem) =>
        set(s => {
          if (s.watchlist.some(w => w.id === item.id)) return s;
          return { watchlist: [vodToWatchlistItem(item), ...s.watchlist] };
        }),

      removeFromWatchlist: (id: string) =>
        set(s => ({ watchlist: s.watchlist.filter(w => w.id !== id) })),

      inWatchlist: (id: string) => get().watchlist.some(w => w.id === id),

      toggleWatchlist: (item: VodItem | WatchlistItem) => {
        const exists = get().watchlist.some(w => w.id === item.id);
        if (exists) {
          set(s => ({ watchlist: s.watchlist.filter(w => w.id !== item.id) }));
          return false;
        } else {
          set(s => ({ watchlist: [vodToWatchlistItem(item), ...s.watchlist] }));
          return true;
        }
      },

      // Continue watching implementations
      saveContinueWatching: entry =>
        set(s => {
          const filtered = s.continueWatching.filter(c => c.id !== entry.id);
          const item: ContinueWatchingItem = {
            ...entry,
            lastWatched: entry.lastWatched ?? Date.now(),
          };
          return { continueWatching: [item, ...filtered].slice(0, 30) };
        }),

      updatePlaybackProgress: (id, position, duration) =>
        set(s => {
          const existing = s.continueWatching.find(c => c.id === id);
          if (!existing) return s;
          const pos = Math.max(0, Math.round(position));
          const dur = duration && duration > 0 ? Math.round(duration) : existing.duration;
          const updated: ContinueWatchingItem = {
            ...existing,
            position: pos,
            duration: dur,
            lastWatched: Date.now(),
          };
          const rest = s.continueWatching.filter(c => c.id !== id);
          return { continueWatching: [updated, ...rest] };
        }),

      removeContinueWatching: (id: string) =>
        set(s => ({ continueWatching: s.continueWatching.filter(c => c.id !== id) })),

      clearContinueWatching: () => set({ continueWatching: [] }),
    }),
    {
      name: 'biralotv.local.v2',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);

/** Wait for the local store to finish hydrating from AsyncStorage */
export function useLocalStoreHydrated(): boolean {
  const [ready, setReady] = useState(useLocalStore.persist.hasHydrated());
  useEffect(() => {
    if (!ready) {
      return useLocalStore.persist.onFinishHydration(() => setReady(true));
    }
  }, [ready]);
  return ready;
}
