import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { openPlayer } from './util';

export type DownloadStatus = 'idle' | 'downloading' | 'paused' | 'completed' | 'error';

export interface DownloadItem {
  id: string; // Unique ID, e.g. "scraper:movie:550" or "scraper:tv:1399:1:1"
  mediaId: string;
  title: string;
  kind: 'movie' | 'tv' | 'archive';
  tmdbId?: number;
  season?: number;
  episode?: number;
  poster?: string;
  backdrop?: string;
  quality?: string;
  streamUrl: string;
  fileUri?: string; // local file:/// path on Android, or blob/local link on Desktop
  fileName: string;
  totalBytes: number;
  downloadedBytes: number;
  progress: number; // 0.0 to 1.0
  status: DownloadStatus;
  error?: string;
  createdAt: number;
  completedAt?: number;
  subtitlesUrl?: string;
  localSubtitlesUri?: string;
}

export type DownloadRequest = {
  id: string;
  title: string;
  kind: 'movie' | 'tv' | 'archive';
  tmdbId?: number;
  season?: number;
  episode?: number;
  poster?: string;
  backdrop?: string;
  streamUrl: string;
  quality?: string;
  subtitlesUrl?: string;
};

interface DownloadsStoreState {
  items: DownloadItem[];
  addDownload: (req: DownloadRequest) => Promise<void>;
  pauseDownload: (id: string) => Promise<void>;
  resumeDownload: (id: string) => Promise<void>;
  cancelDownload: (id: string) => Promise<void>;
  deleteDownload: (id: string) => Promise<void>;
  getItem: (id: string) => DownloadItem | undefined;
  isDownloaded: (id: string) => boolean;
  isDownloading: (id: string) => boolean;
  clearCompleted: () => Promise<void>;
}

