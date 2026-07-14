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
import {
  blockingReason,
  isUsableBatch,
  loadBatches,
  lookupBatch,
  type Batch,
} from '@/lib/batches';
import { loadProducts, type Product } from '@/lib/catalog';
import { findEquipmentByCode, loadEquipment, type Equipment } from '@/lib/equipment';
import { getErrorMessage, isNetworkError } from '@/lib/errors';
import { useOnlineStatus } from '@/hooks/use-online-status';
import {
  buildTransformation,
  createTransformation,
  isTransformableUnit,
  quantityError,
  transformationUnits,
} from '@/lib/transformation';
import { BRAND, HEADER_GRADIENT } from '@/lib/theme';
import { toastError, toastMessage } from '@/lib/toast';

interface ParentInput {
  batch: Batch;
  quantity: string;
  exhausted: boolean;
}

type Scanning = 'cuve' | 'lot' | null;

export default function TransformationScreen() {
  const insets = useSafeAreaInsets();
  const online = useOnlineStatus();

  const [products, setProducts] = useState<Product[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [loading, setLoading] = useState(true);

  const [cuve, setCuve] = useState<Equipment | null>(null);
  const [parents, setParents] = useState<ParentInput[]>([]);
  const [productId, setProductId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [unit, setUnit] = useState('');
  const [scanning, setScanning] = useState<Scanning>(null);
  const [isChecking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  // Un state se lit trop tard : deux appuis dans le même tick passeraient tous les deux.
  const submitting = useRef(false);

  useEffect(() => {
    // Un échec partiel ne doit pas jeter ce qui est arrivé. Avec un `Promise.all`, une seule
    // route en panne vidait les trois catalogues — et l'écran répondait « lot inconnu » à des
    // lots parfaitement existants. L'opérateur en aurait conclu que son étiquette était fausse.
    Promise.allSettled([loadProducts(), loadBatches(), loadEquipment()])
      .then(([loadedProducts, loadedBatches, loadedEquipment]) => {
        if (loadedProducts.status === 'fulfilled') setProducts(loadedProducts.value);
        if (loadedBatches.status === 'fulfilled') setBatches(loadedBatches.value);
        if (loadedEquipment.status === 'fulfilled') setEquipment(loadedEquipment.value);

        if ([loadedProducts, loadedBatches, loadedEquipment].some((r) => r.status === 'rejected')) {
          toastMessage(
            'Données incomplètes',
            "Une partie du catalogue n'a pas pu être chargée. Rechargez l'écran avant de scanner."
          );
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const units = transformationUnits([
    ...products.map((product) => product.unite_reference),
    ...batches.map((batch) => batch.unite_code),
  ]);

  // La vérification d'un lot passe par le réseau, et l'opérateur peut annuler pendant ce temps.
  // Chaque scan a donc un numéro de session : fermer la modale l'invalide. Sans ça, un lot annulé
  // s'ajoutait quand même une seconde plus tard — et le `finally` refermait la modale de la CUVE,
  // ouverte entre-temps, sous les doigts de l'opérateur.
  const scanSession = useRef(0);
  const cancelScan = () => {
    scanSession.current += 1;
    setChecking(false);
    setScanning(null);
  };

  const handleScan = async (code: string) => {
    const target = scanning;

    if (target === 'cuve') {
      setScanning(null);

      if (equipment.length === 0) {
        toastMessage('Matériels indisponibles', "Rechargez l'écran : la liste n'a pas été chargée.");
        return;
      }

      const found = findEquipmentByCode(code, equipment);

      if (!found) {
        toastMessage('Matériel inconnu', 'Ce code ne correspond à aucun matériel.');
        return;
      }
      if (found.type.toUpperCase() !== 'CUVE') {
        toastMessage(`${found.nom} n'est pas une cuve`, 'Une transformation se fait dans une cuve.');
        return;
      }

      setCuve(found);
      return;
    }

    const session = (scanSession.current += 1);
    setChecking(true);

    // Le catalogue local ne porte que les 100 lots les plus récents : c'est le serveur qui tranche.
    // Sortir ici sur `batches.length === 0` (comme avant) court-circuitait le seul recours dans la
    // situation MÊME où il est indispensable.
    const found = await lookupBatch(code, batches);

    // L'opérateur a fermé la modale (ou relancé un scan) : ce résultat ne l'intéresse plus. Ne rien
    // ajouter, ne rien dire, et surtout ne pas refermer une modale qui ne nous appartient plus.
    if (scanSession.current !== session) return;

    setChecking(false);
    setScanning(null);

    if (found.kind === 'unverifiable') {
      // « Lot inconnu » serait un mensonge : on n'a pas pu demander. Une transformation exige de
      // toute façon le réseau (le bouton d'envoi est désactivé hors ligne) : rien n'est perdu.
      toastMessage(
        'Lot non vérifié',
        `${getErrorMessage(found.error)} Impossible de confirmer que ce lot existe.`
      );
      return;
    }

    if (found.kind === 'unknown') {
      toastMessage('Lot inconnu', 'Ce code ne correspond à aucun lot de votre organisation.');
      return;
    }

    const { batch } = found;

    // La garde sanitaire, annoncée DEVANT la cuve : un lot en quarantaine ou périmé ne doit jamais
    // entrer en production. Le serveur le refuserait, mais dix minutes trop tard.
    if (!isUsableBatch(batch)) {
      toastMessage(
        `Lot ${batch.lot_number} inutilisable`,
        blockingReason(batch) ?? 'Ce lot ne peut pas entrer en production.'
      );
      return;
    }

    // `unite_code` est du texte libre à la réception : un lot peut naître en « U », que l'enum du
    // serveur ignore. L'accepter ici le laisserait s'ajouter en vert, puis griser le bouton d'envoi
    // à vie sans jamais dire lequel des lots est en cause.
    if (!isTransformableUnit(batch.unite_code)) {
      toastMessage(
        `Lot ${batch.lot_number} non transformable`,
        `Unité « ${batch.unite_code} » inconnue du serveur. Corrigez l'unité du produit d'abord.`
      );
      return;
    }

    if (parents.some((parent) => parent.batch.id === batch.id)) {
      toastMessage('Lot déjà ajouté', `${batch.lot_number} est déjà dans la liste.`);
      return;
    }

    setParents((current) => [...current, { batch, quantity: '', exhausted: false }]);
  };

  const updateParent = (id: string, changes: Partial<ParentInput>) => {
    setParents((current) =>
      current.map((parent) => (parent.batch.id === id ? { ...parent, ...changes } : parent))
    );
  };

  const payload = buildTransformation({
    productId,
    equipmentId: cuve?.id ?? '',
    quantity,
    unit,
    inputs: parents.map((parent) => ({
      batchId: parent.batch.id,
      quantity: parent.quantity,
      unit: parent.batch.unite_code,
      exhausted: parent.exhausted,
      available: Number(parent.batch.quantite_actuelle),
    })),
  });

  const producedIssue = quantity === '' ? null : quantityError(quantity);

  const handleSubmit = async () => {
    if (!payload || submitting.current) return;
    submitting.current = true;
    setSaving(true);

    try {
      await createTransformation(payload);

      Toast.show({
        type: 'success',
        text1: 'Transformation enregistrée',
        text2: 'Le lot produit a été créé et relié à ses composants.',
      });
      router.back();
    } catch (error: unknown) {
      // Une coupure réseau ne prouve PAS que le serveur a refusé : il a pu commiter avant que la
      // réponse se perde. Annoncer un échec pousserait l'opérateur à ressaisir — et à décompter
      // ses lots parents une seconde fois. L'endpoint n'a aucune clé d'idempotence.
      if (isNetworkError(error)) {
        toastMessage(
          'Envoi interrompu',
          'Statut inconnu : la transformation a peut-être été enregistrée. Vérifiez vos lots avant de la ressaisir.'
        );
      } else {
        toastError('Transformation refusée', error);
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
        <Text style={styles.headerTitle}>Transformation</Text>
      </LinearGradient>

      {/* Contrairement à la réception, la transformation n'est PAS mise en file : elle
          engage des lots dont l'état doit être vérifié par le serveur au moment même. */}
      {!online && (
        <Text style={styles.offline}>
          Hors réseau : une transformation ne peut pas être enregistrée pour plus tard.
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
            <View style={styles.field}>
              <Text style={styles.label}>1 · La cuve</Text>
              <TouchableOpacity
                style={cuve ? styles.selected : styles.scanButton}
                onPress={() => setScanning('cuve')}
                activeOpacity={0.8}
              >
                <Ionicons
                  name={cuve ? 'flask' : 'qr-code-outline'}
                  size={18}
                  color={BRAND.primary}
                />
                <Text style={cuve ? styles.selectedText : styles.scanButtonText}>
                  {cuve ? `${cuve.nom} · ${cuve.lieu.nom}` : 'Scanner la cuve'}
                </Text>
              </TouchableOpacity>
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>2 · Les lots utilisés</Text>

              {parents.map((parent) => {
                const issue =
                  parent.quantity === ''
                    ? null
                    : quantityError(parent.quantity, Number(parent.batch.quantite_actuelle));

                return (
                <View key={parent.batch.id} style={styles.parent}>
                  <View style={styles.parentHeader}>
                    <View style={styles.flex}>
                      <Text style={styles.parentTitle}>{parent.batch.produit.nom}</Text>
                      <Text style={styles.parentSubtitle}>
                        Lot {parent.batch.lot_number} · {parent.batch.quantite_actuelle}{' '}
                        {parent.batch.unite_code} disponibles
                      </Text>
                    </View>
                    <TouchableOpacity
                      onPress={() =>
                        setParents((current) =>
                          current.filter((item) => item.batch.id !== parent.batch.id)
                        )
                      }
                      hitSlop={10}
                    >
                      <Ionicons name="close-circle" size={20} color="#9CA3AF" />
                    </TouchableOpacity>
                  </View>

                  <View style={styles.parentRow}>
                    <TextInput
                      style={[styles.input, styles.flex]}
                      value={parent.quantity}
                      onChangeText={(value) => updateParent(parent.batch.id, { quantity: value })}
                      placeholder={`Quantité prélevée (${parent.batch.unite_code})`}
                      keyboardType="decimal-pad"
                    />
                    <TouchableOpacity
                      style={[styles.chip, parent.exhausted && styles.chipOn]}
                      onPress={() =>
                        updateParent(parent.batch.id, { exhausted: !parent.exhausted })
                      }
                      activeOpacity={0.8}
                    >
                      <Text style={[styles.chipText, parent.exhausted && styles.chipTextOn]}>
                        Épuisé
                      </Text>
                    </TouchableOpacity>
                  </View>

                  {/* Le stock disponible est affiché juste au-dessus : laisser taper au-delà sans
                      rien dire, pour que le serveur réponde ensuite avec l'UUID brut du lot, est
                      un refus que l'opérateur ne peut pas exploiter. */}
                  {issue && <Text style={styles.error}>{issue}</Text>}
                </View>
                );
              })}

              <TouchableOpacity
                style={styles.scanButton}
                onPress={() => setScanning('lot')}
                activeOpacity={0.8}
              >
                <Ionicons name="qr-code-outline" size={18} color={BRAND.primary} />
                <Text style={styles.scanButtonText}>Scanner un lot</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.label}>3 · Le produit obtenu</Text>

            <OptionPicker
              label="Produit fini"
              options={products.map((product) => ({ value: product.id, label: product.nom }))}
              selected={productId}
              onSelect={setProductId}
            />

            <View style={styles.field}>
              <Text style={styles.label}>Quantité produite</Text>
              <TextInput
                style={styles.input}
                value={quantity}
                onChangeText={setQuantity}
                placeholder="0"
                keyboardType="decimal-pad"
              />
              {producedIssue && <Text style={styles.error}>{producedIssue}</Text>}
            </View>

            <OptionPicker
              label="Unité"
              options={units.map((value) => ({ value, label: value }))}
              selected={unit}
              onSelect={setUnit}
            />

            <TouchableOpacity
              style={[styles.submit, (!payload || !online) && styles.submitDisabled]}
              onPress={handleSubmit}
              disabled={!payload || saving || !online}
              activeOpacity={0.85}
            >
              {saving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.submitText}>Enregistrer la transformation</Text>
              )}
            </TouchableOpacity>

            {/* Le process EXIGE que le lot enfant naisse en quarantaine jusqu'au contrôle
                qualité, mais l'API le crée en stock : ne pas l'annoncer à l'opérateur tant
                que ce n'est pas vrai. Voir l'audit des trous fonctionnels (barrière qualité). */}
            <Text style={styles.notice}>
              Les lots utilisés sont décomptés, et le lot produit leur reste relié pour la
              traçabilité.
            </Text>
          </ScrollView>
        </KeyboardAvoidingView>
      )}

      <CodeScanner
        visible={scanning !== null}
        // Rattaché à la CIBLE : sinon le scanner de la cuve afficherait « Vérification du lot… ».
        busy={isChecking && scanning === 'lot'}
        title={scanning === 'cuve' ? 'Scanner la cuve' : 'Scanner un lot'}
        hint={
          scanning === 'cuve'
            ? "Placez l'étiquette de la cuve dans le cadre."
            : "Placez l'étiquette du lot dans le cadre."
        }
        onClose={cancelScan}
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
  selected: {
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
  selectedText: { fontSize: 14, fontWeight: '600', color: '#111827' },
  parent: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    padding: 12,
    gap: 10,
  },
  parentHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  parentTitle: { fontSize: 14, fontWeight: '600', color: '#111827' },
  parentSubtitle: { fontSize: 12, color: '#6B7280' },
  parentRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  error: { fontSize: 12, color: '#DC2626', fontWeight: '500' },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  chipOn: { backgroundColor: BRAND.primary, borderColor: BRAND.primary },
  chipText: { fontSize: 13, color: '#374151', fontWeight: '500' },
  chipTextOn: { color: '#fff', fontWeight: '700' },
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
