import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export interface SubtitleTrackItem {
  id: string;
  language: string;
  label: string;
  format?: string;
  url: string;
  source?: string;
}

export interface SubtitleCue {
  start: number;
  end: number;
  text: string;
}

export type SubtitleTextSize = 'small' | 'medium' | 'large';

export const SUBTITLE_LANG_CHOICES: { code: string; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Spanish' },
  { code: 'fr', label: 'French' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'ar', label: 'Arabic' },
  { code: 'hi', label: 'Hindi' },
  { code: 'de', label: 'German' },
  { code: 'ja', label: 'Japanese' },
  { code: 'ko', label: 'Korean' },
];

export const SUBTITLE_SIZE_CHOICES: { id: SubtitleTextSize; label: string; px: number; webRem: string }[] = [
  { id: 'small', label: 'Small', px: 14, webRem: '0.95rem' },
  { id: 'medium', label: 'Medium', px: 17, webRem: '1.15rem' },
  { id: 'large', label: 'Large', px: 21, webRem: '1.4rem' },
];

interface SubtitlePrefsState {
  enabled: boolean;
  preferredLanguage: string;
  textSize: SubtitleTextSize;
  setEnabled: (enabled: boolean) => void;
  setPreferredLanguage: (lang: string) => void;
  setTextSize: (size: SubtitleTextSize) => void;
}

export const useSubtitlePrefs = create<SubtitlePrefsState>()(
  persist(
    set => ({
      enabled: true,
      preferredLanguage: 'en',
      textSize: 'medium',
      setEnabled: enabled => set({ enabled }),
      setPreferredLanguage: preferredLanguage => set({ preferredLanguage: preferredLanguage.trim() || 'en' }),
      setTextSize: textSize => set({ textSize }),
    }),
    { name: 'biralotv.subtitles.v1', storage: createJSONStorage(() => AsyncStorage) },
  ),
);

const TIMING_RE =
  /^\s*((?:\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{1,3})\s*-->\s*((?:\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{1,3})(?:\s+.*)?$/;

export function parseSubtitleTimestamp(raw: string): number | null {
  const clean = raw.trim().replace(',', '.');
  const parts = clean.split(':');
  if (parts.length !== 2 && parts.length !== 3) return null;
  let hours = 0;
  let minutes = 0;
  let secondsPart = '';
  if (parts.length === 3) {
    hours = Number(parts[0]);
    minutes = Number(parts[1]);
    secondsPart = parts[2];
  } else {
    minutes = Number(parts[0]);
    secondsPart = parts[1];
  }
  const seconds = Number(secondsPart);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || !Number.isFinite(seconds)) return null;
  return hours * 3600 + minutes * 60 + seconds;
}

function cleanCueText(raw: string): string {
  return raw
    .replace(/\{\\[^}]*\}/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?>/g, '')
    .replace(/<\/?[^>]+>/g, '')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .trim();
}

export function parseWebVTT(raw: string): SubtitleCue[] {
  const text = raw.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = text.split('\n');
  const cues: SubtitleCue[] = [];

  let i = 0;
  // Skip WEBVTT header / X-TIMESTAMP-MAP / STYLE / REGION / NOTE metadata before cues.
  while (i < lines.length) {
    const trimmed = lines[i].trim();
    if (!trimmed) {
      i++;
      continue;
    }
    if (
      /^WEBVTT/i.test(trimmed) ||
      /^X-TIMESTAMP-MAP/i.test(trimmed) ||
      /^KIND:/i.test(trimmed) ||
      /^LANGUAGE:/i.test(trimmed)
    ) {
      i++;
      continue;
    }
    break;
  }

  let skippingBlock = false;
  let currentStart: number | null = null;
  let currentEnd: number | null = null;
  let textLines: string[] = [];

  const flushCue = () => {
    if (currentStart !== null && currentEnd !== null && currentEnd > currentStart && textLines.length > 0) {
      const cleaned = cleanCueText(textLines.join('\n'));
      if (cleaned) {
        cues.push({ start: currentStart, end: currentEnd, text: cleaned });
      }
    }
    currentStart = null;
    currentEnd = null;
    textLines = [];
  };

  for (; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed === '') {
      flushCue();
      skippingBlock = false;
      continue;
    }

    if (skippingBlock) continue;

    if (currentStart === null) {
      if (/^(?:NOTE|STYLE|REGION)(?:\s|$)/i.test(trimmed)) {
        skippingBlock = true;
        continue;
      }
      const match = trimmed.match(TIMING_RE);
      if (match) {
        const s = parseSubtitleTimestamp(match[1]);
        const e = parseSubtitleTimestamp(match[2]);
        if (s !== null && e !== null && e > s) {
          currentStart = s;
          currentEnd = e;
          textLines = [];
        }
      }
      // Otherwise skip cue numeric id / named identifier preceding timing line.
      continue;
    }

    // Handle edge case where a timing line appears without a blank separator.
    const nextMatch = trimmed.match(TIMING_RE);
    if (nextMatch) {
      flushCue();
      const s = parseSubtitleTimestamp(nextMatch[1]);
      const e = parseSubtitleTimestamp(nextMatch[2]);
      if (s !== null && e !== null && e > s) {
        currentStart = s;
        currentEnd = e;
      }
      continue;
    }

    textLines.push(line);
  }
  flushCue();

  cues.sort((a, b) => a.start - b.start);
  return cues;
}

