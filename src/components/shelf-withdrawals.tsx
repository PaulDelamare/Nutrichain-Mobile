import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import Toast from 'react-native-toast-message';

import { useCurrentUser } from '@/hooks/use-current-user';
import { useOnlineStatus } from '@/hooks/use-online-status';
import { shelfWithdrawalBlockedReason } from '@/lib/roles';
import { BRAND } from '@/lib/theme';
import { toastError } from '@/lib/toast';
import {
  loadShelfWithdrawals,
  recordShelfWithdrawal,
  withdrawalQuantityError,
  withdrawalReasonError,
  WITHDRAWAL_REASON_MAX_LENGTH,
  type ShelfWithdrawalProgress,
} from '@/lib/withdrawals';

/**
 * Retrait du rayon d'un magasin, sur la fiche d'un lot scanné.
 *
 * C'est la seconde moitié du rappel : sans elle, un magasin qui a vidé son rayon ne peut le
 * déclarer nulle part et la boucle ne se ferme jamais.
 *
 * Le scan identifie le LOT, jamais la livraison d'origine — la marchandise est fongible en
 * réserve. D'où deux exigences : choisir le magasin, et SAISIR la quantité. Le scan identifie,
 * l'humain compte.
 */
export function ShelfWithdrawals({ batchId }: { batchId: string }) {
  const { user } = useCurrentUser();
  const online = useOnlineStatus();
  const blocked = shelfWithdrawalBlockedReason(user?.role ?? null);

  const [magasins, setMagasins] = useState<ShelfWithdrawalProgress[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [ouvertPour, setOuvertPour] = useState<string | null>(null);
  const [quantite, setQuantite] = useState('');
  const [motif, setMotif] = useState('');
  const [envoi, setEnvoi] = useState(false);

  const recharger = useCallback(async () => {
    try {
      setMagasins(await loadShelfWithdrawals(batchId));
      setErreur(null);
    } catch {
      // Un panneau indisponible ne doit pas emporter la fiche : on le dit, et on s'arrête là.
      setErreur('Avancement des retraits indisponible.');
      setMagasins([]);
    }
  }, [batchId]);

  // Même forme que le chargement de la fiche (`batch/[id].tsx`) : la mise à jour vit dans le
  // `.then`, jamais dans le corps de l'effet, et une garde de démontage évite d'écrire sur un
  // écran quitté entre-temps.
  useEffect(() => {
    let monte = true;

    loadShelfWithdrawals(batchId)
      .then((clients) => {
        if (monte) setMagasins(clients);
      })
      .catch(() => {
        if (!monte) return;
        setErreur('Avancement des retraits indisponible.');
        setMagasins([]);
      });

    return () => {
      monte = false;
    };
  }, [batchId]);

  const magasinOuvert = magasins?.find((m) => m.customerId === ouvertPour) ?? null;
  const quantiteIssue = magasinOuvert && quantite !== ''
    ? withdrawalQuantityError(quantite, magasinOuvert.resteARetirer)
    : null;
  const motifIssue = motif === '' ? null : withdrawalReasonError(motif);
  const pret =
    magasinOuvert !== null &&
    withdrawalQuantityError(quantite, magasinOuvert.resteARetirer) === null &&
    withdrawalReasonError(motif) === null;

  const enregistrer = async () => {
    if (!magasinOuvert) return;
    setEnvoi(true);

    try {
      const resultat = await recordShelfWithdrawal(batchId, {
        id_client: magasinOuvert.customerId,
        quantite: Number(quantite.replace(',', '.')),
        motif: motif.trim(),
      });

      Toast.show({
        type: 'success',
        text1: `Retrait enregistré — ${magasinOuvert.customerName}`,
        text2: `Reste à retirer : ${resultat.resteARetirer} ${resultat.unite}`,
      });

      setOuvertPour(null);
      setQuantite('');
      setMotif('');
      await recharger();
    } catch (error: unknown) {
      toastError('Retrait refusé', error);
    } finally {
      setEnvoi(false);
    }
  };

  if (magasins === null) {
    return (
      <View style={styles.block}>
        <ActivityIndicator color={BRAND.primary} />
      </View>
    );
  }

  if (magasins.length === 0) {
    return (
      <View style={styles.block}>
        <Text style={styles.title}>Retraits en magasin</Text>
        <Text style={styles.muted}>
          {erreur ??
            "Aucune livraison constatée pour ce lot : il n'y a rien à retirer d'un rayon."}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.block}>
      <Text style={styles.title}>Retraits en magasin</Text>

      {magasins.map((magasin) => (
        <View key={magasin.customerId} style={styles.store}>
          <View style={styles.storeHead}>
            <Text style={styles.storeName}>{magasin.customerName}</Text>
            <Text style={styles.muted}>
              {magasin.quantiteRetiree} / {magasin.quantiteLivree} {magasin.unite}
            </Text>
          </View>

          {Number(magasin.resteARetirer) <= 0 ? (
            <Text style={styles.done}>Retrait complet — plus rien en rayon.</Text>
          ) : (
            <>
              <Text style={styles.muted}>
                Reste à retirer : {magasin.resteARetirer} {magasin.unite}
              </Text>

              {blocked ? (
                // Trois états : un rôle non vérifié ne dit pas la même chose qu'un rôle refusé.
                <View style={styles.blocked}>
                  <Ionicons name="lock-closed-outline" size={16} color="#9CA3AF" />
                  <Text style={styles.blockedText}>{blocked}</Text>
                </View>
              ) : online === 'offline' ? (
                // Le retrait ne passe PAS par la file hors-ligne : le proposer serait mentir.
                <View style={styles.blocked}>
                  <Ionicons name="cloud-offline-outline" size={16} color="#B45309" />
                  <Text style={styles.blockedText}>
                    Hors réseau : un retrait ne peut pas être mis en attente.
                  </Text>
                </View>
              ) : ouvertPour === magasin.customerId ? (
                <View style={styles.form}>
                  <Text style={styles.label}>Quantité retirée ({magasin.unite})</Text>
                  <TextInput
                    style={styles.input}
                    value={quantite}
                    onChangeText={setQuantite}
                    keyboardType="decimal-pad"
                    placeholder={magasin.resteARetirer}
                    accessibilityLabel="Quantité retirée"
                  />
                  {quantiteIssue ? <Text style={styles.issue}>{quantiteIssue}</Text> : null}

                  <Text style={styles.label}>Motif</Text>
                  <TextInput
                    style={styles.input}
                    value={motif}
                    onChangeText={setMotif}
                    maxLength={WITHDRAWAL_REASON_MAX_LENGTH}
                    placeholder="Retrait du rayon après rappel"
                    accessibilityLabel="Motif du retrait"
                  />
                  {motifIssue ? <Text style={styles.issue}>{motifIssue}</Text> : null}

                  <View style={styles.row}>
                    <TouchableOpacity
                      style={[styles.button, !pret || envoi ? styles.buttonDisabled : null]}
                      disabled={!pret || envoi}
                      onPress={enregistrer}
                      activeOpacity={0.85}
                    >
                      <Text style={styles.buttonText}>
                        {envoi ? 'Enregistrement…' : 'Enregistrer le retrait'}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.ghost}
                      onPress={() => setOuvertPour(null)}
                      activeOpacity={0.85}
                    >
                      <Text style={styles.ghostText}>Annuler</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <TouchableOpacity
                  style={styles.button}
                  onPress={() => setOuvertPour(magasin.customerId)}
                  activeOpacity={0.85}
                >
                  <Text style={styles.buttonText}>Déclarer un retrait</Text>
                </TouchableOpacity>
              )}
            </>
          )}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { marginTop: 20, gap: 10 },
  title: { fontSize: 15, fontWeight: '700', color: '#111827' },
  store: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    padding: 12,
    gap: 6,
    backgroundColor: '#FFFFFF',
  },
  storeHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  storeName: { fontSize: 14, fontWeight: '600', color: '#111827' },
  muted: { fontSize: 13, color: '#6B7280' },
  done: { fontSize: 13, color: '#15803D' },
  form: { gap: 6, marginTop: 6 },
  label: { fontSize: 12, color: '#6B7280' },
  input: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    color: '#111827',
    backgroundColor: '#FFFFFF',
  },
  issue: { fontSize: 12, color: '#B91C1C' },
  row: { flexDirection: 'row', gap: 8, marginTop: 4 },
  button: {
    backgroundColor: BRAND.primary,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    alignItems: 'center',
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
  ghost: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  ghostText: { color: '#374151', fontSize: 14 },
  blocked: { flexDirection: 'row', gap: 6, alignItems: 'center', marginTop: 4 },
  blockedText: { flex: 1, fontSize: 12, color: '#6B7280' },
});
