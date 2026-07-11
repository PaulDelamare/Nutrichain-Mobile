import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useEffect, useRef } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

interface LocationScannerProps {
  visible: boolean;
  onClose: () => void;
  onScan: (code: string) => void;
}

/**
 * Scanner l'emplacement, plutôt que le choisir dans une liste : les deux scans (le lot puis
 * le frigo) sont physiques et sur place, donc l'opérateur ne peut pas déclarer un emplacement
 * où il n'est pas. Un menu déroulant se remplit depuis le bureau.
 */
export function LocationScanner({ visible, onClose, onScan }: LocationScannerProps) {
  const [permission, requestPermission] = useCameraPermissions();

  // La caméra émet depuis le processeur natif de frames, sans attendre React : sans verrou
  // synchrone, un seul code déclencherait plusieurs résolutions.
  const handled = useRef(false);

  // Relâché à CHAQUE ouverture, et non à la fermeture : le chemin nominal ferme la modale
  // depuis le parent (après résolution du code), sans passer par `close`. Le verrou restait
  // donc armé — et le scanner était mort dès le premier scan, y compris après une erreur.
  useEffect(() => {
    if (visible) {
      handled.current = false;
    }
  }, [visible]);

  const handleBarcode = (code: string) => {
    if (handled.current) return;
    handled.current = true;
    onScan(code);
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.screen}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} hitSlop={12}>
            <Ionicons name="close" size={26} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.title}>Scanner l&apos;emplacement</Text>
          <View style={styles.spacer} />
        </View>

        {permission?.granted ? (
          <>
            <CameraView
              style={styles.camera}
              facing="back"
              onBarcodeScanned={({ data }) => handleBarcode(data)}
            />
            <Text style={styles.hint}>
              Placez l&apos;étiquette du frigo, de la cuve ou de l&apos;étagère dans le cadre.
            </Text>
          </>
        ) : (
          <View style={styles.permission}>
            <Ionicons name="camera-outline" size={44} color="rgba(255,255,255,0.5)" />
            <Text style={styles.hint}>La caméra est nécessaire pour scanner l&apos;emplacement.</Text>
            <TouchableOpacity style={styles.permissionBtn} onPress={requestPermission}>
              <Text style={styles.permissionBtnText}>Autoriser l&apos;accès</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#111827' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 56,
    paddingBottom: 16,
  },
  title: { color: '#fff', fontSize: 17, fontWeight: '700' },
  spacer: { width: 26 },
  camera: { flex: 1 },
  hint: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 13,
    textAlign: 'center',
    paddingHorizontal: 32,
    paddingVertical: 20,
  },
  permission: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  permissionBtn: {
    backgroundColor: '#0D9488',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 10,
  },
  permissionBtnText: { color: '#fff', fontWeight: '700' },
});