export function findActiveSubtitleText(cues: SubtitleCue[], timeSec: number, offsetSec = 0): string {
  if (cues.length === 0 || !Number.isFinite(timeSec)) return '';
  const t = timeSec - offsetSec;
  if (t < 0) return '';

  // Binary search upper bound on start <= t.
  let lo = 0;
  let hi = cues.length - 1;
  let upperIdx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid].start <= t) {
      upperIdx = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (upperIdx < 0) return '';

  const active: string[] = [];
  // Scan slightly backwards for overlapping cues (e.g. long dialogue + sign).
  const minScan = Math.max(0, upperIdx - 12);
  for (let idx = upperIdx; idx >= minScan; idx--) {
    const cue = cues[idx];
    if (t >= cue.start && t <= cue.end) {
      active.unshift(cue.text);
    }
  }
  return active.join('\n');
}

const cueCache = new Map<string, Promise<SubtitleCue[]>>();

export async function fetchSubtitleCues(url: string, signal?: AbortSignal): Promise<SubtitleCue[]> {
  if (!url) return [];
  let pending = cueCache.get(url);
  if (!pending) {
    pending = (async () => {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 15_000);
      try {
        const res = await fetch(url, { signal: ctl.signal, cache: 'no-store' });
        if (!res.ok) throw new Error(`Subtitle download failed (HTTP ${res.status})`);
        const raw = await res.text();
        const cues = parseWebVTT(raw);
        if (cueCache.size > 40) {
          const oldest = cueCache.keys().next().value;
          if (oldest) cueCache.delete(oldest);
        }
        return cues;
      } catch (err) {
        cueCache.delete(url);
        throw err;
      } finally {
        clearTimeout(timer);
      }
    })();
    cueCache.set(url, pending);
  }
  if (!signal) return pending;
  return new Promise<SubtitleCue[]>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const onAbort = () => reject(new DOMException('Aborted', 'AbortError'));
    signal.addEventListener('abort', onAbort, { once: true });
    pending
      .then(cues => {
        signal.removeEventListener('abort', onAbort);
        resolve(cues);
      })
      .catch(err => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      });
  });
}

export function pickDefaultSubtitleTrack(
  tracks: SubtitleTrackItem[],
  preferredLang: string,
): SubtitleTrackItem | null {
  if (tracks.length === 0) return null;
  const pref = preferredLang.trim().toLowerCase();
  const basePref = pref.split('-')[0];
  if (pref) {
    const exact = tracks.find(t => t.language.toLowerCase() === pref);
    if (exact) return exact;
    const baseHit = tracks.find(t => t.language.toLowerCase().split('-')[0] === basePref);
    if (baseHit) return baseHit;
  }
  const eng = tracks.find(t => t.language.toLowerCase().startsWith('en'));
  if (eng) return eng;
  return tracks[0];
}

export function mergeSubtitleLists(
  primary: SubtitleTrackItem[],
  extra: SubtitleTrackItem[],
): SubtitleTrackItem[] {
  const seenKey = new Set<string>();
  const out: SubtitleTrackItem[] = [];
  for (const t of [...primary, ...extra]) {
    if (!t?.url || !t?.id) continue;
    const key = `${t.id}|${t.url}`;
    if (seenKey.has(key)) continue;
    seenKey.add(key);
    out.push(t);
  }
  return out;
}

export function parseSubtitlesParam(raw?: string): SubtitleTrackItem[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (v): v is SubtitleTrackItem =>
        Boolean(v) &&
        typeof v === 'object' &&
        typeof v.id === 'string' &&
        typeof v.url === 'string' &&
        typeof v.label === 'string' &&
        typeof v.language === 'string',
    );
  } catch {
    return [];
  }
}

