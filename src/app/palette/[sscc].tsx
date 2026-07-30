import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { loadPallet, type PalletResult } from '@/lib/batches';
import { getErrorMessage } from '@/lib/errors';
import { BRAND } from '@/lib/theme';

// Miroir des statuts de lot de l'API. Volontairement restreint à ce que le quai doit distinguer :
// ce qui peut partir, et ce qui ne le peut pas.
const STATUT_STYLE: Record<string, { label: string; color: string; bg: string }> = {
  EN_STOCK: { label: 'En stock', color: '#047857', bg: '#D1FAE5' },
  EN_PRODUCTION: { label: 'En transformation', color: '#7C3AED', bg: '#F5F3FF' },
  EN_ATTENTE_QC: { label: 'En attente de contrôle', color: '#3730A3', bg: '#E0E7FF' },
  BLOQUE: { label: 'En quarantaine', color: '#B91C1C', bg: '#FEE2E2' },
  ALERTE: { label: 'Sous rappel', color: '#B91C1C', bg: '#FEE2E2' },
  EXPEDIE: { label: 'Expédié', color: '#0891B2', bg: '#ECFEFF' },
  EPUISE: { label: 'Épuisé', color: '#6B7280', bg: '#F3F4F6' },
};

function statutStyle(statut: string) {
  return (
    STATUT_STYLE[statut.toUpperCase()] ?? { label: statut, color: '#6B7280', bg: '#F3F4F6' }
  );
}

/** Le SSCC se lit à 18 chiffres : on l'espace pour qu'un humain puisse le comparer à l'étiquette. */
function formatSscc(sscc: string): string {
  return sscc.replace(/(\d{4})(?=\d)/g, '$1 ');
}

export default function PalletScreen() {
  const { sscc } = useLocalSearchParams<{ sscc: string }>();
  const insets = useSafeAreaInsets();
  const [result, setResult] = useState<PalletResult | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let mounted = true;
    // `loadPallet` ne rejette jamais : l'incertitude est dans sa valeur de retour.
    loadPallet(sscc).then((r) => mounted && setResult(r));
    return () => {
      mounted = false;
    };
  }, [sscc, attempt]);

  const pallet = result?.kind === 'ok' ? result.pallet : null;

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.back} accessibilityLabel="Retour">
          <Ionicons name="chevron-back" size={26} color={'#111827'} />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.title}>Palette</Text>
          <Text style={styles.sscc}>{formatSscc(sscc)}</Text>
        </View>
      </View>

      {result === null ? (
        <ActivityIndicator style={styles.loader} color={BRAND.primary} />
      ) : result.kind === 'unknown' ? (
        // Réponse définitive : cette palette n'est pas la nôtre. Rien à réessayer, et surtout pas
        // un écran vide qui la ferait passer pour une palette sans contenu.
        <View style={styles.errorBox}>
          <Text style={styles.errorTitle}>Palette inconnue</Text>
          <Text style={styles.errorText}>
            Ce SSCC ne correspond à aucune palette de votre organisation. C’est peut-être une
            palette fournisseur, à réceptionner.
          </Text>
        </View>
      ) : result.kind === 'unverifiable' ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorTitle}>Palette non vérifiée</Text>
          <Text style={styles.errorText}>{getErrorMessage(result.error)}</Text>
          <TouchableOpacity style={styles.retry} onPress={() => setAttempt((n) => n + 1)}>
            <Text style={styles.retryText}>Réessayer</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          {pallet?.contient_lot_rappele ? (
            // Le rappel est la raison d'être de ce scan : un lot peut passer sous rappel APRÈS la
            // palettisation, et c'est sur le quai, palette dans les bras, qu'il faut l'apprendre.
            <View style={styles.recall}>
              <Ionicons name="warning" size={20} color="#B91C1C" />
              <Text style={styles.recallText}>
                Cette palette porte un lot sous rappel. Elle ne doit pas être expédiée.
              </Text>
            </View>
          ) : null}

          <Text style={styles.count}>
            {pallet?.lots.length ?? 0} lot{(pallet?.lots.length ?? 0) > 1 ? 's' : ''}
          </Text>

          {pallet?.lots.length === 0 ? (
            <Text style={styles.empty}>
              Cette palette ne porte plus aucun lot. Ils en ont été sortis un par un.
            </Text>
          ) : null}

          {pallet?.lots.map((lot) => {
            const style = statutStyle(lot.statut);
            return (
              <View key={lot.id} style={styles.card}>
                <View style={styles.cardHead}>
                  <Text style={styles.produit}>{lot.produit}</Text>
                  <View style={[styles.badge, { backgroundColor: style.bg }]}>
                    <Text style={[styles.badgeText, { color: style.color }]}>{style.label}</Text>
                  </View>
                </View>
                <Text style={styles.lotNumber}>{lot.numero_lot}</Text>
                {lot.quantite !== undefined ? (
                  <Text style={styles.quantite}>
                    {lot.quantite} {lot.unite ?? ''}
                  </Text>
                ) : null}
              </View>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F9FAFB' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 12 },
  back: { padding: 4, marginRight: 8 },
  headerText: { flex: 1 },
  title: { fontSize: 20, fontWeight: '700', color: '#111827' },
  sscc: { fontSize: 13, color: '#6B7280', marginTop: 2, letterSpacing: 0.5 },
  loader: { marginTop: 40 },
  content: { padding: 16, gap: 12 },
  recall: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#FEE2E2',
    borderRadius: 10,
    padding: 12,
  },
  recallText: { flex: 1, color: '#B91C1C', fontWeight: '600' },
  count: { color: '#6B7280', fontSize: 13 },
  empty: { color: '#6B7280', fontStyle: 'italic' },
  card: { backgroundColor: '#FFFFFF', borderRadius: 12, padding: 14, gap: 6 },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  produit: { flex: 1, fontSize: 16, fontWeight: '600', color: '#111827' },
  badge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  badgeText: { fontSize: 12, fontWeight: '700' },
  lotNumber: { color: '#374151', fontVariant: ['tabular-nums'] },
  quantite: { color: '#6B7280' },
  errorBox: { margin: 16, padding: 16, backgroundColor: '#FEF2F2', borderRadius: 12, gap: 8 },
  errorTitle: { fontWeight: '700', color: '#B91C1C', fontSize: 16 },
  errorText: { color: '#7F1D1D' },
  retry: { alignSelf: 'flex-start', paddingHorizontal: 14, paddingVertical: 8, backgroundColor: '#B91C1C', borderRadius: 8 },
  retryText: { color: '#FFFFFF', fontWeight: '600' },
});
