import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';

import { getErrorMessage } from '@/lib/errors';
import { countByStatus, deleteOperation, listOperations, requeueOperation } from '@/lib/sync/queue';
import { syncPendingOperations } from '@/lib/sync/sync';
import type { OperationStatus, QueuedOperation } from '@/lib/sync/types';

/** Une opération bloquée ne repartira jamais seule : sans action, le scan est perdu. */
const BLOCKED_STATUSES: OperationStatus[] = ['CONFLICT', 'REJECTED'];

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
  // Un renvoi crée une opération neuve : deux appuis rapides créeraient deux réceptions
  // en base pour une seule palette. C'est le seul chemin qui contourne l'idempotence.
  const inFlight = useRef(new Set<string>());
  const [busy, setBusy] = useState<string[]>([]);

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

  const runExclusively = async (clientOpId: string, action: () => Promise<void>) => {
    // La garde vit dans une ref, pas dans l'état : `setBusy` est asynchrone, et deux appuis
    // dans le même tick liraient tous deux une liste vide — donc deux réceptions en base.
    if (inFlight.current.has(clientOpId)) return;
    inFlight.current.add(clientOpId);
    setBusy((current) => [...current, clientOpId]);

    try {
      await action();
    } finally {
      inFlight.current.delete(clientOpId);
      setBusy((current) => current.filter((id) => id !== clientOpId));
    }
  };

  const requeue = (operation: QueuedOperation) =>
    runExclusively(operation.clientOpId, async () => {
      try {
        await requeueOperation(operation.clientOpId);
        Toast.show({
          type: 'success',
          text1: 'Opération remise en file',
          text2:
            operation.status === 'REJECTED'
              ? 'Elle sera de nouveau rejetée si la donnée en cause n’a pas été corrigée.'
              : 'Elle repartira à la prochaine synchronisation.',
        });
        await refresh();
        syncPendingOperations().catch(() => undefined);
      } catch (error: unknown) {
        Toast.show({ type: 'error', text1: 'Renvoi impossible', text2: getErrorMessage(error) });
      }
    });

  const confirmRequeue = (operation: QueuedOperation) => {
    // Renvoyer écrit dans le registre de traçabilité : c'est l'action risquée, pas la
    // suppression (un scan supprimé peut être refait ; une réception en double, non).
    Alert.alert(
      'Renvoyer cette opération ?',
      'Elle sera transmise comme une nouvelle réception.',
      [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Renvoyer', onPress: () => requeue(operation) },
      ]
    );
  };

  const confirmDelete = (clientOpId: string) => {
    Alert.alert('Supprimer cette opération ?', 'Le scan sera définitivement abandonné.', [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Supprimer',
        style: 'destructive',
        onPress: () =>
          runExclusively(clientOpId, async () => {
            try {
              await deleteOperation(clientOpId);
              await refresh();
            } catch (error: unknown) {
              // Sans ce message, l'opérateur croirait le scan supprimé alors qu'il est resté.
              Toast.show({
                type: 'error',
                text1: 'Suppression impossible',
                text2: getErrorMessage(error),
              });
            }
          }),
      },
    ]);
  };

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
          const isBlocked = BLOCKED_STATUSES.includes(item.status);
          const isBusy = busy.includes(item.clientOpId);

          return (
            <View style={styles.row}>
              <View style={styles.rowHeader}>
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

              {/* Sans le motif, « Rejeté » n'apprend rien : l'opérateur ne peut ni corriger
                  la cause, ni décider s'il vaut la peine de renvoyer. */}
              {isBlocked && item.error && <Text style={styles.reason}>{item.error}</Text>}

              {isBlocked && (
                <View style={styles.actions}>
                  <TouchableOpacity
                    style={[styles.action, isBusy && styles.actionDisabled]}
                    onPress={() => confirmRequeue(item)}
                    disabled={isBusy}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="refresh-outline" size={15} color="#0D9488" />
                    <Text style={styles.actionText}>Renvoyer</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.action, isBusy && styles.actionDisabled]}
                    onPress={() => confirmDelete(item.clientOpId)}
                    disabled={isBusy}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="trash-outline" size={15} color="#B91C1C" />
                    <Text style={[styles.actionText, styles.actionTextDanger]}>Supprimer</Text>
                  </TouchableOpacity>
                </View>
              )}
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
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#F3F4F6',
    gap: 12,
  },
  rowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rowMain: { flex: 1, gap: 2 },
  actions: {
    flexDirection: 'row',
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
    paddingTop: 10,
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#F9FAFB',
  },
  reason: {
    fontSize: 12,
    color: '#B91C1C',
    backgroundColor: '#FEF2F2',
    padding: 8,
    borderRadius: 8,
  },
  actionDisabled: { opacity: 0.4 },
  actionText: { fontSize: 13, fontWeight: '600', color: '#0D9488' },
  actionTextDanger: { color: '#B91C1C' },
  rowTitle: { fontSize: 14, fontWeight: '600', color: '#111827' },
  rowSubtitle: { fontSize: 12, color: '#6B7280' },
  badge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  badgeText: { fontSize: 11, fontWeight: '700' },
});
