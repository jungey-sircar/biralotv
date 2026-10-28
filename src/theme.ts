import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useColorScheme } from 'react-native';

export type Mode = 'dark' | 'light' | 'system';

type SettingsState = {
  mode: Mode;
  accent: string;
  showAdult: boolean;
  tmdbKey: string;
  setMode: (m: Mode) => void;
  setAccent: (a: string) => void;
  setShowAdult: (v: boolean) => void;
  setTmdbKey: (v: string) => void;
};

export const useSettings = create<SettingsState>()(
  persist(
    set => ({
      mode: 'dark',
      accent: '#ff4533',
      showAdult: false,
      tmdbKey: '',
      setMode: m => set({ mode: m }),
      setAccent: a => set({ accent: a }),
      setShowAdult: v => set({ showAdult: v }),
      setTmdbKey: v => set({ tmdbKey: v.trim() }),
    }),
    { name: 'biralotv.settings', storage: createJSONStorage(() => AsyncStorage) },
  ),
);

export const ACCENTS = [
  { name: 'Coral', value: '#ff4533' },
  { name: 'Blue', value: '#0a84ff' },
  { name: 'Green', value: '#30d158' },
  { name: 'Purple', value: '#bf5af2' },
  { name: 'Amber', value: '#ffb340' },
];

export const PALETTES = {
  dark: {
    bg: '#0a0a0c',
    surface: '#151519',
    elevated: '#1f1f26',
    text: '#ffffff',
    textSecondary: 'rgba(255,255,255,0.64)',
    textMuted: 'rgba(255,255,255,0.38)',
    pressed: 'rgba(255,255,255,0.08)',
    danger: '#ff3b30',
  },
  light: {
    bg: '#f5f5f7',
    surface: '#ffffff',
    elevated: '#e9e9ee',
    text: '#101012',
    textSecondary: 'rgba(0,0,0,0.62)',
    textMuted: 'rgba(0,0,0,0.38)',
    pressed: 'rgba(0,0,0,0.06)',
    danger: '#e02d20',
  },
} as const;

export function useTheme() {
  const mode = useSettings(s => s.mode);
  const accent = useSettings(s => s.accent);
  const scheme = useColorScheme();
  const m: 'dark' | 'light' = mode === 'system' ? (scheme === 'light' ? 'light' : 'dark') : mode;
  return { colors: { ...PALETTES[m], accent }, dark: m === 'dark', mode: m };
}

/** hide adult channels unless opted in */
const ADULT_RE = /(18\+|adult|porn|xxx|brazzers|playboy|penthouse|hustler|venus|erotic|nudes?|dorama-index)/i;
export function filterAdult<T extends { name?: string }>(items: T[], showAdult: boolean): T[] {
  if (showAdult) return items;
  return items.filter(i => !ADULT_RE.test(i.name ?? ''));
}
