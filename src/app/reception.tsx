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

import { LocationScanner } from '@/components/location-scanner';
import { OptionPicker } from '@/components/option-picker';
import { loadProducts, loadSuppliers, type Product, type Supplier } from '@/lib/catalog';
import {
  findEquipmentByCode,
  isStorageEquipment,
  loadEquipment,
  type Equipment,
} from '@/lib/equipment';
import { enqueueReceipt } from '@/lib/sync/queue';
import { SHIPMENT_ID_MAX_LENGTH, buildReceipt } from '@/lib/sync/receipt';
import { syncPendingOperations } from '@/lib/sync/sync';
import type { ReceiptPayload } from '@/lib/sync/types';
import { BRAND, HEADER_GRADIENT } from '@/lib/theme';
import { toastError } from '@/lib/toast';

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
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [loading, setLoading] = useState(true);

  const [supplierId, setSupplierId] = useState('');
  const [productId, setProductId] = useState('');
  const [shipmentId, setShipmentId] = useState(code ?? '');
  const [quantity, setQuantity] = useState('');
  const [unit, setUnit] = useState('');
  const [status, setStatus] = useState<ReceiptPayload['statut_controle']>('OK');
  const [location, setLocation] = useState<Equipment | null>(null);
  const [scanningLocation, setScanningLocation] = useState(false);
  const [saving, setSaving] = useState(false);

  // Les unités viennent des produits, jamais d'une liste codée en dur : elles sont des
  // clés étrangères côté serveur, et « KG » n'y existe pas — c'est « kg ». Une constante
  // locale ferait accepter la réception puis rejeter en silence à la synchronisation.
  const units = [...new Set(products.map((product) => product.unite_reference))];

  useEffect(() => {
    // Le catalogue est indispensable à la saisie ; l'emplacement ne l'est pas. Les charger
    // ensemble ferait échouer TOUTE la réception dès que la liste des matériels manque du
    // cache — ce qui est le cas au premier lancement hors réseau après une mise à jour.
    Promise.all([loadSuppliers(), loadProducts()])
      .then(([loadedSuppliers, loadedProducts]) => {
        setSuppliers(loadedSuppliers);
        setProducts(loadedProducts);
      })
      .catch((error: unknown) => {
        toastError('Catalogue indisponible', error);
      })
      .finally(() => setLoading(false));

    loadEquipment()
      .then(setEquipment)
      .catch(() => setEquipment([]));
  }, []);

  const handleLocationScan = (scannedCode: string) => {
    const found = findEquipmentByCode(scannedCode, equipment);
    setScanningLocation(false);

    if (!found) {
      // Un code produit scanné par mégarde ne doit jamais passer pour un emplacement.
      Toast.show({
        type: 'error',
        text1: 'Emplacement inconnu',
        text2: 'Ce code ne correspond à aucun matériel de votre organisation.',
      });
      return;
    }

    if (!isStorageEquipment(found)) {
      Toast.show({
        type: 'error',
        text1: `${found.nom} n'est pas un lieu de stockage`,
        text2: 'Scannez un frigo, un congélateur ou une étagère.',
      });
      return;
    }

    setLocation(found);
  };

  const receipt = buildReceipt({
    supplierId,
    productId,
    shipmentId,
    quantity,
    unit,
    status,
    equipmentId: location?.id,
  });

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

            <View style={styles.field}>
              <Text style={styles.label}>Emplacement de stockage</Text>

              {location ? (
                <TouchableOpacity
                  style={styles.location}
                  onPress={() => setScanningLocation(true)}
                  activeOpacity={0.8}
                >
                  <Ionicons name="location" size={18} color={BRAND.primary} />
                  <View style={styles.locationText}>
                    <Text style={styles.locationName}>{location.nom}</Text>
                    <Text style={styles.locationPlace}>{location.lieu.nom}</Text>
                  </View>
                  <Ionicons name="refresh-outline" size={16} color="#6B7280" />
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={styles.scanLocation}
                  onPress={() => setScanningLocation(true)}
                  activeOpacity={0.8}
                >
                  <Ionicons name="qr-code-outline" size={18} color={BRAND.primary} />
                  <Text style={styles.scanLocationText}>Scanner l&apos;emplacement</Text>
                </TouchableOpacity>
              )}

              {/* Sans emplacement, la quarantaine automatique sur excursion de température
                  ne bloquera JAMAIS ce lot : son frigo peut dériver sans qu'il soit isolé. */}
              {!location && (
                <Text style={styles.warning}>
                  Sans emplacement, ce lot ne sera pas mis en quarantaine si son frigo dérive.
                </Text>
              )}
            </View>

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

      <LocationScanner
        visible={scanningLocation}
        onClose={() => setScanningLocation(false)}
        onScan={handleLocationScan}
      />
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
  scanLocation: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: BRAND.primary,
    borderStyle: 'dashed',
    borderRadius: 10,
    paddingVertical: 14,
  },
  scanLocationText: { fontSize: 14, fontWeight: '600', color: BRAND.primary },
  location: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  locationText: { flex: 1, gap: 2 },
  locationName: { fontSize: 14, fontWeight: '600', color: '#111827' },
  locationPlace: { fontSize: 12, color: '#6B7280' },
  warning: { fontSize: 12, color: '#B45309' },
  submitDisabled: { backgroundColor: '#9CA3AF' },
  submitText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
