import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';

import { ConfirmDialog } from '@/components/confirm-dialog';
import { useOnlineStatus } from '@/hooks/use-online-status';
import { toastError } from '@/lib/toast';
import {
  countByStatus,
  countForeignPending,
  deleteOperation,
  listOperations,
  requeueOperation,
} from '@/lib/sync/queue';
import { formatRelativeFr, syncedPercent } from '@/lib/sync/summary';
import { syncPendingOperations } from '@/lib/sync/sync';
import { isBlocked, type OperationStatus, type QueuedOperation } from '@/lib/sync/types';

import { BRAND } from '@/lib/theme';

/** Une décision en attente de confirmation : ce qu'on affiche, et ce qu'on fera si on confirme. */
interface PendingConfirmation {
  title: string;
  message: string;
  confirmLabel: string;
  destructive?: boolean;
  run: () => void;
}

const EMPTY_COUNTS: Record<OperationStatus, number> = {
  PENDING: 0,
  SYNCED: 0,
  CONFLICT: 0,
  REJECTED: 0,
};

const STATUS_STYLE: Record<OperationStatus, { label: string; color: string; background: string }> = {
  PENDING: { label: 'En attente', color: '#B45309', background: '#FEF3C7' },
  SYNCED: { label: 'Synchronisé', color: '#047857', background: '#D1FAE5' },
  CONFLICT: { label: 'Conflit', color: '#B91C1C', background: '#FEE2E2' },
  REJECTED: { label: 'Rejeté', color: '#B91C1C', background: '#FEE2E2' },
};

