import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Toast from 'react-native-toast-message';

import { OptionPicker } from '@/components/option-picker';
import { useAuthStatus } from '@/hooks/use-auth-status';
import { useCurrentUser } from '@/hooks/use-current-user';
import { useOnlineStatus } from '@/hooks/use-online-status';
import { loadEquipment, type Equipment } from '@/lib/equipment';
import { writeBlockedReason } from '@/lib/roles';
import { moveBatchToStorage, storageOptions } from '@/lib/storage';
import { BRAND } from '@/lib/theme';
import { toastError } from '@/lib/toast';

/**
 * Ranger un lot depuis sa fiche, après l'avoir scanné.
 *
 * Ce geste n'était appelable par aucune application : la route existait sans client. Or
 * l'emplacement n'est pas un confort — la quarantaine automatique sur excursion de température
 * cible les lots RANGÉS dans le matériel en cause. Un lot sans emplacement n'est bloqué par rien.
 */
export function BatchStorage({
  batchId,
  currentEquipmentId,
  onMoved,
}: {
  batchId: string;
  /** Emplacement actuel, pour ne pas proposer un rangement qui ne changerait rien. */
  currentEquipmentId: string | null;
  onMoved: () => void;
}) {
  const { user } = useCurrentUser();
  // Distingue « role inconnu hors ligne » (permissif) de « aucune session » — cf. reception.tsx.
  const isAuthenticated = useAuthStatus() === 'authenticated';
  const online = useOnlineStatus();
  const blocked = writeBlockedReason(user?.role ?? null, isAuthenticated);

  const [equipment, setEquipment] = useState<Equipment[] | null>(null);
  const [choisi, setChoisi] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  // Même forme que le chargement de la fiche : la mise à jour vit dans le `.then`, jamais dans le
  // corps de l'effet, et une garde de démontage évite d'écrire sur un écran quitté.
  useEffect(() => {
    let monte = true;

    loadEquipment()
      .then((liste) => {
        if (monte) setEquipment(liste);
      })
      .catch(() => {
        if (monte) setEquipment([]);
      });

    return () => {
      monte = false;
    };
  }, []);

  const options = storageOptions(equipment ?? []);
  const actuel = options.find((e) => e.id === currentEquipmentId) ?? null;

  const ranger = async () => {
    if (!choisi) return;
    setEnvoi(true);

    try {
      await moveBatchToStorage(batchId, choisi);
      const cible = options.find((e) => e.id === choisi);

      Toast.show({
        type: 'success',
        text1: 'Lot rangé',
        text2: cible ? `${cible.nom} — ${cible.lieu.nom}` : undefined,
      });

      setChoisi(null);
      onMoved();
    } catch (error: unknown) {
      toastError('Rangement refusé', error);
    } finally {
      setEnvoi(false);
    }
  };

  if (equipment === null) {
    return (
      <View style={styles.block}>
        <ActivityIndicator color={BRAND.primary} />
      </View>
    );
  }

  return (
    <View style={styles.block}>
      <Text style={styles.title}>Emplacement</Text>
      <Text style={styles.muted}>
        {actuel ? `Rangé dans ${actuel.nom} — ${actuel.lieu.nom}` : 'Ce lot n’a aucun emplacement.'}
      </Text>

      {blocked ? (
        <View style={styles.blocked}>
          <Ionicons name="lock-closed-outline" size={16} color="#9CA3AF" />
          <Text style={styles.blockedText}>{blocked}</Text>
        </View>
      ) : online === 'offline' ? (
        // Le rangement ne passe PAS par la file hors-ligne : le proposer serait promettre un
        // enregistrement qui n'aurait pas lieu.
        <View style={styles.blocked}>
          <Ionicons name="cloud-offline-outline" size={16} color="#B45309" />
          <Text style={styles.blockedText}>
            Hors réseau : un rangement ne peut pas être mis en attente.
          </Text>
        </View>
      ) : options.length === 0 ? (
        <Text style={styles.muted}>
          Aucun emplacement de stockage déclaré. Un frigo, un congélateur ou une étagère doit
          exister pour y ranger un lot.
        </Text>
      ) : (
        <>
          <OptionPicker
            label="Ranger dans"
            options={options
              // L'emplacement actuel n'est pas proposé : le choisir ne changerait rien.
              .filter((e) => e.id !== currentEquipmentId)
              .map((e) => ({ value: e.id, label: `${e.nom} · ${e.lieu.nom}` }))}
            selected={choisi ?? ''}
            onSelect={setChoisi}
          />

          <TouchableOpacity
            style={[styles.button, !choisi || envoi ? styles.buttonDisabled : null]}
            disabled={!choisi || envoi}
            onPress={ranger}
            activeOpacity={0.85}
          >
            <Text style={styles.buttonText}>{envoi ? 'Rangement…' : 'Ranger ce lot'}</Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { marginTop: 20, gap: 8 },
  title: { fontSize: 15, fontWeight: '700', color: '#111827' },
  muted: { fontSize: 13, color: '#6B7280' },
  button: {
    backgroundColor: BRAND.primary,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 4,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
  blocked: { flexDirection: 'row', gap: 6, alignItems: 'center', marginTop: 4 },
  blockedText: { flex: 1, fontSize: 12, color: '#6B7280' },
});
