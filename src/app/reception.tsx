import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';

import { OptionPicker } from '@/components/option-picker';
import { loadProducts, loadSuppliers, type Product, type Supplier } from '@/lib/catalog';
import { toastError } from '@/lib/toast';
import { enqueueReceipt } from '@/lib/sync/queue';
import { SHIPMENT_ID_MAX_LENGTH, buildReceipt } from '@/lib/sync/receipt';
import { syncPendingOperations } from '@/lib/sync/sync';
import { BRAND, HEADER_GRADIENT } from '@/lib/theme';
import type { ReceiptPayload } from '@/lib/sync/types';

const CONTROL_STATUSES: ReceiptPayload['statut_controle'][] = [
  'OK',
  'CONFORME',
  'ALERTE',
  'NONCONFORME',
];

export default function ReceptionScreen() {
  const insets = useSafeAreaInsets();
  const { code } = useLocalSearchParams<{ code?: string }>();

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  const [supplierId, setSupplierId] = useState('');
  const [productId, setProductId] = useState('');
  const [shipmentId, setShipmentId] = useState(code ?? '');
  const [quantity, setQuantity] = useState('');
  const [unit, setUnit] = useState('');
  const [status, setStatus] = useState<ReceiptPayload['statut_controle']>('OK');
  const [saving, setSaving] = useState(false);

  // Les unités viennent des produits, jamais d'une liste codée en dur : elles sont des
  // clés étrangères côté serveur, et « KG » n'y existe pas — c'est « kg ». Une constante
  // locale ferait accepter la réception puis rejeter en silence à la synchronisation.
  const units = [...new Set(products.map((product) => product.unite_reference))];

  useEffect(() => {
    Promise.all([loadSuppliers(), loadProducts()])
      .then(([loadedSuppliers, loadedProducts]) => {
        setSuppliers(loadedSuppliers);
        setProducts(loadedProducts);
      })
      .catch((error: unknown) => {
        toastError('Catalogue indisponible', error);
      })
      .finally(() => setLoading(false));
  }, []);

  const receipt = buildReceipt({ supplierId, productId, shipmentId, quantity, unit, status });

  const handleSubmit = async () => {
    if (!receipt || saving) return;
    setSaving(true);

    try {
      // Enregistrée localement d'abord : un scan ne doit jamais dépendre du réseau.
      await enqueueReceipt(receipt);

      Toast.show({
        type: 'success',
        text1: 'Réception enregistrée',
        text2: 'Elle sera synchronisée dès que le réseau reviendra.',
      });
      router.back();

      // Tentative opportuniste : si le réseau est là, l'opération part immédiatement.
      syncPendingOperations().catch(() => undefined);
    } catch (error: unknown) {
      toastError('Enregistrement impossible', error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.screen}>
      <LinearGradient
        colors={HEADER_GRADIENT}
        style={[styles.header, { paddingTop: insets.top + 12 }]}
      >
        <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Nouvelle réception</Text>
      </LinearGradient>

      {loading ? (
        <ActivityIndicator style={styles.loader} size="large" color={BRAND.primary} />
      ) : (
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
            <OptionPicker
              label="Fournisseur"
              options={suppliers.map((s) => ({ value: s.id, label: s.nom_ferme }))}
              selected={supplierId}
              onSelect={setSupplierId}
            />

            <OptionPicker
              label="Produit"
              options={products.map((p) => ({ value: p.id, label: p.nom }))}
              selected={productId}
              onSelect={(id) => {
                setProductId(id);
                const product = products.find((p) => p.id === id);
                if (product) setUnit(product.unite_reference);
              }}
            />

            <View style={styles.field}>
              <Text style={styles.label}>N° d&apos;expédition (SSCC)</Text>
              <TextInput
                style={styles.input}
                value={shipmentId}
                onChangeText={setShipmentId}
                placeholder="SHIP-2026-001"
                autoCapitalize="characters"
                maxLength={SHIPMENT_ID_MAX_LENGTH}
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Quantité</Text>
              <TextInput
                style={styles.input}
                value={quantity}
                onChangeText={setQuantity}
                placeholder="0"
                keyboardType="decimal-pad"
              />
            </View>

            <OptionPicker
              label="Unité"
              options={units.map((u) => ({ value: u, label: u }))}
              selected={unit}
              onSelect={setUnit}
            />

            <OptionPicker
              label="Contrôle"
              options={CONTROL_STATUSES.map((s) => ({ value: s, label: s }))}
              selected={status}
              onSelect={(value) => setStatus(value as ReceiptPayload['statut_controle'])}
            />

            <TouchableOpacity
              style={[styles.submit, !receipt && styles.submitDisabled]}
              onPress={handleSubmit}
              disabled={!receipt || saving}
              activeOpacity={0.85}
            >
              {saving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.submitText}>Enregistrer la réception</Text>
              )}
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F9FAFB' },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  headerTitle: { color: '#fff', fontSize: 18, fontWeight: '700' },
  loader: { marginTop: 48 },
  form: { padding: 20, gap: 20, paddingBottom: 48 },
  field: { gap: 8 },
  label: { fontSize: 13, fontWeight: '600', color: '#374151' },
  input: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: '#111827',
  },
  submit: {
    backgroundColor: BRAND.primary,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  submitDisabled: { backgroundColor: '#9CA3AF' },
  submitText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
