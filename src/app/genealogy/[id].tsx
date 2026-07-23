import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BRAND } from '@/lib/theme';
import {
  loadGenealogy,
  type Genealogy,
  type GenealogyBatch,
  type GenealogyResult,
  type Origin,
} from '@/lib/traceability';

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

function BatchLine({ batch }: { batch: GenealogyBatch }) {
  return (
    <TouchableOpacity
      style={styles.line}
      onPress={() => router.navigate(`/batch/${batch.id}`)}
      activeOpacity={0.7}
    >
      <View style={styles.lineMain}>
        <Text style={styles.lineTitle}>{batch.nom_produit}</Text>
        <Text style={styles.lineSub}>
          Lot {batch.lot_number} · {batch.quantite_actuelle} {batch.unite_code}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color="#9CA3AF" />
    </TouchableOpacity>
  );
}

function OriginLine({ origin }: { origin: Origin }) {
  return (
    <View style={styles.line}>
      <View style={styles.lineMain}>
        <Text style={styles.lineTitle}>{origin.fournisseur.nom_ferme}</Text>
        <Text style={styles.lineSub}>
          Lot {origin.lot_number} · reçu le {formatDate(origin.date_reception)}
        </Text>
      </View>
    </View>
  );
}

/**
 * Une section de la chaîne. Une liste VIDE est une réponse (« rien en amont »), pas une absence
 * d'information : on l'écrit, au lieu de laisser un blanc que l'opérateur interpréterait seul.
 */
function Section({ title, hint, empty, children }: {
  title: string;
  hint: string;
  empty: boolean;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.sectionHint}>{hint}</Text>
      {empty ? <Text style={styles.sectionEmpty}>Aucun lot.</Text> : children}
    </View>
  );
}

function Chaine({ genealogy, bottomInset }: { genealogy: Genealogy; bottomInset: number }) {
  return (
    <ScrollView contentContainerStyle={[styles.body, { paddingBottom: bottomInset + 24 }]}>
      <Section
        title="Origines"
        hint="Les entrées de matière première — « la ferme »."
        empty={genealogy.origines.length === 0}
      >
        {genealogy.origines.map((origin) => (
          <OriginLine key={`${origin.lot_number}-${origin.fournisseur.id}`} origin={origin} />
        ))}
      </Section>

      <Section
        title="Ascendance"
        hint="Ce dont ce lot est fait."
        empty={genealogy.upstream.length === 0}
      >
        {genealogy.upstream.map((batch) => (
          <BatchLine key={batch.id} batch={batch} />
        ))}
      </Section>

      <Section
        title="Descendance"
        hint="Ce qui a été fait avec ce lot — ce qu'un rappel bloquerait."
        empty={genealogy.downstream.length === 0}
      >
        {genealogy.downstream.map((batch) => (
          <BatchLine key={batch.id} batch={batch} />
        ))}
      </Section>
    </ScrollView>
  );
}

export default function GenealogyScreen() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [result, setResult] = useState<GenealogyResult | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let mounted = true;
    // `loadGenealogy` ne rejette jamais : l'incertitude est dans sa valeur de retour.
    loadGenealogy(id).then((r) => mounted && setResult(r));
    return () => {
      mounted = false;
    };
  }, [id, attempt]);

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

      <Text style={styles.title}>Généalogie du lot</Text>

      {result === null ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={BRAND.primary} />
        </View>
      ) : result.kind === 'unverifiable' ? (
        // ⚠️ TRANSITOIRE. Une chaîne vide affichée ici ferait croire qu'aucun lot n'est parti en
        // rayon — sur une suspicion sanitaire, c'est le mensonge le plus coûteux du produit.
        <View style={styles.center}>
          <Ionicons name="cloud-offline-outline" size={44} color="#B45309" />
          <Text style={styles.empty}>
            Impossible de remonter la chaîne — le serveur est injoignable. Ne concluez pas que ce
            lot n’a pas de descendance.
          </Text>
          <TouchableOpacity onPress={retry} hitSlop={8}>
            <Text style={styles.retryLink}>↻ Réessayer</Text>
          </TouchableOpacity>
        </View>
      ) : result.kind === 'forbidden' ? (
        <View style={styles.center}>
          <Ionicons name="lock-closed-outline" size={44} color="#9CA3AF" />
          <Text style={styles.empty}>
            Accès refusé — vous n’avez pas les droits sur la chaîne de ce lot.
          </Text>
        </View>
      ) : result.kind === 'unknown' ? (
        <View style={styles.center}>
          <Ionicons name="help-circle-outline" size={44} color="#9CA3AF" />
          <Text style={styles.empty}>
            Lot introuvable — cet identifiant ne correspond à aucun lot de votre organisation.
          </Text>
        </View>
      ) : (
        <Chaine genealogy={result.genealogy} bottomInset={insets.bottom} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F9FAFB', paddingHorizontal: 20 },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 },
  backText: { color: '#111827', fontSize: 15, fontWeight: '600' },
  title: { fontSize: 20, fontWeight: '700', color: '#111827', marginBottom: 4 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24 },
  empty: { textAlign: 'center', color: '#6B7280', fontSize: 15, lineHeight: 22 },
  retryLink: { color: '#B45309', fontWeight: '700', fontSize: 15 },
  body: { gap: 18, paddingTop: 8 },
  section: { gap: 6 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: '#111827' },
  sectionHint: { fontSize: 12, color: '#6B7280', marginBottom: 4 },
  sectionEmpty: { fontSize: 14, color: '#9CA3AF', fontStyle: 'italic' },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  lineMain: { flex: 1, gap: 2 },
  lineTitle: { fontSize: 14, fontWeight: '600', color: '#111827' },
  lineSub: { fontSize: 12, color: '#6B7280' },
});
