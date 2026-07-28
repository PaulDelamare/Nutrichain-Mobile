import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
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
import { ConfirmDialog } from '@/components/confirm-dialog';
import { OptionPicker } from '@/components/option-picker';
import { loadProducts, loadSuppliers, type Product, type Supplier } from '@/lib/catalog';
import {
  findEquipmentByCode,
  isStorageEquipment,
  loadEquipment,
  type Equipment,
} from '@/lib/equipment';
import { LOT_NUMBER_MAX_LENGTH, normalizeGtin, parseScannedCode } from '@/lib/gs1';
import { clearReceiptDraft, loadReceiptDraft, saveReceiptDraft } from '@/lib/draft';
import { enqueueReceipt } from '@/lib/sync/queue';
import {
  SHIPMENT_ID_MAX_LENGTH,
  buildReceipt,
  receiptQuantityError,
  receiptShipmentError,
} from '@/lib/sync/receipt';
import { syncPendingOperations } from '@/lib/sync/sync';
import type { ReceiptPayload } from '@/lib/sync/types';
import { BRAND, HEADER_GRADIENT } from '@/lib/theme';
import { toastError } from '@/lib/toast';
import { AccessDenied } from '@/components/access-denied';
import { useAuthStatus } from '@/hooks/use-auth-status';
import { useCurrentUser } from '@/hooks/use-current-user';
import { writeBlockedReason } from '@/lib/roles';

// Libellés MÉTIER, pas les codes d'énum : un opérateur ne doit pas cocher « NONCONFORME » comme
// une case anodine. Deux de ces statuts — ALERTE et NONCONFORME — créent le lot en quarantaine
// (BLOQUE) côté serveur ; on le signale (`quarantine`) pour l'annoncer avant d'enregistrer.
// « CONFORME » est retiré : le serveur le traite comme OK, c'était un quatrième choix sans effet.
const CONTROL_OPTIONS: {
  value: ReceiptPayload['statut_controle'];
  label: string;
  quarantine: boolean;
}[] = [
  { value: 'OK', label: 'Conforme', quarantine: false },
  { value: 'ALERTE', label: 'Alerte sanitaire', quarantine: true },
  { value: 'NONCONFORME', label: 'Non conforme', quarantine: true },
];

/** Statuts qui placent le lot en quarantaine à la réception. Miroir de `QUARANTINE_RECEIPT_CONTROLS`
 *  côté API : afficher une conséquence différente de celle réellement appliquée mentirait à l'écran. */
const QUARANTINE_STATUSES = new Set(
  CONTROL_OPTIONS.filter((option) => option.quarantine).map((option) => option.value)
);

