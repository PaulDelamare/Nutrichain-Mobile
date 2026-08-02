import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';

import { ConfirmDialog } from '@/components/confirm-dialog';
import { ShelfWithdrawals } from '@/components/shelf-withdrawals';
import { useCurrentUser } from '@/hooks/use-current-user';
import { useOnlineStatus } from '@/hooks/use-online-status';
import { loadBatch, type BatchDetail, type BatchDetailResult } from '@/lib/batches';
import { recallBlockedReason } from '@/lib/roles';
import { REASON_MAX_LENGTH, recallReasonError, triggerRecall } from '@/lib/traceability';
import { toastError } from '@/lib/toast';

import { BRAND } from '@/lib/theme';

// Statut de lot → libellé + couleur. Miroir EXACT de `BATCH_STATUSES` côté API : les 7 statuts
// réels (`EN_STOCK`/`EN_PRODUCTION`/`EN_ATTENTE_QC`/`BLOQUE`/`ALERTE`/`EXPEDIE`/`EPUISE`). Avant,
// `EXPEDIE`/`EPUISE`/`EN_PRODUCTION` s'affichaient en code brut gris, et un `CONSOMME` qui n'existe
// pas côté serveur traînait ici.
const STATUT_STYLE: Record<string, { label: string; color: string; bg: string }> = {
  EN_STOCK: { label: 'En stock', color: '#047857', bg: '#D1FAE5' },
  EN_PRODUCTION: { label: 'En transformation', color: '#7C3AED', bg: '#F5F3FF' },
  EN_ATTENTE_QC: { label: 'En attente de contrôle', color: '#3730A3', bg: '#E0E7FF' },
  BLOQUE: { label: 'En quarantaine', color: '#B91C1C', bg: '#FEE2E2' },
  ALERTE: { label: 'Sous rappel', color: '#B91C1C', bg: '#FEE2E2' },
  EXPEDIE: { label: 'Expédié', color: '#0891B2', bg: '#ECFEFF' },
  EPUISE: { label: 'Épuisé', color: '#6B7280', bg: '#F3F4F6' },
};

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

/** « 3 expéditions déjà parties » n'est pas un détail : ce sont les clients à prévenir. */
function shipmentsNote(count: number): string {
  if (count === 0) {
    return 'Aucune expédition déjà partie n’est concernée.';
  }
  return `${count} expédition(s) déjà partie(s) : les clients sont à prévenir.`;
}

/**
 * (issues #77 / #89) Les deux actions de traçabilité de la fiche.
 *
 * La généalogie est ouverte à TOUS les rôles (`ALL_ROLES` côté API) : lire d'où vient un lot
 * suspect est un besoin de terrain. Le rappel, lui, est réservé aux rôles qualité — l'`operator`,
 * persona de cette app, en est exclu par séparation des tâches HACCP. On le DIT au lieu d'offrir
 * un bouton qui prendrait un 403.
 */