// Active tasks in memory (for pause / resume / cancel)
type ActiveTask = {
  cancel: () => void;
  pause?: () => Promise<void>;
  resume?: () => Promise<void>;
};
const activeTasks = new Map<string, ActiveTask>();

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
}

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const size = bytes / Math.pow(1024, i);
  return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export const useDownloadsStore = create<DownloadsStoreState>()(
  persist(
    (set, get) => ({
      items: [],

      addDownload: async (req: DownloadRequest) => {
        const existing = get().items.find(i => i.id === req.id);
        if (existing && existing.status === 'completed') return;

        const isTv = req.kind === 'tv' && req.season && req.episode;
        const stem = isTv
          ? `${req.title}_S${req.season}E${req.episode}`
          : req.title;
        const safeStem = sanitizeFileName(stem);
        const fileName = `${safeStem}.mp4`;

        const newItem: DownloadItem = {
          id: req.id,
          mediaId: req.id,
          title: req.title,
          kind: req.kind,
          tmdbId: req.tmdbId,
          season: req.season,
          episode: req.episode,
          poster: req.poster,
          backdrop: req.backdrop,
          quality: req.quality || 'HD',
          streamUrl: req.streamUrl,
          fileName,
          totalBytes: 0,
          downloadedBytes: 0,
          progress: 0,
          status: 'downloading',
          createdAt: Date.now(),
          subtitlesUrl: req.subtitlesUrl,
        };

        set(state => ({
          items: [newItem, ...state.items.filter(i => i.id !== req.id)],
        }));

        // Execute download depending on platform
        void executeDownload(newItem, set, get);
      },

      pauseDownload: async (id: string) => {
        const task = activeTasks.get(id);
        if (task?.pause) {
          await task.pause();
        } else if (task) {
          task.cancel();
          activeTasks.delete(id);
        }
        set(state => ({
          items: state.items.map(item =>
            item.id === id ? { ...item, status: 'paused' } : item,
          ),
        }));
      },

      resumeDownload: async (id: string) => {
        const item = get().items.find(i => i.id === id);
        if (!item) return;
        const task = activeTasks.get(id);
        if (task?.resume) {
          await task.resume();
          set(state => ({
            items: state.items.map(i =>
              i.id === id ? { ...i, status: 'downloading', error: undefined } : i,
            ),
          }));
        } else {
          set(state => ({
            items: state.items.map(i =>
              i.id === id ? { ...i, status: 'downloading', error: undefined } : i,
            ),
          }));
          void executeDownload(item, set, get);
        }
      },

      cancelDownload: async (id: string) => {
        const task = activeTasks.get(id);
        if (task) {
          task.cancel();
          activeTasks.delete(id);
        }
        const item = get().items.find(i => i.id === id);
        if (item?.fileUri && Platform.OS === 'android') {
          try {
            const FileSystem = await import('expo-file-system/legacy');
            await FileSystem.deleteAsync(item.fileUri, { idempotent: true });
          } catch {}
        }
        set(state => ({
          items: state.items.filter(i => i.id !== id),
        }));
      },

      deleteDownload: async (id: string) => {
        const task = activeTasks.get(id);
        if (task) {
          task.cancel();
          activeTasks.delete(id);
        }
        const item = get().items.find(i => i.id === id);
        if (item?.fileUri && Platform.OS === 'android') {
          try {
            const FileSystem = await import('expo-file-system/legacy');
            await FileSystem.deleteAsync(item.fileUri, { idempotent: true });
            if (item.localSubtitlesUri) {
              await FileSystem.deleteAsync(item.localSubtitlesUri, { idempotent: true });
            }
          } catch {}
        }
        set(state => ({
          items: state.items.filter(i => i.id !== id),
        }));
      },

      getItem: (id: string) => get().items.find(i => i.id === id),

      isDownloaded: (id: string) => {
        const item = get().items.find(i => i.id === id);
        return item?.status === 'completed';
      },

      isDownloading: (id: string) => {
        const item = get().items.find(i => i.id === id);
        return item?.status === 'downloading';
      },

      clearCompleted: async () => {
        const completed = get().items.filter(i => i.status === 'completed');
        for (const item of completed) {
          if (item.fileUri && Platform.OS === 'android') {
            try {
              const FileSystem = await import('expo-file-system/legacy');
              await FileSystem.deleteAsync(item.fileUri, { idempotent: true });
            } catch {}
          }
        }
        set(state => ({
          items: state.items.filter(i => i.status !== 'completed'),
        }));
      },
    }),
    {
      name: 'biralotv.downloads.v1',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);

// Worker that runs download
async function executeDownload(
  item: DownloadItem,
  set: (fn: (state: DownloadsStoreState) => DownloadsStoreState | Partial<DownloadsStoreState>) => void,
  get: () => DownloadsStoreState,
) {
  if (Platform.OS === 'android') {
    await executeAndroidDownload(item, set, get);
  } else {
    await executeDesktopDownload(item, set, get);
  }
}

// Android implementation using expo-file-system/legacy
async function executeAndroidDownload(
  item: DownloadItem,
  set: (fn: (state: DownloadsStoreState) => DownloadsStoreState | Partial<DownloadsStoreState>) => void,
  get: () => DownloadsStoreState,
) {
  try {
    const FileSystem = await import('expo-file-system/legacy');
    const docDir = FileSystem.documentDirectory;
    if (!docDir) {
      throw new Error('Device documentDirectory is unavailable.');
    }

    const downloadDir = `${docDir}downloads/`;
    const dirInfo = await FileSystem.getInfoAsync(downloadDir);
    if (!dirInfo.exists) {
      await FileSystem.makeDirectoryAsync(downloadDir, { intermediates: true });
    }

    const targetUri = `${downloadDir}${item.fileName}`;
    let cancelled = false;

    // Direct download with resumable
    const downloadResumable = FileSystem.createDownloadResumable(
      item.streamUrl,
      targetUri,
      {},
      progressData => {
        if (cancelled) return;
        const total = progressData.totalBytesExpectedToWrite;
        const loaded = progressData.totalBytesWritten;
        const pct = total > 0 ? Math.min(1, Math.max(0, loaded / total)) : 0;
        set(state => ({
          items: state.items.map(i =>
            i.id === item.id
              ? {
                  ...i,
                  downloadedBytes: loaded,
                  totalBytes: total > 0 ? total : i.totalBytes,
                  progress: pct,
                }
              : i,
          ),
        }));
      },
    );

    activeTasks.set(item.id, {
      cancel: () => {
        cancelled = true;
        void downloadResumable.cancelAsync?.().catch(() => {});
      },
      pause: async () => {
        cancelled = true;
        await downloadResumable.pauseAsync();
      },
      resume: async () => {
        cancelled = false;
        await downloadResumable.resumeAsync();
      },
    });

    const result = await downloadResumable.downloadAsync();
    activeTasks.delete(item.id);

    if (cancelled) return;

    if (result && result.uri) {
      const finalInfo = await FileSystem.getInfoAsync(result.uri);
      const totalBytes = (finalInfo.exists && typeof finalInfo.size === 'number') ? finalInfo.size : item.totalBytes;

      // Also download subtitle if available
      let localSubUri: string | undefined;
      if (item.subtitlesUrl) {
        try {
          const subTarget = `${downloadDir}${item.fileName.replace(/\.[a-z0-9]+$/i, '')}.vtt`;
          const subRes = await FileSystem.downloadAsync(item.subtitlesUrl, subTarget);
          if (subRes.uri) localSubUri = subRes.uri;
        } catch {}
      }

      set(state => ({
        items: state.items.map(i =>
          i.id === item.id
            ? {
                ...i,
                status: 'completed',
                fileUri: result.uri,
                localSubtitlesUri: localSubUri,
                totalBytes,
                downloadedBytes: totalBytes,
                progress: 1,
                completedAt: Date.now(),
              }
            : i,
        ),
      }));
    } else {
      throw new Error('Download did not complete.');
    }
  } catch (err: unknown) {
    activeTasks.delete(item.id);
    const msg = err instanceof Error ? err.message : 'Download failed';
    set(state => ({
      items: state.items.map(i =>
        i.id === item.id ? { ...i, status: 'error', error: msg } : i,
      ),
    }));
  }
}

// Desktop / Web implementation
async function executeDesktopDownload(
  item: DownloadItem,
  set: (fn: (state: DownloadsStoreState) => DownloadsStoreState | Partial<DownloadsStoreState>) => void,
  get: () => DownloadsStoreState,
) {
  try {
    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      // Create hidden anchor element to trigger browser or Electron native download
      const a = document.createElement('a');
      a.href = item.streamUrl;
      a.download = item.fileName;
      a.target = '_blank';
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        try {
          document.body.removeChild(a);
        } catch {}
      }, 2000);

      // On desktop, mark as completed in library history
      set(state => ({
        items: state.items.map(i =>
          i.id === item.id
            ? {
                ...i,
                status: 'completed',
                progress: 1,
                fileUri: item.streamUrl,
                completedAt: Date.now(),
              }
            : i,
        ),
      }));
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Desktop download failed';
    set(state => ({
      items: state.items.map(i =>
        i.id === item.id ? { ...i, status: 'error', error: msg } : i,
      ),
    }));
  }
}

/** Play a downloaded movie or episode offline directly */
export function playDownloadedItem(item: DownloadItem) {
  const playbackUri = item.fileUri || item.streamUrl;
  const isTv = item.kind === 'tv' && item.season && item.episode;
  const displayName = isTv
    ? `${item.title} · S${item.season} E${item.episode}`
    : item.title;

  openPlayer({
    id: item.id,
    name: displayName,
    stream: playbackUri,
    source: 'download',
    logo: item.poster || '',
    hls: playbackUri.endsWith('.m3u8'),
    fresh: true,
  });
}