export default function ReceptionScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useCurrentUser();
  const { code } = useLocalSearchParams<{ code?: string }>();

  // Le scan doit REMPLIR le formulaire, pas y coller l'URL brute. On décode l'étiquette (Digital
  // Link ou element string) une fois pour en tirer produit (GTIN), lot (AI 10), DLC (AI 17), SSCC.
  // `isDecoded` distingue un vrai code GS1 d'un code nu : ce dernier garde son comportement d'origine
  // (il remplit le n° d'expédition) — on ne réinterprète pas ce qu'on n'a pas su décoder.
  const scanned = useMemo(() => parseScannedCode(code ?? ''), [code]);
  const isDecoded = scanned.gtin !== null || scanned.sscc !== null || scanned.expiry !== null;
  const decodedExpiry = isDecoded ? scanned.expiry : null;

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [loading, setLoading] = useState(true);

  const [supplierId, setSupplierId] = useState('');
  const [productId, setProductId] = useState('');
  // SSCC scanné → n° d'expédition. Pour notre étiquette (GS1 sans SSCC), on laisse VIDE plutôt que
  // d'y coller l'URL ; un code nu (non GS1) conserve l'ancien comportement.
  const [shipmentId, setShipmentId] = useState(scanned.sscc ?? (isDecoded ? '' : code ?? ''));
  const [lotNumber, setLotNumber] = useState(isDecoded ? scanned.lotNumber ?? '' : '');
  const [quantity, setQuantity] = useState('');
  const [unit, setUnit] = useState('');
  const [status, setStatus] = useState<ReceiptPayload['statut_controle']>('OK');
  // L'emplacement SCANNÉ. L'emplacement effectif est dérivé plus bas (scan > brouillon).
  const [scannedLocation, setScannedLocation] = useState<Equipment | null>(null);
  const [scanningLocation, setScanningLocation] = useState(false);
  const [saving, setSaving] = useState(false);
  // Le statut choisi met-il le lot en quarantaine ? Décide de l'avertissement et de la confirmation.
  const [confirmingQuarantine, setConfirmingQuarantine] = useState(false);
  // L'emplacement restauré depuis le brouillon : un identifiant, tant que le catalogue des
  // matériels n'est pas chargé et qu'on ne peut pas le retrouver.
  const [restoredLocationId, setRestoredLocationId] = useState<string | null>(null);
  const isQuarantineStatus = QUARANTINE_STATUSES.has(status);

  // Les unités viennent des produits, jamais d'une liste codée en dur : elles sont des
  // clés étrangères côté serveur, et « KG » n'y existe pas — c'est « kg ». Une constante
  // locale ferait accepter la réception puis rejeter en silence à la synchronisation.
  const units = [...new Set(products.map((product) => product.unite_reference))];

  // Produit reconnu par le GTIN scanné : DÉRIVÉ au rendu, jamais stocké en état (le stocker
  // imposerait de le resynchroniser à la main dans un effet). Il sert de valeur PAR DÉFAUT tant que
  // l'opérateur n'a pas choisi lui-même — d'où `productId || ...` plus bas.
  const gtinProduct = useMemo(
    () =>
      scanned.gtin
        ? products.find((product) => normalizeGtin(product.code_gtin) === scanned.gtin) ?? null
        : null,
    [products, scanned]
  );
  const effectiveProductId = productId || gtinProduct?.id || '';
  const effectiveUnit = unit || gtinProduct?.unite_reference || '';
  // NE PAS MENTIR : GTIN scanné mais absent du catalogue CHARGÉ → on le signale, sans rien
  // pré-sélectionner. (Catalogue non chargé = on ne sait pas encore : aucun message.)
  const productUnmatched = scanned.gtin !== null && products.length > 0 && gtinProduct === null;

  useEffect(() => {
    // ⚠️ `allSettled`, jamais `all`. Un `Promise.all` fait rejeter la promesse ENTIÈRE dès qu'un
    // seul appel échoue : un 403 sur les fournisseurs (le cas d'un `operator`, à qui l'API réserve
    // cette route) emportait les produits, pourtant revenus en 200. L'opérateur voyait « Catalogue
    // indisponible » et DEUX listes vides — il ne pouvait plus rien réceptionner.
    //
    // Un échec sur une liste ne doit pas emporter celles qui ont répondu. La transformation et
    // l'expédition l'avaient déjà compris ; la réception, non.
    void Promise.allSettled([loadSuppliers(), loadProducts()])
      .then(([suppliersResult, productsResult]) => {
        if (suppliersResult.status === 'fulfilled') setSuppliers(suppliersResult.value);
        if (productsResult.status === 'fulfilled') setProducts(productsResult.value);

        // On DIT ce qui manque, précisément — « catalogue indisponible » ne dit ni quoi, ni pourquoi.
        const manquants = [
          suppliersResult.status === 'rejected' ? 'fournisseurs' : null,
          productsResult.status === 'rejected' ? 'produits' : null,
        ].filter(Boolean);

        if (manquants.length > 0) {
          const cause =
            suppliersResult.status === 'rejected' ? suppliersResult.reason : productsResult.status === 'rejected' ? productsResult.reason : null;
          toastError(`Liste des ${manquants.join(' et ')} indisponible`, cause);
        }
      })
      .finally(() => setLoading(false));

    loadEquipment()
      .then(setEquipment)
      .catch(() => setEquipment([]));
  }, []);

  // ⚠️ Restauration du brouillon. Une session qui expire pendant la saisie — un simple
  // rafraîchissement de fond qui prend un 401 — renvoie l'opérateur à l'écran de connexion et
  // DÉTRUIT tout ce qu'il a tapé sur le quai. Il retrouve maintenant sa saisie en revenant.
  //
  // Un code fraîchement scanné a la priorité : il exprime une intention NOUVELLE, alors que le
  // brouillon est un souvenir. Le contraire ferait rouvrir une vieille saisie par-dessus le lot que
  // l'opérateur vient de scanner.
  useEffect(() => {
    if (code) return;

    let alive = true;
    loadReceiptDraft()
      .then((draft) => {
        if (!alive || !draft) return;
        setSupplierId(draft.supplierId);
        setProductId(draft.productId);
        setShipmentId(draft.shipmentId);
        setLotNumber(draft.lotNumber);
        setQuantity(draft.quantity);
        setUnit(draft.unit);
        setStatus(draft.status as ReceiptPayload['statut_controle']);
        setRestoredLocationId(draft.locationId);
      })
      .catch(() => undefined);

    return () => {
      alive = false;
    };
  }, [code]);

  // L'emplacement est un OBJET du catalogue : le brouillon n'en garde que l'identifiant, et on ne
  // peut le rétablir qu'une fois les matériels chargés. On le DÉRIVE plutôt que de le recopier dans
  // un état — un effet qui synchronise deux états dit la même chose deux fois, et finit par se
  // contredire. Un scan reste prioritaire : c'est une intention nouvelle, le brouillon un souvenir.
  const location =
    scannedLocation ?? equipment.find((item) => item.id === restoredLocationId) ?? null;

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

    setScannedLocation(found);
  };

  const receipt = buildReceipt({
    supplierId,
    productId: effectiveProductId,
    shipmentId,
    quantity,
    unit: effectiveUnit,
    status,
    equipmentId: location?.id,
    lotNumber,
    expiry: decodedExpiry ?? undefined,
  });

  // Le brouillon suit la saisie. On l'écrit à chaque changement — c'est une écriture SQLite locale,
  // pas un appel réseau — mais jamais un formulaire VIDE : ça effacerait le brouillon qu'on vient
  // tout juste de restaurer, au premier rendu.
  useEffect(() => {
    const vide =
      !supplierId && !productId && !shipmentId && !lotNumber && !quantity && !location;
    if (vide) return;

    void saveReceiptDraft({
      supplierId,
      productId,
      shipmentId,
      lotNumber,
      quantity,
      unit,
      status,
      locationId: location?.id ?? null,
    }).catch(() => undefined);
  }, [supplierId, productId, shipmentId, lotNumber, quantity, unit, status, location]);

  // Le message exact sous le champ fautif, plutôt qu'un bouton grisé muet. Pas de harcèlement :
  // un champ encore vide n'est pas une faute — on n'affiche qu'une fois quelque chose tapé.
  const quantityIssue = quantity === '' ? null : receiptQuantityError(quantity);
  const shipmentIssue = shipmentId === '' ? null : receiptShipmentError(shipmentId);

  // Écrit réellement la réception dans la file locale (chemin nominal, ou après confirmation de
  // quarantaine). Ferme la confirmation d'abord : elle a joué son rôle.
  const persistReceipt = async () => {
    setConfirmingQuarantine(false);
    if (!receipt || saving) return;
    setSaving(true);

    try {
      // Enregistrée localement d'abord : un scan ne doit jamais dépendre du réseau.
      await enqueueReceipt(receipt);

      // La saisie est en file : le brouillon a fait son office. Le garder le ferait resurgir
      // par-dessus la réception suivante.
      await clearReceiptDraft().catch(() => undefined);

      Toast.show({
        type: 'success',
        // ⚠️ Ne PAS promettre « dès que le réseau reviendra » : l'écoute réseau meurt avec l'app,
        // il n'y a pas de tâche de fond. Un opérateur qui ferme l'app verrait sa file dormir sans
        // que rien ne le prévienne. On conditionne honnêtement l'envoi à l'application ouverte.
        text1: 'Réception enregistrée',
        text2: 'Elle partira dès le retour du réseau, l’application ouverte.',
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

  const handleSubmitPress = () => {
    if (!receipt || saving) return;
    // Mettre un lot en quarantaine est une décision sanitaire lourde : on NOMME la conséquence et
    // on la fait confirmer avant d'écrire. Sinon elle partait sur un simple effleurement de puce.
    if (isQuarantineStatus) {
      setConfirmingQuarantine(true);
      return;
    }
    void persistReceipt();
  };

  // (issue #71) Garde À L'ENTRÉE, pas seulement sur l'accueil : sur le web, `/reception` s'ouvre
  // par URL directe. `null` (rôle inconnu, hors ligne) laisse passer — cf. `canWrite`.
  // `authentifie` distingue « rôle inconnu hors ligne » (permissif) de « aucune session »
  // (jamais permissif) — cf. #102.
  const authentifie = useAuthStatus() === 'authenticated';
  const writeBlocked = writeBlockedReason(user?.role ?? null, authentifie);
  if (writeBlocked) {
    return <AccessDenied title="Réception" reason={writeBlocked} />;
  }

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

            {/* Un sélecteur vide est MUET : l'opérateur voit un bouton gris sans savoir pourquoi.
                Sans fournisseur, la réception ne peut simplement pas être enregistrée — on le dit. */}
            {suppliers.length === 0 && (
              <Text style={styles.missing}>
                Aucun fournisseur accessible. La réception ne peut pas être enregistrée sans
                fournisseur — vérifiez votre connexion, ou vos droits d’accès à cette liste.
              </Text>
            )}

            <View style={styles.field}>
              <OptionPicker
                label="Produit"
                options={products.map((p) => ({ value: p.id, label: p.nom }))}
                selected={effectiveProductId}
                onSelect={(id) => {
                  setProductId(id);
                  const product = products.find((p) => p.id === id);
                  if (product) setUnit(product.unite_reference);
                }}
              />

              {/* NE PAS MENTIR : GTIN scanné inconnu du catalogue → aucune sélection, on le dit. */}
              {productUnmatched && (
                <Text style={styles.warning}>
                  Produit du code-barres introuvable dans le catalogue — sélectionnez-le manuellement.
                </Text>
              )}
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>N° de lot (fournisseur)</Text>
              <TextInput
                style={styles.input}
                value={lotNumber}
                onChangeText={setLotNumber}
                placeholder="260714-ABC123"
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={LOT_NUMBER_MAX_LENGTH}
              />

              {/* DLC lue sur l'étiquette (AI 17), affichée SEULEMENT si décodée — jamais une date
                  inventée. Non éditable : une DLC est une donnée sanitaire, pas un champ à taper. */}
              {decodedExpiry && (
                <Text style={styles.dlcInfo}>DLC lue sur l&apos;étiquette : {decodedExpiry}</Text>
              )}
            </View>

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
              {shipmentIssue && <Text style={styles.error}>{shipmentIssue}</Text>}
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
              {quantityIssue && <Text style={styles.error}>{quantityIssue}</Text>}
            </View>

            <OptionPicker
              label="Unité"
              options={units.map((u) => ({ value: u, label: u }))}
              selected={effectiveUnit}
              onSelect={setUnit}
            />

            <View style={styles.field}>
              <OptionPicker
                label="Contrôle qualité à la réception"
                options={CONTROL_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                selected={status}
                onSelect={(value) => setStatus(value as ReceiptPayload['statut_controle'])}
              />

              {/* La conséquence est dite AVANT de valider : l'opérateur voit, dès la sélection, que
                  ce statut isolera le lot — pas seulement au moment d'appuyer sur Enregistrer. */}
              {isQuarantineStatus && (
                <Text style={styles.quarantineNotice}>
                  ⚠️ Ce statut placera le lot en quarantaine : créé bloqué, ni transformable ni
                  expédiable tant qu&apos;un contrôle qualité ne l&apos;aura pas levé.
                </Text>
              )}
            </View>

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
              onPress={handleSubmitPress}
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

      <CodeScanner
        visible={scanningLocation}
        title="Scanner l'emplacement"
        hint="Placez l'étiquette du frigo, du congélateur ou de l'étagère dans le cadre."
        onClose={() => setScanningLocation(false)}
        onScan={handleLocationScan}
      />

      {/* Dernière porte avant d'écrire une mise en quarantaine : ConfirmDialog, pas Alert.alert
          (no-op sur le web, où se fait la démo). Le bouton rouge dit qu'on isole un lot. */}
      <ConfirmDialog
        visible={confirmingQuarantine}
        title="Mettre ce lot en quarantaine ?"
        message="Ce lot sera créé en quarantaine (BLOQUÉ) : ni transformation ni expédition possibles tant qu'un contrôle qualité ne l'aura pas levé."
        confirmLabel="Mettre en quarantaine"
        destructive
        onCancel={() => setConfirmingQuarantine(false)}
        onConfirm={() => void persistReceipt()}
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
  missing: { fontSize: 12, color: '#B45309', lineHeight: 17, marginTop: -8, marginBottom: 4 },
  // Le message sous le champ fautif, comme transfo/expédition : rouge, dire pourquoi le bouton grise.
  error: { fontSize: 12, color: '#DC2626', fontWeight: '500' },
  // Donnée lue sur l'étiquette (verte = confirmée), pas saisie à la main ni supposée.
  dlcInfo: { fontSize: 12, color: '#047857', fontWeight: '600' },
  // Conséquence sanitaire lourde : fond ambré pour qu'elle ne se lise pas comme une note anodine.
  quarantineNotice: {
    fontSize: 13,
    fontWeight: '600',
    color: '#92400E',
    backgroundColor: '#FEF3C7',
    borderRadius: 8,
    padding: 10,
    lineHeight: 18,
  },
  submitDisabled: { backgroundColor: '#9CA3AF' },
  submitText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