function Actions({ batch, onRecalled }: { batch: BatchDetail; onRecalled: () => void }) {
  const { user } = useCurrentUser();
  const online = useOnlineStatus();
  const recallBlocked = recallBlockedReason(user?.role ?? null);

  const [composing, setComposing] = useState(false);
  const [reason, setReason] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);

  // Pas d'erreur tant que rien n'est tapé : on ne gronde pas un champ encore vide.
  const reasonIssue = reason === '' ? null : recallReasonError(reason);
  const reasonReady = recallReasonError(reason) === null;

  const handleRecall = async () => {
    setConfirming(false);
    setSending(true);

    try {
      const result = await triggerRecall(batch.id, reason);
      setComposing(false);
      setReason('');

      Toast.show({
        // ⚠️ `depthSaturated` : la descendance bloquée peut être INCOMPLÈTE. Annoncer un succès
        // net ferait croire le rappel terminé alors qu'il reste peut-être des lots en rayon.
        type: result.depthSaturated ? 'error' : 'success',
        text1: `Rappel déclenché — ${result.blockedBatchesCount} lot(s) bloqué(s)`,
        text2: result.depthSaturated
          ? 'Descendance possiblement INCOMPLÈTE : une vérification manuelle est requise.'
          : shipmentsNote(result.affectedShipments.length),
      });
      onRecalled();
    } catch (error: unknown) {
      toastError('Rappel refusé', error);
    } finally {
      setSending(false);
    }
  };

  return (
    <View style={styles.actions}>
      <TouchableOpacity
        style={styles.secondaryButton}
        onPress={() => router.navigate(`/genealogy/${batch.id}`)}
        activeOpacity={0.8}
      >
        <Ionicons name="git-network-outline" size={18} color={BRAND.primary} />
        <Text style={styles.secondaryButtonText}>Voir la généalogie</Text>
      </TouchableOpacity>

      {recallBlocked ? (
        // Rôle sans droit — ou rôle non vérifié : deux messages DIFFÉRENTS (cf. recallBlockedReason).
        <View style={styles.recallBlocked}>
          <Ionicons name="lock-closed-outline" size={16} color="#9CA3AF" />
          <Text style={styles.recallBlockedText}>{recallBlocked}</Text>
        </View>
      ) : online === 'offline' ? (
        // Le rappel ne passe PAS par la file offline : le proposer hors réseau serait mentir.
        <View style={styles.recallBlocked}>
          <Ionicons name="cloud-offline-outline" size={16} color="#B45309" />
          <Text style={styles.recallBlockedText}>
            Hors réseau : un rappel ne peut pas être mis en attente. Il exige le serveur.
          </Text>
        </View>
      ) : !composing ? (
        <TouchableOpacity
          style={styles.dangerButton}
          onPress={() => setComposing(true)}
          activeOpacity={0.85}
        >
          <Ionicons name="warning-outline" size={18} color="#fff" />
          <Text style={styles.dangerButtonText}>Déclencher un rappel</Text>
        </TouchableOpacity>
      ) : (
        <View style={styles.recallForm}>
          <Text style={styles.recallLabel}>Motif du rappel</Text>
          {/* Le motif part dans l'alerte ET dans l'e-mail aux clients : il est lu par des tiers. */}
          <TextInput
            style={styles.recallInput}
            value={reason}
            onChangeText={setReason}
            placeholder="Ex. : Listeria détectée au contrôle du 16/07"
            multiline
            maxLength={REASON_MAX_LENGTH}
          />
          {reasonIssue && <Text style={styles.recallError}>{reasonIssue}</Text>}

          <View style={styles.recallRow}>
            <TouchableOpacity
              onPress={() => {
                setComposing(false);
                setReason('');
              }}
              hitSlop={8}
            >
              <Text style={styles.cancelLink}>Annuler</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.dangerButton, (!reasonReady || sending) && styles.dangerDisabled]}
              onPress={() => setConfirming(true)}
              disabled={!reasonReady || sending}
              activeOpacity={0.85}
            >
              {sending ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.dangerButtonText}>Continuer</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* `Alert.alert` est un no-op sur le web : la confirmation passe par un vrai composant. */}
      <ConfirmDialog
        visible={confirming}
        title="Déclencher le rappel ?"
        message={`Ce lot ET toute sa descendance vont être bloqués immédiatement. Les expéditions déjà parties seront listées pour prévenir les clients. Cette action est irréversible depuis le mobile.`}
        confirmLabel="Déclencher"
        destructive
        onCancel={() => setConfirming(false)}
        onConfirm={handleRecall}
      />
    </View>
  );
}

function Fiche({
  batch,
  bottomInset,
  onRecalled,
}: {
  batch: BatchDetail;
  bottomInset: number;
  onRecalled: () => void;
}) {
  // Le `??` reste un garde-fou si l'API ajoute un statut : un badge gris lisible vaut mieux qu'un plantage.
  const statut = STATUT_STYLE[batch.statut] ?? { label: batch.statut, color: '#6B7280', bg: '#F3F4F6' };

  return (
    <ScrollView contentContainerStyle={[styles.body, { paddingBottom: bottomInset + 24 }]}>
      <Text style={styles.produit}>{batch.produitNom}</Text>
      <View style={styles.headerRow}>
        <Text style={styles.lot}>Lot {batch.lotNumber}</Text>
        <View style={[styles.badge, { backgroundColor: statut.bg }]}>
          <Text style={[styles.badgeText, { color: statut.color }]}>{statut.label}</Text>
        </View>
      </View>

      <View style={styles.card}>
        <Row label="Quantité" value={`${batch.quantite} ${batch.uniteCode}`} />
        <Row label="GTIN produit" value={batch.codeGtin ?? '—'} />
        <Row label="Date de péremption" value={formatDate(batch.datePeremption)} />
        <Row label="Créé le" value={formatDate(batch.dateCreation)} />
        <Row label="Identifiant lot" value={batch.id} />
      </View>

      <Actions batch={batch} onRecalled={onRecalled} />

      {/* Seconde moitie du rappel : ce que les magasins ont retire de leur rayon. */}
      <ShelfWithdrawals batchId={batch.id} />
    </ScrollView>
  );
}

