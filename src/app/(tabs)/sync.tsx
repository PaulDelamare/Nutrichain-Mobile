import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';

import { countByStatus, listOperations } from '@/lib/sync/queue';
import { syncPendingOperations } from '@/lib/sync/sync';
import type { OperationStatus, QueuedOperation } from '@/lib/sync/types';

const STATUS_STYLE: Record<OperationStatus, { label: string; color: string; background: string }> = {
  PENDING: { label: 'En attente', color: '#B45309', background: '#FEF3C7' },
  SYNCED: { label: 'Synchronisé', color: '#047857', background: '#D1FAE5' },
  CONFLICT: { label: 'Conflit', color: '#B91C1C', background: '#FEE2E2' },
  REJECTED: { label: 'Rejeté', color: '#B91C1C', background: '#FEE2E2' },
};

export default function SyncScreen() {
  const insets = useSafeAreaInsets();
  const [operations, setOperations] = useState<QueuedOperation[]>([]);
  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);

  const refresh = useCallback(async () => {
    const [counts, list] = await Promise.all([countByStatus(), listOperations()]);
    setPending(counts.PENDING);
    setOperations(list);
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  const handleSync = async () => {
    setSyncing(true);
    try {
      const summary = await syncPendingOperations();
      const blocked = summary.rejected + summary.conflicts;

      Toast.show({
        type: blocked > 0 ? 'error' : 'success',
        text1:
          blocked > 0
            ? `${blocked} opération(s) bloquée(s)`
            : `${summary.synced} opération(s) synchronisée(s)`,
        text2:
          summary.retried > 0 ? `${summary.retried} en attente de nouvelle tentative.` : undefined,
      });
    } finally {
      setSyncing(false);
      await refresh();
    }
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 16 }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Synchronisation</Text>
        <Text style={styles.subtitle}>
          {pending === 0 ? 'Tout est synchronisé.' : `${pending} opération(s) en attente d'envoi.`}
        </Text>
      </View>

      <TouchableOpacity
        style={[styles.syncButton, (syncing || pending === 0) && styles.syncButtonDisabled]}
        onPress={handleSync}
        disabled={syncing || pending === 0}
        activeOpacity={0.85}
      >
        {syncing ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <>
            <Ionicons name="cloud-upload-outline" size={18} color="#fff" />
            <Text style={styles.syncButtonText}>Synchroniser maintenant</Text>
          </>
        )}
      </TouchableOpacity>

      <FlatList
        data={operations}
        keyExtractor={(operation) => operation.clientOpId}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <Text style={styles.empty}>Aucune opération enregistrée pour le moment.</Text>
        }
        renderItem={({ item }) => {
          const style = STATUS_STYLE[item.status];
          return (
            <View style={styles.row}>
              <View style={styles.rowMain}>
                <Text style={styles.rowTitle}>Réception · {item.payload.shipment_id}</Text>
                <Text style={styles.rowSubtitle}>
                  {item.payload.quantite_actuelle} {item.payload.unite_code}
                  {item.attempts > 0 ? ` · ${item.attempts} tentative(s)` : ''}
                </Text>
              </View>
              <View style={[styles.badge, { backgroundColor: style.background }]}>
                <Text style={[styles.badgeText, { color: style.color }]}>{style.label}</Text>
              </View>
            </View>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F9FAFB', paddingHorizontal: 20 },
  header: { gap: 4, marginBottom: 20 },
  title: { fontSize: 22, fontWeight: '700', color: '#111827' },
  subtitle: { fontSize: 14, color: '#6B7280' },
  syncButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#0D9488',
    borderRadius: 12,
    paddingVertical: 15,
  },
  syncButtonDisabled: { backgroundColor: '#9CA3AF' },
  syncButtonText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  list: { paddingVertical: 20, gap: 10 },
  empty: { textAlign: 'center', color: '#9CA3AF', marginTop: 32 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#F3F4F6',
  },
  rowMain: { flex: 1, gap: 2 },
  rowTitle: { fontSize: 14, fontWeight: '600', color: '#111827' },
  rowSubtitle: { fontSize: 12, color: '#6B7280' },
  badge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  badgeText: { fontSize: 11, fontWeight: '700' },
});
