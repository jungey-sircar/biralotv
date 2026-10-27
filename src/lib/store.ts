import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Channel } from './api';

export type LocalPlaylist = {
  id: string;
  name: string;
  url?: string;
  text?: string;
  channelCount: number;
  createdAt: string;
};

type LocalStoreState = {
  favorites: Channel[];
  recents: Channel[];
  playlists: LocalPlaylist[];

  addFavorite: (ch: Channel) => void;
  removeFavorite: (id: string) => void;
  isFavorite: (id: string) => boolean;

  addRecent: (ch: Channel) => void;

  addPlaylist: (playlist: LocalPlaylist) => void;
  removePlaylist: (id: string) => void;
};

export const useLocalStore = create<LocalStoreState>()(
  persist(
    (set, get) => ({
      favorites: [],
      recents: [],
      playlists: [],

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
    }),
    {
      name: 'biralotv.local.v1',
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
