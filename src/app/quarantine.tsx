import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { loadQuarantineBatches, type QuarantineBatch, type QuarantineBatches } from '@/lib/quarantine';

// Marchandise bloquée = mise en garde, pas urgence critique (distinct du rouge de l'alerte froid) :
// une gamme ambrée, cohérente avec les avertissements de quarantaine du reste de l'app.
const ACCENT = '#B45309';
const HEADER_GRADIENT = ['#B45309', '#92400E'] as const;

/** Nombre décimal → français (« 42,5 »). */
function formatQuantity(value: number): string {
  return String(value).replace('.', ',');
}

/** ISO → « JJ/MM/AAAA ». `toLocaleDateString` est peu fiable sous Hermes : on formate à la main. */
function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}`;
}

function BatchCard({ batch }: { batch: QuarantineBatch }) {
  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() => router.navigate({ pathname: '/batch/[id]', params: { id: batch.id } })}
      activeOpacity={0.8}
    >
      <View style={styles.cardHeader}>
        <Ionicons name="lock-closed" size={16} color={ACCENT} />
        <Text style={styles.lotNumber}>{batch.lotNumber}</Text>
        <Ionicons name="chevron-forward" size={18} color="#9CA3AF" style={styles.chevron} />
      </View>
      <Text style={styles.produit}>{batch.produitNom}</Text>
      <View style={styles.metaRow}>
        <Text style={styles.meta}>
          {formatQuantity(batch.quantite)} {batch.uniteCode}
        </Text>
        {batch.datePeremption ? (
          <Text style={styles.meta}>DLC {formatDate(batch.datePeremption)}</Text>
        ) : null}
      </View>
      {/* « Créé le », pas « bloqué depuis » : l'endpoint ne donne pas la date de blocage — l'inventer
          serait mentir. La date de création reste un repère honnête sur l'âge du lot. */}
      <Text style={styles.created}>Créé le {formatDate(batch.dateCreation)}</Text>
    </TouchableOpacity>
  );
}

export default function QuarantineScreen() {
  const insets = useSafeAreaInsets();
  const [result, setResult] = useState<QuarantineBatches | null>(null);

  // Rechargé à CHAQUE focus : un lot peut être bloqué (ou levé) pendant qu'on est ailleurs.
  // `loadQuarantineBatches` ne rejette jamais — l'incertitude est dans sa valeur de retour.
  // ⚠️ Aucun `setState` SYNCHRONE ici : `useFocusEffect` rejoue à chaque rendu, remettre `result`
  // à `null` dans le corps rebouclerait à l'infini. On garde les données affichées le temps du
  // rechargement (pas de clignotement du spinner au retour sur l'écran).
  const load = useCallback(() => {
    loadQuarantineBatches().then(setResult);
  }, []);

  useFocusEffect(load);

  // Le retour à l'écran de chargement se fait ICI (sur appui, hors rendu), pas dans l'effet.
  const retry = () => {
    setResult(null);
    loadQuarantineBatches().then(setResult);
  };

  const count = result?.kind === 'ok' ? result.batches.length : null;

  return (
    <View style={styles.screen}>
      <LinearGradient
        colors={HEADER_GRADIENT}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.header, { paddingTop: insets.top + 12 }]}
      >
        <TouchableOpacity style={styles.backRow} onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="arrow-back" size={20} color="#fff" />
          <Text style={styles.backText}>Retour</Text>
        </TouchableOpacity>

        <View style={styles.titleRow}>
          <Ionicons name="lock-closed" size={20} color="#fff" />
          <Text style={styles.title}>Lots en quarantaine</Text>
        </View>
        <Text style={styles.subtitle}>
          Marchandise bloquée — à ne pas utiliser tant qu’un contrôle qualité ne l’a pas levée.
        </Text>
        {count !== null ? (
          <View style={styles.countBadge}>
            <Text style={styles.countText}>
              {count} lot{count > 1 ? 's' : ''} bloqué{count > 1 ? 's' : ''}
            </Text>
          </View>
        ) : null}
      </LinearGradient>

      {result === null ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={ACCENT} />
        </View>
      ) : result.kind === 'unverifiable' ? (
        // ⚠️ On n'a PAS PU demander. Ne jamais afficher « aucun lot » ici : ce serait annoncer que
        // rien n'est bloqué alors qu'on n'en sait justement rien.
        <View style={[styles.center, styles.stateWrap]}>
          <Ionicons name="cloud-offline-outline" size={48} color={ACCENT} />
          <Text style={styles.stateText}>
            Impossible de vérifier les lots en quarantaine — le serveur est injoignable.{'\n'}
            <Text style={styles.stateStrong}>La liste n’est PAS forcément vide.</Text>
          </Text>
          <TouchableOpacity onPress={retry} hitSlop={8}>
            <Text style={styles.retryLink}>↻ Réessayer</Text>
          </TouchableOpacity>
        </View>
      ) : result.batches.length === 0 ? (
        <View style={[styles.center, styles.stateWrap]}>
          <Ionicons name="checkmark-circle-outline" size={48} color="#059669" />
          <Text style={styles.stateText}>Aucun lot en quarantaine actuellement.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 24 }]}>
          {result.batches.map((batch) => (
            <BatchCard key={batch.id} batch={batch} />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#FEF9F3' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FEF9F3' },
  stateWrap: { padding: 24, gap: 16 },
  stateText: { textAlign: 'center', color: '#6B7280', fontSize: 15, lineHeight: 22 },
  stateStrong: { color: '#374151', fontWeight: '700' },
  retryLink: { color: ACCENT, fontWeight: '700', fontSize: 15 },

  /* ── Header ──────────────────────────────────────────────── */
  header: {
    paddingHorizontal: 20,
    paddingBottom: 20,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    gap: 8,
  },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  backText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { color: '#fff', fontSize: 20, fontWeight: '700' },
  subtitle: { color: 'rgba(255,255,255,0.92)', fontSize: 13, lineHeight: 19 },
  countBadge: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.20)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginTop: 4,
  },
  countText: { color: '#fff', fontSize: 12, fontWeight: '700', letterSpacing: 0.3 },

  /* ── List ────────────────────────────────────────────────── */
  list: { padding: 16, gap: 12 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    gap: 6,
    borderLeftWidth: 4,
    borderLeftColor: ACCENT,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 3,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  lotNumber: { fontSize: 16, fontWeight: '700', color: '#111827' },
  chevron: { marginLeft: 'auto' },
  produit: { fontSize: 14, color: '#374151' },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, marginTop: 2 },
  meta: { fontSize: 13, color: '#6B7280', fontWeight: '600' },
  created: { fontSize: 12, color: '#9CA3AF', marginTop: 2 },
});