export default function BatchDetailScreen() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [result, setResult] = useState<BatchDetailResult | null>(null);
  // « Réessayer » rejoue l'effet, plutôt que de dupliquer le chargement.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let mounted = true;
    // `loadBatch` ne rejette jamais : l'incertitude est dans sa valeur de retour.
    loadBatch(id).then((r) => mounted && setResult(r));
    return () => {
      mounted = false;
    };
  }, [id, attempt]);

  // Le retour à l'écran de chargement se fait ICI, pas dans l'effet : sinon le second essai
  // laisserait l'écran d'échec affiché pendant le rechargement.
  const retry = () => {
    setResult(null);
    setAttempt((a) => a + 1);
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 12 }]}>
      <TouchableOpacity style={styles.backRow} onPress={() => router.back()} hitSlop={8}>
        <Ionicons name="arrow-back" size={20} color="#111827" />
        <Text style={styles.backText}>Retour</Text>
      </TouchableOpacity>

      {result === null ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={BRAND.primary} />
        </View>
      ) : result.kind === 'unverifiable' ? (
        // ⚠️ On n'a PAS PU demander : c'est TRANSITOIRE. Un écran vide muet ferait croire le lot
        // perdu — on propose de réessayer, on ne prétend pas qu'il n'existe pas.
        <View style={styles.center}>
          <Ionicons name="cloud-offline-outline" size={44} color="#B45309" />
          <Text style={styles.empty}>
            Impossible de vérifier cette fiche — le serveur est injoignable.
          </Text>
          <TouchableOpacity onPress={retry} hitSlop={8}>
            <Text style={styles.retryLink}>↻ Réessayer</Text>
          </TouchableOpacity>
        </View>
      ) : result.kind === 'forbidden' ? (
        // 403 : refus de droits, PERMANENT. Pas de « Réessayer » : rejouer avec les mêmes droits ne
        // changera rien. Le confondre avec une panne réseau était le bug de cette issue.
        <View style={styles.center}>
          <Ionicons name="lock-closed-outline" size={44} color="#9CA3AF" />
          <Text style={styles.empty}>
            Accès refusé — vous n’avez pas les droits pour consulter ce lot.
          </Text>
        </View>
      ) : result.kind === 'unknown' ? (
        // 404 : réponse DÉFINITIVE du serveur, pas une incertitude.
        <View style={styles.center}>
          <Ionicons name="help-circle-outline" size={44} color="#9CA3AF" />
          <Text style={styles.empty}>
            Lot introuvable — cet identifiant ne correspond à aucun lot de votre organisation.
          </Text>
        </View>
      ) : (
        <Fiche batch={result.batch} bottomInset={insets.bottom} onRecalled={retry} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F9FAFB', paddingHorizontal: 20 },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 },
  backText: { color: '#111827', fontSize: 15, fontWeight: '600' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24 },
  empty: { textAlign: 'center', color: '#6B7280', fontSize: 15, lineHeight: 22 },
  retryLink: { color: '#B45309', fontWeight: '700', fontSize: 15 },
  body: { gap: 14, paddingTop: 8 },
  produit: { fontSize: 20, fontWeight: '700', color: '#111827' },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  lot: { fontSize: 14, color: '#6B7280', fontWeight: '600' },
  badge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  badgeText: { fontSize: 11, fontWeight: '700' },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 18,
    marginTop: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 3,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 11,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
    gap: 12,
  },
  actions: { gap: 12, marginTop: 6 },
  secondaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: BRAND.primary,
    borderRadius: 12,
    paddingVertical: 14,
  },
  secondaryButtonText: { fontSize: 15, fontWeight: '600', color: BRAND.primary },
  dangerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#B91C1C',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 18,
  },
  dangerDisabled: { backgroundColor: '#9CA3AF' },
  dangerButtonText: { fontSize: 15, fontWeight: '700', color: '#fff' },
  recallBlocked: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: '#F3F4F6',
    borderRadius: 12,
    padding: 14,
  },
  recallBlockedText: { flex: 1, fontSize: 13, color: '#4B5563', lineHeight: 19 },
  recallForm: {
    gap: 10,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: 12,
    padding: 14,
  },
  recallLabel: { fontSize: 13, fontWeight: '700', color: '#7F1D1D' },
  recallInput: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#111827',
    minHeight: 72,
    textAlignVertical: 'top',
  },
  recallError: { fontSize: 12, color: '#B91C1C', fontWeight: '500' },
  recallRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  cancelLink: { fontSize: 14, fontWeight: '600', color: '#6B7280' },
  rowLabel: { fontSize: 14, color: '#6B7280' },
  rowValue: { fontSize: 14, fontWeight: '600', color: '#111827', flexShrink: 1, textAlign: 'right' },
});