export default function SyncScreen() {
  const insets = useSafeAreaInsets();
  const online = useOnlineStatus();
  const [operations, setOperations] = useState<QueuedOperation[]>([]);
  const [counts, setCounts] = useState<Record<OperationStatus, number>>(EMPTY_COUNTS);
  const [syncing, setSyncing] = useState(false);
  // Horodatage de référence pour l'âge relatif des opérations. Posé lors du rafraîchissement
  // (contexte effet), jamais en plein render : `Date.now()` y est une impureté (React Compiler).
  const [now, setNow] = useState(0);
  // Un renvoi crée une opération neuve : deux appuis rapides créeraient deux réceptions
  // en base pour une seule palette. C'est le seul chemin qui contourne l'idempotence.
  const inFlight = useRef(new Set<string>());
  const [busy, setBusy] = useState<string[]>([]);

  const [foreign, setForeign] = useState(0);
  /** La file n'a pas pu être lue : son contenu est INCONNU — ce n'est pas « elle est vide ». */
  const [unreadable, setUnreadable] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [nextCounts, list, nextForeign] = await Promise.all([
        countByStatus(),
        listOperations(),
        countForeignPending(),
      ]);
      setCounts(nextCounts);
      setOperations(list);
      setForeign(nextForeign);
      setNow(Date.now());
      setUnreadable(false);
    } catch (error: unknown) {
      setUnreadable(true);
      // Sans ce `catch`, une base illisible laissait l'écran sur sa liste VIDE — donc sur
      // « Aucune opération en file. Tout est synchronisé. » Le pire message possible.
      toastError('Impossible de lire la file', error);
    }
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
        toastError('Renvoi impossible', error);
      }
    });

  // ⚠️ PAS `Alert.alert` : c'est un no-op littéral sur le web (corps de méthode vide), et la démo se
  // fait dans un navigateur. Ces deux boutons y étaient MORTS — on cliquait, il ne se passait rien.
  const [confirmation, setConfirmation] = useState<PendingConfirmation | null>(null);

  // Renvoyer écrit dans le registre de traçabilité : c'est l'action risquée, pas la suppression
  // (un scan supprimé peut être refait ; une réception en double, non).
  const confirmRequeue = (operation: QueuedOperation) =>
    setConfirmation({
      title: 'Renvoyer cette opération ?',
      message: 'Elle sera transmise comme une nouvelle réception.',
      confirmLabel: 'Renvoyer',
      run: () => requeue(operation),
    });

  const confirmDelete = (clientOpId: string) =>
    setConfirmation({
      title: 'Supprimer cette opération ?',
      message: 'Le scan sera définitivement abandonné.',
      confirmLabel: 'Supprimer',
      destructive: true,
      run: () =>
        runExclusively(clientOpId, async () => {
          try {
            await deleteOperation(clientOpId);
            await refresh();
          } catch (error: unknown) {
            // Sans ce message, l'opérateur croirait le scan supprimé alors qu'il est resté.
            toastError('Suppression impossible', error);
          }
        }),
    });

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
    } catch (error: unknown) {
      // ⚠️ Il n'y avait AUCUN `catch` ici. Tout ce que la synchro peut jeter — base illisible,
      // verdict serveur inconnu (`outcome.ts` jette volontairement) — donnait un spinner qui
      // tourne, s'arrête, et RIEN. La file restait « en attente », et l'opérateur repartait en
      // croyant que ça finirait par passer. Le jour où l'API ajoute un verdict, le mobile cesse
      // de synchroniser pour toujours, sans un mot.
      toastError('Synchronisation impossible', error);
    } finally {
      setSyncing(false);
      await refresh();
    }
  };

  const pending = counts.PENDING;
  const percent = syncedPercent(counts);

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 16 }]}>
      <Text style={styles.title}>Synchronisation</Text>

      <FlatList
        data={operations}
        keyExtractor={(operation) => operation.clientOpId}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <>
            {/* ── Carte résumé : réseau + file + progression ─────────── */}
            <View style={styles.summaryCard}>
              <View style={styles.summaryTop}>
                <View>
                  <Text style={styles.summaryLabel}>ÉTAT RÉSEAU</Text>
                  <Text style={[styles.networkValue, { color: online ? BRAND.primary : '#B45309' }]}>
                    {online ? 'En ligne' : 'Hors ligne'}
                  </Text>
                </View>
                <View style={styles.summaryRight}>
                  <Text style={styles.summaryLabel}>FILE D’ATTENTE</Text>
                  <Text style={[styles.queueValue, pending > 0 && styles.queueValueActive]}>
                    {pending}
                  </Text>
                </View>
              </View>

              <View style={styles.ring}>
                <Text style={styles.ringPercent}>{percent}%</Text>
                <Text style={styles.ringLabel}>synchronisé</Text>
              </View>
            </View>

            {/* Sans cette ligne, l'écran affirme « tout est synchronisé » alors que des réceptions
                d'un autre opérateur dorment en base — l'app dirait le contraire de la vérité. On
                ne montre rien de leur contenu : seulement qu'elles existent, et qui peut les
                envoyer. */}
            {foreign > 0 && (
              <Text style={styles.foreign}>
                {foreign} scan{foreign > 1 ? 's' : ''} d&apos;un autre opérateur {foreign > 1 ? 'attendent' : 'attend'}{' '}
                sur ce téléphone : lui seul peut {foreign > 1 ? 'les' : 'l’'}envoyer, en se connectant.
              </Text>
            )}

            <Text style={styles.sectionLabel}>ÉVÉNEMENTS (EPCIS)</Text>
          </>
        }
        ListEmptyComponent={
          // ⚠️ Une liste vide ne veut pas dire « tout va bien » : elle peut aussi vouloir dire
          // « je n'ai pas pu lire la base ». Les deux ne doivent pas porter le même message.
          unreadable ? (
            <Text style={styles.emptyError}>
              Impossible de lire la file — son contenu est inconnu.{'\n'}Ne considérez rien comme
              synchronisé.
            </Text>
          ) : (
            <Text style={styles.empty}>Aucune opération en file. Tout est synchronisé.</Text>
          )
        }
        renderItem={({ item }) => {
          const style = STATUS_STYLE[item.status];
          const blocked = isBlocked(item.status);
          const isBusy = busy.includes(item.clientOpId);
          const age = formatRelativeFr(item.createdAt, now);

          return (
            <View style={styles.row}>
              <View style={styles.rowHeader}>
                <View style={styles.rowMain}>
                  <Text style={styles.rowTitle}>
                    {item.payload ? `Réception · ${item.payload.shipment_id}` : 'Scan illisible'}
                  </Text>
                  <Text style={styles.rowSubtitle}>
                    ObjectEvent{age ? ` · ${age}` : ''}
                    {item.attempts > 0 ? ` · ${item.attempts} tentative(s)` : ''}
                  </Text>
                </View>
                <View style={[styles.badge, { backgroundColor: style.background }]}>
                  <Text style={[styles.badgeText, { color: style.color }]}>{style.label}</Text>
                </View>
              </View>

              {/* Sans le motif, « Rejeté » n'apprend rien : l'opérateur ne peut ni corriger
                  la cause, ni décider s'il vaut la peine de renvoyer. */}
              {blocked && item.error && <Text style={styles.reason}>{item.error}</Text>}

              {blocked && (
                <View style={styles.actions}>
                  {/* Un scan orphelin ne se renvoie pas : le renvoyer le graverait dans la chaîne
                      d'audit au nom de celui qui appuie. Proposer le bouton serait promettre une
                      action que la file refuse — et laisser croire qu'on peut signer pour un
                      autre. Il reste supprimable, une fois lu. */}
                  {/* Un scan illisible ne se renvoie pas non plus : on ne sait plus ce qu'il
                      contenait. Le bouton promettrait une action impossible. */}
                  {!item.orphan && !item.corrupted && (
                    <TouchableOpacity
                      style={[styles.action, isBusy && styles.actionDisabled]}
                      onPress={() => confirmRequeue(item)}
                      disabled={isBusy}
                      activeOpacity={0.7}
                    >
                      <Ionicons name="refresh-outline" size={15} color={BRAND.primary} />
                      <Text style={styles.actionText}>Renvoyer</Text>
                    </TouchableOpacity>
                  )}

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

      {/* ── Bouton de synchronisation (fixe en bas, au-dessus des onglets) ─── */}
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

      <ConfirmDialog
        visible={confirmation !== null}
        title={confirmation?.title ?? ''}
        message={confirmation?.message ?? ''}
        confirmLabel={confirmation?.confirmLabel ?? ''}
        destructive={confirmation?.destructive}
        onCancel={() => setConfirmation(null)}
        onConfirm={() => {
          // La confirmation se ferme AVANT l'action : sinon un double appui la relancerait.
          const decision = confirmation;
          setConfirmation(null);
          decision?.run();
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F3F4F6', paddingHorizontal: 20 },
  title: { fontSize: 22, fontWeight: '700', color: '#111827', marginBottom: 16 },

  /* ── Carte résumé ────────────────────────────────────────── */
  summaryCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 3,
  },
  summaryTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  summaryRight: { alignItems: 'flex-end' },
  summaryLabel: { fontSize: 10, fontWeight: '600', color: '#9CA3AF', letterSpacing: 0.6 },
  networkValue: { fontSize: 18, fontWeight: '700', marginTop: 4 },
  queueValue: { fontSize: 18, fontWeight: '700', color: '#6B7280', marginTop: 4 },
  queueValueActive: { color: '#B45309' },
  ring: {
    alignSelf: 'center',
    width: 132,
    height: 132,
    borderRadius: 66,
    borderWidth: 8,
    borderColor: '#CCFBF1',
    backgroundColor: '#F0FDFA',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 18,
  },
  ringPercent: { fontSize: 30, fontWeight: '800', color: BRAND.primary },
  ringLabel: { fontSize: 12, color: '#6B7280', marginTop: 2 },

  /* ── Liste ───────────────────────────────────────────────── */
  sectionLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#6B7280',
    letterSpacing: 0.8,
    marginBottom: 12,
  },
  list: { paddingTop: 4, paddingBottom: 20 },
  empty: { textAlign: 'center', color: '#9CA3AF', marginTop: 24 },
  emptyError: {
    textAlign: 'center',
    color: '#B45309',
    fontWeight: '600',
    lineHeight: 20,
    marginTop: 24,
  },
  foreign: {
    backgroundColor: '#FEF3C7',
    color: '#92400E',
    fontSize: 12,
    lineHeight: 17,
    padding: 12,
    borderRadius: 10,
    marginBottom: 12,
  },
  row: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#F3F4F6',
    gap: 12,
    marginBottom: 10,
  },
  rowHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowMain: { flex: 1, gap: 2 },
  rowTitle: { fontSize: 14, fontWeight: '600', color: '#111827' },
  rowSubtitle: { fontSize: 12, color: '#6B7280' },
  badge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  badgeText: { fontSize: 11, fontWeight: '700' },
  reason: { fontSize: 12, color: '#B91C1C', backgroundColor: '#FEF2F2', padding: 8, borderRadius: 8 },
  actions: { flexDirection: 'row', gap: 8, borderTopWidth: 1, borderTopColor: '#F3F4F6', paddingTop: 10 },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#F9FAFB',
  },
  actionDisabled: { opacity: 0.4 },
  actionText: { fontSize: 13, fontWeight: '600', color: BRAND.primary },
  actionTextDanger: { color: '#B91C1C' },

  /* ── Bouton sync ─────────────────────────────────────────── */
  syncButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: BRAND.primary,
    borderRadius: 12,
    paddingVertical: 16,
    marginTop: 8,
    marginBottom: 12,
  },
  syncButtonDisabled: { backgroundColor: '#9CA3AF' },
  syncButtonText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
