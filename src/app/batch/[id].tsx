import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { loadBatch, type BatchDetail } from '@/lib/batches';

import { BRAND } from '@/lib/theme';

// Statut de lot → libellé + couleur (miroir des statuts serveur EN_STOCK/BLOQUE/ALERTE…).
const STATUT_STYLE: Record<string, { label: string; color: string; bg: string }> = {
  EN_STOCK: { label: 'En stock', color: '#047857', bg: '#D1FAE5' },
  BLOQUE: { label: 'En quarantaine', color: '#B91C1C', bg: '#FEE2E2' },
  ALERTE: { label: 'Sous rappel', color: '#B91C1C', bg: '#FEE2E2' },
  CONSOMME: { label: 'Consommé', color: '#6B7280', bg: '#F3F4F6' },
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

export default function BatchDetailScreen() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [batch, setBatch] = useState<BatchDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    loadBatch(id)
      .then((b) => mounted && setBatch(b))
      .finally(() => mounted && setLoading(false));
    return () => {
      mounted = false;
    };
  }, [id]);

  const statut = batch ? (STATUT_STYLE[batch.statut] ?? { label: batch.statut, color: '#6B7280', bg: '#F3F4F6' }) : null;

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 12 }]}>
      <TouchableOpacity style={styles.backRow} onPress={() => router.back()} hitSlop={8}>
        <Ionicons name="arrow-back" size={20} color="#111827" />
        <Text style={styles.backText}>Retour</Text>
      </TouchableOpacity>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={BRAND.primary} />
        </View>
      ) : !batch ? (
        <View style={styles.center}>
          <Ionicons name="alert-circle-outline" size={44} color="#9CA3AF" />
          <Text style={styles.empty}>Fiche lot indisponible (hors réseau ou lot introuvable).</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 24 }]}>
          <Text style={styles.produit}>{batch.produitNom}</Text>
          <View style={styles.headerRow}>
            <Text style={styles.lot}>Lot {batch.lotNumber}</Text>
            {statut ? (
              <View style={[styles.badge, { backgroundColor: statut.bg }]}>
                <Text style={[styles.badgeText, { color: statut.color }]}>{statut.label}</Text>
              </View>
            ) : null}
          </View>

          <View style={styles.card}>
            <Row label="Quantité" value={`${batch.quantite} ${batch.uniteCode}`} />
            <Row label="GTIN produit" value={batch.codeGtin ?? '—'} />
            <Row label="Date de péremption" value={formatDate(batch.datePeremption)} />
            <Row label="Créé le" value={formatDate(batch.dateCreation)} />
            <Row label="Identifiant lot" value={batch.id} />
          </View>
        </ScrollView>
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
  rowLabel: { fontSize: 14, color: '#6B7280' },
  rowValue: { fontSize: 14, fontWeight: '600', color: '#111827', flexShrink: 1, textAlign: 'right' },
});
