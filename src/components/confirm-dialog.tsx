import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { BRAND } from '@/lib/theme';

interface ConfirmDialogProps {
  visible: boolean;
  title: string;
  message: string;
  /** Libellé de l'action confirmée (« Lever », « Supprimer »…). */
  confirmLabel: string;
  /** Action lourde ou irréversible : le bouton passe en rouge. */
  destructive?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * Demander confirmation — SANS `Alert.alert`.
 *
 * `Alert.alert` est un **no-op littéral** sur React Native Web (`static alert() {}`, corps vide) :
 * il n'affiche rien et n'exécute rien. Les décisions les plus lourdes de l'application — lever une
 * quarantaine, supprimer un scan, renvoyer une réception — étaient donc des **boutons morts** dans
 * un navigateur. Et la démonstration du projet se fait précisément dans un navigateur : on cliquait,
 * il ne se passait rien, et rien ne l'expliquait.
 *
 * Une `Modal` React Native, elle, fonctionne sur les deux plateformes.
 */
export function ConfirmDialog({
  visible,
  title,
  message,
  confirmLabel,
  destructive,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.message}>{message}</Text>

          <View style={styles.actions}>
            <Pressable style={styles.cancel} onPress={onCancel}>
              <Text style={styles.cancelText}>Annuler</Text>
            </Pressable>

            <Pressable
              style={[styles.confirm, destructive && styles.confirmDestructive]}
              onPress={onConfirm}
            >
              <Text style={styles.confirmText}>{confirmLabel}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(17,24,39,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 20,
    gap: 8,
  },
  title: { fontSize: 17, fontWeight: '700', color: '#111827' },
  message: { fontSize: 14, color: '#4B5563', lineHeight: 20 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 12 },
  cancel: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10 },
  cancelText: { fontSize: 15, fontWeight: '600', color: '#6B7280' },
  confirm: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: BRAND.primary,
  },
  confirmDestructive: { backgroundColor: '#B91C1C' },
  confirmText: { fontSize: 15, fontWeight: '700', color: '#ffffff' },
});
