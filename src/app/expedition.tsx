import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
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

import { CodeScanner } from '@/components/code-scanner';
import { OptionPicker } from '@/components/option-picker';
import { useOnlineStatus } from '@/hooks/use-online-status';
import {
  blockingReason,
  findBatchByCode,
  isUsableBatch,
  loadBatches,
  type Batch,
} from '@/lib/batches';
import { isNetworkError } from '@/lib/errors';
import {
  buildShipment,
  createShipment,
  loadCustomers,
  shipmentQuantityError,
  type Customer,
} from '@/lib/shipment';
import { BRAND, HEADER_GRADIENT } from '@/lib/theme';
import { toastError, toastMessage } from '@/lib/toast';

interface LotLine {
  batch: Batch;
  quantity: string;
}

export default function ExpeditionScreen() {
  const insets = useSafeAreaInsets();
  const online = useOnlineStatus();

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [loading, setLoading] = useState(true);

  const [customerId, setCustomerId] = useState('');
  const [shipmentId, setShipmentId] = useState('');
  const [carrier, setCarrier] = useState('');
  const [address, setAddress] = useState('');
  const [lots, setLots] = useState<LotLine[]>([]);
  const [scanning, setScanning] = useState(false);
  const [saving, setSaving] = useState(false);
  // Un state se lit trop tard : deux appuis dans le même tick passeraient tous les deux.
  const submitting = useRef(false);

  useEffect(() => {
    // Un échec partiel ne doit pas jeter ce qui est arrivé : avec un `Promise.all`, la panne
    // d'une seule route vidait les deux catalogues, et tout scan répondait « lot inconnu ».
    Promise.allSettled([loadCustomers(), loadBatches()])
      .then(([loadedCustomers, loadedBatches]) => {
        if (loadedCustomers.status === 'fulfilled') setCustomers(loadedCustomers.value);
        if (loadedBatches.status === 'fulfilled') setBatches(loadedBatches.value);

        if ([loadedCustomers, loadedBatches].some((result) => result.status === 'rejected')) {
          toastMessage(
            'Données incomplètes',
            "Une partie du catalogue n'a pas pu être chargée. Rechargez l'écran avant de scanner."
          );
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const handleScan = (code: string) => {
    setScanning(false);

    if (batches.length === 0) {
      toastMessage('Lots indisponibles', "Rechargez l'écran : la liste des lots n'a pas été chargée.");
      return;
    }

    const batch = findBatchByCode(code, batches);

    if (!batch) {
      toastMessage('Lot inconnu', 'Ce code ne correspond à aucun lot de votre organisation.');
      return;
    }

    // La garde sanitaire de sortie d'usine : un lot bloqué (non-conformité, excursion froid,
    // rappel) ne doit JAMAIS quitter le stock. L'opérateur l'apprend devant le camion.
    if (!isUsableBatch(batch)) {
      toastMessage(
        `Lot ${batch.lot_number} non expédiable`,
        blockingReason(batch) ?? 'Ce lot ne peut pas quitter le stock.'
      );
      return;
    }

    if (lots.some((line) => line.batch.id === batch.id)) {
      toastMessage('Lot déjà ajouté', `${batch.lot_number} est déjà dans la liste.`);
      return;
    }

    setLots((current) => [...current, { batch, quantity: '' }]);
  };

  const payload = buildShipment({
    customerId,
    shipmentId,
    carrier,
    address,
    lots: lots.map((line) => ({
      batchId: line.batch.id,
      quantity: line.quantity,
      available: Number(line.batch.quantite_actuelle),
    })),
  });

  const handleSubmit = async () => {
    if (!payload || submitting.current) return;
    submitting.current = true;
    setSaving(true);

    try {
      await createShipment(payload);

      Toast.show({
        type: 'success',
        text1: 'Expédition enregistrée',
        text2: 'Les lots expédiés sont désormais reliés à ce client.',
      });
      router.back();
    } catch (error: unknown) {
      // Une coupure réseau ne prouve pas un refus : le serveur a pu commiter. Le n° de transport
      // étant unique en base, une ressaisie à l'identique serait rejetée — mais l'opérateur doit
      // savoir qu'il ne doit PAS en inventer un nouveau pour « réessayer ».
      if (isNetworkError(error)) {
        toastMessage(
          'Envoi interrompu',
          "Statut inconnu : l'expédition a peut-être été enregistrée. Vérifiez avant de la ressaisir."
        );
      } else {
        toastError('Expédition refusée', error);
      }

      submitting.current = false;
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
        <Text style={styles.headerTitle}>Expédition</Text>
      </LinearGradient>

      {!online && (
        <Text style={styles.offline}>
          Hors réseau : une expédition ne peut pas être enregistrée pour plus tard.
        </Text>
      )}

      {loading ? (
        <ActivityIndicator style={styles.loader} size="large" color={BRAND.primary} />
      ) : (
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
            <OptionPicker
              label="Client"
              options={customers.map((customer) => ({
                value: customer.id,
                label: customer.nom_enseigne,
              }))}
              selected={customerId}
              onSelect={(id) => {
                setCustomerId(id);
                // L'adresse du client est connue : la retaper serait une faute de frappe en
                // puissance sur le champ qui dit OÙ le produit est parti.
                const customer = customers.find((item) => item.id === id);
                if (customer) setAddress(customer.adresse_livraison);
              }}
            />

            <View style={styles.field}>
              <Text style={styles.label}>N° de transport</Text>
              <TextInput
                style={styles.input}
                value={shipmentId}
                onChangeText={setShipmentId}
                placeholder="EXP-2026-001"
                autoCapitalize="characters"
                maxLength={100}
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Transporteur</Text>
              <TextInput
                style={styles.input}
                value={carrier}
                onChangeText={setCarrier}
                placeholder="Transports Martin"
                maxLength={100}
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Adresse de destination</Text>
              <TextInput
                style={styles.input}
                value={address}
                onChangeText={setAddress}
                placeholder="12 rue des Halles, 75001 Paris"
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Lots chargés</Text>

              {lots.map((line) => {
                const issue =
                  line.quantity === ''
                    ? null
                    : shipmentQuantityError(line.quantity, Number(line.batch.quantite_actuelle));

                return (
                <View key={line.batch.id} style={styles.lot}>
                  <View style={styles.lotHeader}>
                    <View style={styles.flex}>
                      <Text style={styles.lotTitle}>{line.batch.produit.nom}</Text>
                      <Text style={styles.lotSubtitle}>
                        Lot {line.batch.lot_number} · {line.batch.quantite_actuelle}{' '}
                        {line.batch.unite_code} en stock
                      </Text>
                    </View>
                    <TouchableOpacity
                      onPress={() =>
                        setLots((current) => current.filter((item) => item.batch.id !== line.batch.id))
                      }
                      hitSlop={10}
                    >
                      <Ionicons name="close-circle" size={20} color="#9CA3AF" />
                    </TouchableOpacity>
                  </View>

                  <TextInput
                    style={styles.input}
                    value={line.quantity}
                    onChangeText={(value) =>
                      setLots((current) =>
                        current.map((item) =>
                          item.batch.id === line.batch.id ? { ...item, quantity: value } : item
                        )
                      )
                    }
                    placeholder={`Quantité expédiée (${line.batch.unite_code})`}
                    keyboardType="decimal-pad"
                  />

                  {issue && <Text style={styles.error}>{issue}</Text>}
                </View>
                );
              })}

              <TouchableOpacity
                style={styles.scanButton}
                onPress={() => setScanning(true)}
                activeOpacity={0.8}
              >
                <Ionicons name="qr-code-outline" size={18} color={BRAND.primary} />
                <Text style={styles.scanButtonText}>Scanner un lot</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={[styles.submit, (!payload || !online) && styles.submitDisabled]}
              onPress={handleSubmit}
              disabled={!payload || saving || !online}
              activeOpacity={0.85}
            >
              {saving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.submitText}>Enregistrer l&apos;expédition</Text>
              )}
            </TouchableOpacity>

            <Text style={styles.notice}>
              C&apos;est ce lien lot → client qui permet, en cas de rappel, de savoir exactement
              qui a reçu quoi.
            </Text>
          </ScrollView>
        </KeyboardAvoidingView>
      )}

      <CodeScanner
        visible={scanning}
        title="Scanner un lot"
        hint="Placez l'étiquette du lot chargé dans le cadre."
        onClose={() => setScanning(false)}
        onScan={handleScan}
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
  offline: {
    backgroundColor: '#FEF3C7',
    color: '#B45309',
    fontSize: 12,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  loader: { marginTop: 48 },
  form: { padding: 20, gap: 18, paddingBottom: 48 },
  field: { gap: 8 },
  label: { fontSize: 13, fontWeight: '700', color: '#374151' },
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
  lot: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    padding: 12,
    gap: 10,
  },
  lotHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  lotTitle: { fontSize: 14, fontWeight: '600', color: '#111827' },
  lotSubtitle: { fontSize: 12, color: '#6B7280' },
  error: { fontSize: 12, color: '#DC2626', fontWeight: '500' },
  scanButton: {
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
  scanButtonText: { fontSize: 14, fontWeight: '600', color: BRAND.primary },
  submit: {
    backgroundColor: BRAND.primary,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  submitDisabled: { backgroundColor: '#9CA3AF' },
  submitText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  notice: { fontSize: 12, color: '#6B7280', textAlign: 'center' },
});
