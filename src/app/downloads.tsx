import { useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { SafeScreen } from '@/components/SafeScreen';
import {
  formatBytes,
  playDownloadedItem,
  useDownloadsStore,
} from '@/lib/downloads';
import { goBack } from '@/lib/util';
import { useTheme } from '@/theme';

export default function DownloadsScreen() {
  const { colors: c } = useTheme();
  const items = useDownloadsStore(s => s.items);
  const deleteDownload = useDownloadsStore(s => s.deleteDownload);
  const pauseDownload = useDownloadsStore(s => s.pauseDownload);
  const resumeDownload = useDownloadsStore(s => s.resumeDownload);
  const cancelDownload = useDownloadsStore(s => s.cancelDownload);

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const active = items.filter(i => i.status === 'downloading' || i.status === 'paused');
  const completed = items.filter(i => i.status === 'completed');
  const failed = items.filter(i => i.status === 'error');

  const totalBytes = completed.reduce((sum, item) => sum + (item.totalBytes || 0), 0);

  return (
    <SafeScreen bg={c.bg}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => goBack()} hitSlop={14} style={styles.backBtn}>
          <Text style={[styles.backText, { color: c.text }]}>‹</Text>
        </Pressable>
        <View style={styles.headerTitleWrap}>
          <Text style={[styles.title, { color: c.text }]}>Downloads</Text>
          {completed.length > 0 && (
            <Text style={[styles.storageText, { color: c.textMuted }]}>
              {completed.length} item{completed.length === 1 ? '' : 's'} · {formatBytes(totalBytes)} used
            </Text>
          )}
        </View>
      </View>

      {items.length === 0 ? (
        <View style={styles.emptyContainer}>
          <View style={[styles.emptyIconCircle, { backgroundColor: c.surface }]}>
            <Text style={styles.emptyIcon}>⬇️</Text>
          </View>
          <Text style={[styles.emptyTitle, { color: c.text }]}>No Downloads Yet</Text>
          <Text style={[styles.emptyDesc, { color: c.textMuted }]}>
            Download movies and TV show episodes to enjoy them offline anywhere without buffering or data usage.
          </Text>
          <TouchableOpacity
            style={[styles.browseBtn, { backgroundColor: c.accent }]}
            onPress={() => router.replace('/')}
            activeOpacity={0.85}
          >
            <Text style={styles.browseBtnText}>Explore Movies & Shows</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={[...active, ...failed, ...completed]}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => {
            const isTv = item.kind === 'tv' && item.season && item.episode;
            const subTitle = isTv
              ? `Season ${item.season} · Episode ${item.episode}`
              : `${item.quality || 'HD'} · ${formatBytes(item.totalBytes || item.downloadedBytes)}`;

            if (item.status === 'downloading' || item.status === 'paused') {
              const pct = Math.round((item.progress || 0) * 100);
              return (
                <View style={[styles.downloadCard, { backgroundColor: c.surface, borderColor: c.elevated }]}>
                  {item.poster ? (
                    <Image source={{ uri: item.poster }} style={styles.poster} contentFit="cover" />
                  ) : (
                    <View style={[styles.poster, { backgroundColor: c.elevated }]}>
                      <Text style={{ fontSize: 24 }}>🎬</Text>
                    </View>
                  )}
                  <View style={styles.cardInfo}>
                    <Text numberOfLines={1} style={[styles.itemTitle, { color: c.text }]}>
                      {item.title}
                    </Text>
                    <Text style={[styles.itemSub, { color: c.textMuted }]}>
                      {isTv ? `S${item.season} E${item.episode} · ` : ''}
                      {item.status === 'paused' ? 'Paused' : `Downloading ${pct}%`}
                    </Text>

                    {/* Progress Bar */}
                    <View style={[styles.progressTrack, { backgroundColor: c.elevated }]}>
                      <View
                        style={[
                          styles.progressBar,
                          {
                            width: `${Math.max(5, pct)}%`,
                            backgroundColor: item.status === 'paused' ? '#ff9f0a' : c.accent,
                          },
                        ]}
                      />
                    </View>

                    <Text style={[styles.bytesText, { color: c.textMuted }]}>
                      {formatBytes(item.downloadedBytes)} / {item.totalBytes > 0 ? formatBytes(item.totalBytes) : 'calculating...'}
                    </Text>
                  </View>

                  <View style={styles.actionRow}>
                    {item.status === 'downloading' ? (
                      <TouchableOpacity
                        onPress={() => pauseDownload(item.id)}
                        style={[styles.miniBtn, { backgroundColor: c.elevated }]}
                        hitSlop={8}
                      >
                        <Text style={[styles.miniBtnText, { color: c.text }]}>⏸</Text>
                      </TouchableOpacity>
                    ) : (
                      <TouchableOpacity
                        onPress={() => resumeDownload(item.id)}
                        style={[styles.miniBtn, { backgroundColor: c.accent }]}
                        hitSlop={8}
                      >
                        <Text style={[styles.miniBtnText, { color: '#fff' }]}>▶</Text>
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity
                      onPress={() => cancelDownload(item.id)}
                      style={[styles.miniBtn, { backgroundColor: c.elevated }]}
                      hitSlop={8}
                    >
                      <Text style={[styles.miniBtnText, { color: c.danger }]}>✕</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            }

            if (item.status === 'error') {
              return (
                <View style={[styles.downloadCard, { backgroundColor: c.surface, borderColor: c.danger }]}>
                  {item.poster ? (
                    <Image source={{ uri: item.poster }} style={styles.poster} contentFit="cover" />
                  ) : null}
                  <View style={styles.cardInfo}>
                    <Text numberOfLines={1} style={[styles.itemTitle, { color: c.text }]}>
                      {item.title}
                    </Text>
                    <Text style={[styles.itemSub, { color: c.danger }]}>
                      Failed: {item.error || 'Connection error'}
                    </Text>
                  </View>
                  <View style={styles.actionRow}>
                    <TouchableOpacity
                      onPress={() => resumeDownload(item.id)}
                      style={[styles.miniBtn, { backgroundColor: c.accent }]}
                      hitSlop={8}
                    >
                      <Text style={[styles.miniBtnText, { color: '#fff' }]}>🔄</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => cancelDownload(item.id)}
                      style={[styles.miniBtn, { backgroundColor: c.elevated }]}
                      hitSlop={8}
                    >
                      <Text style={[styles.miniBtnText, { color: c.danger }]}>✕</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            }

            // Completed item
            return (
              <View style={[styles.downloadCard, { backgroundColor: c.surface, borderColor: c.elevated }]}>
                {item.poster ? (
                  <Image source={{ uri: item.poster }} style={styles.poster} contentFit="cover" />
                ) : (
                  <View style={[styles.poster, { backgroundColor: c.elevated }]}>
                    <Text style={{ fontSize: 24 }}>🎬</Text>
                  </View>
                )}
                <View style={styles.cardInfo}>
                  <Text numberOfLines={1} style={[styles.itemTitle, { color: c.text }]}>
                    {item.title}
                  </Text>
                  <Text style={[styles.itemSub, { color: c.textMuted }]}>{subTitle}</Text>
                  <View style={styles.badgeRow}>
                    <View style={[styles.downloadBadge, { backgroundColor: c.accent + '22' }]}>
                      <Text style={[styles.downloadBadgeText, { color: c.accent }]}>✓ Offline Ready</Text>
                    </View>
                    {item.totalBytes > 0 && (
                      <Text style={[styles.sizeText, { color: c.textMuted }]}>
                        {formatBytes(item.totalBytes)}
                      </Text>
                    )}
                  </View>
                </View>

                <View style={styles.actionRow}>
                  <TouchableOpacity
                    onPress={() => playDownloadedItem(item)}
                    style={[styles.playBtn, { backgroundColor: c.accent }]}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.playBtnText}>▶ Play</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => setConfirmDeleteId(item.id)}
                    style={[styles.deleteBtn, { backgroundColor: c.elevated }]}
                    hitSlop={8}
                  >
                    <Text style={[styles.deleteBtnText, { color: c.danger }]}>🗑</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          }}
        />
      )}

      {/* Confirmation Modal for deletion */}
      <Modal
        visible={Boolean(confirmDeleteId)}
        transparent
        animationType="fade"
        onRequestClose={() => setConfirmDeleteId(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalBox, { backgroundColor: c.surface, borderColor: c.elevated }]}>
            <Text style={[styles.modalTitle, { color: c.text }]}>Delete Download?</Text>
            <Text style={[styles.modalDesc, { color: c.textMuted }]}>
              This will remove the downloaded video file from your device storage to free up space.
            </Text>
            <View style={styles.modalBtns}>
              <TouchableOpacity
                style={[styles.modalBtnCancel, { backgroundColor: c.elevated }]}
                onPress={() => setConfirmDeleteId(null)}
              >
                <Text style={[styles.modalBtnCancelText, { color: c.text }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtnConfirm, { backgroundColor: c.danger }]}
                onPress={() => {
                  if (confirmDeleteId) deleteDownload(confirmDeleteId);
                  setConfirmDeleteId(null);
                }}
              >
                <Text style={styles.modalBtnConfirmText}>Delete</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  backBtn: {
    paddingRight: 6,
    paddingVertical: 2,
  },
  backText: {
    fontSize: 32,
    lineHeight: 32,
    fontWeight: '300',
  },
  headerTitleWrap: {
    flex: 1,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
  },
  storageText: {
    fontSize: 12,
    marginTop: 2,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  emptyIconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  emptyIcon: {
    fontSize: 36,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 8,
  },
  emptyDesc: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
  },
  browseBtn: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 24,
  },
  browseBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
  },
  listContent: {
    padding: 16,
    gap: 12,
  },
  downloadCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    gap: 12,
  },
  poster: {
    width: 60,
    height: 90,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardInfo: {
    flex: 1,
  },
  itemTitle: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 4,
  },
  itemSub: {
    fontSize: 12,
    marginBottom: 6,
  },
  progressTrack: {
    height: 5,
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: 4,
  },
  progressBar: {
    height: '100%',
    borderRadius: 3,
  },
  bytesText: {
    fontSize: 11,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  downloadBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  downloadBadgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  sizeText: {
    fontSize: 11,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  miniBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniBtnText: {
    fontSize: 14,
    fontWeight: '700',
  },
  playBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 18,
  },
  playBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 13,
  },
  deleteBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteBtnText: {
    fontSize: 16,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  modalBox: {
    width: '100%',
    maxWidth: 380,
    padding: 20,
    borderRadius: 16,
    borderWidth: 1,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 8,
  },
  modalDesc: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 20,
  },
  modalBtns: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
  },
  modalBtnCancel: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
  },
  modalBtnCancelText: {
    fontWeight: '600',
    fontSize: 14,
  },
  modalBtnConfirm: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
  },
  modalBtnConfirmText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
});
