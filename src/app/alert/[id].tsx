import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
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

import {
  loadAlertDecision,
  releaseAndResolve,
  resolveAlert,
  type AlertDecision,
} from '@/lib/alerts';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { toastError } from '@/lib/toast';

// Contexte critique (danger) — couleurs locales à l'écran, distinctes de la marque teal.
const DANGER = '#B3261E';
const TEMP_OVER = '#C2410C';
const HEADER_GRADIENT = ['#B23A34', '#8A2A25'] as const;
const MOTIF_MIN = 3;

function formatTemp(value: number | null): string {
  if (value == null) return '—';
  return `${String(value).replace('.', ',')} °C`;
}

function formatTime(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function Badge({ text }: { text: string }) {
  return (
    <View style={styles.badge}>
      <Text style={styles.badgeText}>{text.toUpperCase()}</Text>
    </View>
  );
}

function Row({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, valueColor ? { color: valueColor } : null]}>{value}</Text>
    </View>
  );
}

export default function AlertDecisionScreen() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [decision, setDecision] = useState<AlertDecision | null>(null);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    let mounted = true;
    loadAlertDecision(id)
      .then((d) => mounted && setDecision(d))
      .catch((error: unknown) => mounted && toastError('Chargement de l’alerte impossible', error))
      .finally(() => mounted && setLoading(false));
    return () => {
      mounted = false;
    };
  }, [id]);

  // Succès : un toast puis retour — l'accueil recharge ses alertes au focus, l'alerte résolue disparaît.
  const done = useCallback((text1: string, text2: string) => {
    Toast.show({ type: 'success', text1, text2 });
    router.back();
  }, []);

  const maintain = async () => {
    if (!decision || submitting) return;
    setSubmitting(true);
    try {
      await resolveAlert(decision.alert.id, note);
      done('Quarantaine maintenue', 'Alerte clôturée ; lot(s) laissé(s) en quarantaine.');
    } catch (error: unknown) {
      toastError('Action impossible', error);
    } finally {
      setSubmitting(false);
    }
  };

  const releaseConfirmed = async () => {
    if (!decision) return;
    setSubmitting(true);
    try {
      // La note saisie sert de motif de levée (obligatoire côté API) ET de note de résolution.
      await releaseAndResolve(
        decision.alert.id,
        decision.batches.map((b) => b.id),
        note.trim()
      );
      done('Quarantaine levée', 'Lot(s) remis en stock ; alerte clôturée.');
    } catch (error: unknown) {
      toastError('Levée impossible', error);
    } finally {
      setSubmitting(false);
    }
  };

  const releaseWithoutIsolation = () => {
    if (!decision || submitting) return;
    // Lever la quarantaine exige un motif tracé (3–500 car. côté API).
    if (note.trim().length < MOTIF_MIN) {
      Toast.show({
        type: 'error',
        text1: 'Motif requis',
        text2: 'Décrivez l’action corrective (3 caractères min.) pour lever la quarantaine.',
      });
      return;
    }
    // ⚠️ PAS `Alert.alert` : no-op littéral sur le web (corps de méthode vide). La décision la plus
    // lourde de l'application — remettre en stock des lots mis en quarantaine par la chaîne du
    // froid — était un BOUTON MORT dans un navigateur. Et la démo se fait dans un navigateur.
    setConfirming(true);
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={DANGER} />
      </View>
    );
  }

  if (!decision) {
    return (
      <View style={[styles.center, styles.notFoundWrap]}>
        <Ionicons name="checkmark-circle-outline" size={48} color="#9CA3AF" />
        <Text style={styles.notFound}>
          Alerte introuvable — elle a peut-être déjà été résolue sur un autre poste.
        </Text>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8}>
          <Text style={styles.backLink}>← Retour</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const { alert, batches } = decision;
  const primaryBatch = batches[0];

  return (
    <View style={styles.screen}>
      {/* ── Header critique ─────────────────────────────────────── */}
      <LinearGradient
        colors={HEADER_GRADIENT}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.header, { paddingTop: insets.top + 12 }]}
      >
        <TouchableOpacity style={styles.backRow} onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="arrow-back" size={20} color="#fff" />
          <Text style={styles.backText}>Retour accueil</Text>
        </TouchableOpacity>

        <View style={styles.titleRow}>
          <View style={styles.dot} />
          <Text style={styles.title}>Alerte chaîne du froid</Text>
        </View>
        <Text style={styles.message}>{alert.message}</Text>

        <View style={styles.badges}>
          {alert.niveau_gravite ? <Badge text={alert.niveau_gravite} /> : null}
          {decision.lieuNom ? <Badge text={decision.lieuNom} /> : null}
          <Badge text={`${batches.length} lot${batches.length > 1 ? 's' : ''}`} />
        </View>
      </LinearGradient>

      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 24 }]}>
        {/* ── Carte incident ─────────────────────────────────────── */}
        <View style={styles.card}>
          <Text style={styles.cardLabel}>INCIDENT</Text>
          <Row label="Lot" value={primaryBatch?.lotNumber ?? '—'} />
          <Row label="Produit" value={primaryBatch?.produitNom ?? decision.equipmentNom ?? '—'} />
          <Row
            label="Température mesurée"
            value={formatTemp(decision.tempMesuree)}
            valueColor={TEMP_OVER}
          />
          <Row label="Seuil max" value={formatTemp(decision.tempSeuilMax)} />
          <Row
            label="Depuis"
            value={`${formatTime(alert.created_at)}${decision.lieuNom ? ` — ${decision.lieuNom}` : ''}`}
          />
          {batches.length > 1 ? (
            <Text style={styles.moreBatches}>
              +{batches.length - 1} autre(s) lot(s) isolé(s) sur cet équipement
            </Text>
          ) : null}
        </View>

        {/* ── Carte action ───────────────────────────────────────── */}
        <View style={styles.card}>
          <Text style={styles.cardLabel}>OUVERTURE INCIDENT & ACTION</Text>
          <Text style={styles.fieldLabel}>Action corrective</Text>
          <TextInput
            style={styles.textarea}
            placeholder="Ex. isolation immédiate, mesure thermique répétée, notification responsable site…"
            placeholderTextColor="#9CA3AF"
            multiline
            value={note}
            onChangeText={setNote}
            editable={!submitting}
          />

          <TouchableOpacity
            style={[styles.btnPrimary, submitting && styles.btnDisabled]}
            onPress={maintain}
            disabled={submitting}
            activeOpacity={0.85}
          >
            {submitting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.btnPrimaryText}>Maintenir la quarantaine</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.btnSecondary, submitting && styles.btnDisabled]}
            onPress={releaseWithoutIsolation}
            disabled={submitting}
            activeOpacity={0.85}
          >
            <Text style={styles.btnSecondaryText}>Enregistrer sans isolation</Text>
          </TouchableOpacity>

          {primaryBatch ? (
            <TouchableOpacity
              style={[styles.btnTertiary, submitting && styles.btnDisabled]}
              onPress={() => router.navigate({ pathname: '/batch/[id]', params: { id: primaryBatch.id } })}
              disabled={submitting}
              activeOpacity={0.85}
            >
              <Text style={styles.btnTertiaryText}>Voir fiche lot complète</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </ScrollView>

      <ConfirmDialog
        visible={confirming}
        title="Lever la quarantaine ?"
        message={`${decision.batches.length} lot(s) seront remis en stock. Décision tracée dans l’audit.`}
        confirmLabel="Lever"
        destructive
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          releaseConfirmed();
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#FBEBEA' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FBEBEA' },
  notFoundWrap: { padding: 24, gap: 16 },
  notFound: { textAlign: 'center', color: '#6B7280', fontSize: 15, lineHeight: 22 },
  backLink: { color: DANGER, fontWeight: '700', fontSize: 15 },

  /* ── Header ──────────────────────────────────────────────── */
  header: {
    paddingHorizontal: 20,
    paddingBottom: 22,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    gap: 10,
  },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  backText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: 'rgba(255,255,255,0.9)' },
  title: { color: '#fff', fontSize: 20, fontWeight: '700' },
  message: { color: 'rgba(255,255,255,0.92)', fontSize: 14, lineHeight: 20 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  badge: {
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '700', letterSpacing: 0.4 },

  /* ── Body ────────────────────────────────────────────────── */
  body: { padding: 16, gap: 16 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 18,
    gap: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 3,
  },
  cardLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: DANGER,
    letterSpacing: 0.8,
    marginBottom: 8,
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
  rowLabel: { fontSize: 14, color: '#6B7280' },
  rowValue: { fontSize: 15, fontWeight: '700', color: '#111827', flexShrink: 1, textAlign: 'right' },
  moreBatches: { fontSize: 12, color: '#92400E', marginTop: 8 },

  /* ── Action ──────────────────────────────────────────────── */
  fieldLabel: { fontSize: 13, fontWeight: '600', color: '#374151', marginBottom: 8 },
  textarea: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    padding: 12,
    minHeight: 96,
    fontSize: 14,
    color: '#111827',
    textAlignVertical: 'top',
    marginBottom: 16,
  },
  btnPrimary: {
    backgroundColor: DANGER,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 10,
  },
  btnPrimaryText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  btnSecondary: {
    borderWidth: 1.5,
    borderColor: DANGER,
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
    marginBottom: 10,
  },
  btnSecondaryText: { color: DANGER, fontSize: 15, fontWeight: '700' },
  btnTertiary: {
    backgroundColor: '#F3F4F6',
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
  },
  btnTertiaryText: { color: '#374151', fontSize: 15, fontWeight: '700' },
  btnDisabled: { opacity: 0.5 },
});
