import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';

import { lookupBatch } from '@/lib/batches';
import { isEquipmentCode } from '@/lib/equipment';
import { ApiError, getErrorMessage } from '@/lib/errors';
import { BRAND, BRAND_GRADIENT } from '@/lib/theme';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CAMERA_HEIGHT = SCREEN_WIDTH * 1.05;
const FRAME_W = SCREEN_WIDTH * 0.70;
const FRAME_H = SCREEN_WIDTH * 0.65;
const SIDE_W = (SCREEN_WIDTH - FRAME_W) / 2;
const TOP_H = (CAMERA_HEIGHT - FRAME_H) / 2;

export default function ScanScreen() {
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [manualInput, setManualInput] = useState('');

  // Le verrou vit dans une ref, pas dans l'état : la caméra rappelle depuis le processeur
  // natif de frames SANS attendre le re-rendu de React, donc deux codes lus dans la même
  // frame liraient tous deux `false` — deux écrans empilés, et l'opérateur enregistre deux
  // fois la même palette. Il est relâché au retour sur l'onglet, ce qui évite un minuteur.
  const scanned = useRef(false);
  useFocusEffect(useCallback(() => void (scanned.current = false), []));

  const handleCode = useCallback(async (code: string) => {
    if (scanned.current) return;
    scanned.current = true;

    // ⚠️ Le verrou n'est relâché QUE sur les chemins qui ne naviguent pas. Le relâcher aussi
    // après un `router.push` réussi rouvrirait le double-scan : l'onglet n'est pas démonté par
    // un push, la caméra reste montée et retire aussitôt sur la même étiquette.
    const stayHere = () => {
      scanned.current = false;
    };

    const goToReception = () => router.push({ pathname: '/reception', params: { code } });

    // L'étiquette d'un frigo n'est pas un lot : sans ce test, elle ouvrait un formulaire de
    // réception avec le code du matériel dans le numéro d'expédition.
    if (isEquipmentCode(code)) {
      Toast.show({
        type: 'error',
        text1: 'Ceci est un emplacement',
        text2: "Scannez l'étiquette d'un lot. Un frigo se scanne depuis la réception.",
      });
      stayHere();
      return;
    }

    // La résolution est partagée avec la transformation et l'expédition : une même étiquette doit
    // donner partout la même réponse. Elle essaie le code BRUT avant son interprétation — sans ça,
    // un lot fournisseur nommé « 10ABC » serait lu « ABC » et on ouvrirait la fiche d'un AUTRE lot.
    const found = await lookupBatch(code);

    if (found.kind === 'found') {
      router.push({ pathname: '/batch/[id]', params: { id: found.batch.id } });
      return;
    }

    if (found.kind === 'unknown') {
      // Le serveur a répondu, et il ne connaît pas ce lot : c'est une marchandise qui arrive.
      goToReception();
      return;
    }

    // Une session expirée a déjà renvoyé l'opérateur vers l'écran de connexion : empiler une
    // réception par-dessus le laisserait dans un formulaire qu'il ne pourra jamais envoyer.
    const { error } = found;
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
      Toast.show({ type: 'error', text1: 'Scan impossible', text2: getErrorMessage(error) });
      stayHere();
      return;
    }

    // Hors réseau, on ne SAIT PAS si ce lot existe déjà. Dire « lot inconnu » serait un mensonge, et
    // l'opérateur réceptionnerait une palette déjà en stock. On le dit — et on ouvre quand même la
    // réception : saisir hors ligne est la raison d'être de cette application.
    Toast.show({
      type: 'error',
      text1: 'Lot non vérifié',
      text2: `${getErrorMessage(error)} Vérifiez qu'il n'est pas déjà en stock.`,
    });
    goToReception();
  }, []);

  const handleSimulate = () => void handleCode('00376112345678901234');

  const handleManualSubmit = () => {
    if (!manualInput.trim()) return;
    void handleCode(manualInput.trim());
    setManualInput('');
  };

  // ─── Permission states ───────────────────────────────────────
  if (!permission) {
    return (
      <View style={[styles.center, { paddingTop: insets.top }]}>
        <ActivityIndicator color={BRAND.primary} size="large" />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={[styles.dark, { paddingTop: insets.top }]}>
        <Header />
        <View style={styles.center}>
          <View style={styles.permissionIcon}>
            <Ionicons name="camera-outline" size={48} color="rgba(255,255,255,0.5)" />
          </View>
          <Text style={styles.permissionTitle}>Accès à la caméra requis</Text>
          <Text style={styles.permissionDesc}>
            NutriChain a besoin de la caméra pour scanner les codes-barres et datamatrix.
          </Text>
          <TouchableOpacity style={styles.permissionBtn} onPress={requestPermission} activeOpacity={0.85}>
            <LinearGradient colors={BRAND_GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={styles.permissionBtnGradient}>
              <Text style={styles.permissionBtnText}>Autoriser l&apos;accès</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ─── Main scan screen ────────────────────────────────────────
  return (
    <View style={[styles.dark, { paddingTop: insets.top }]}>
      <Header />

      {/* Camera with overlay */}
      <View style={styles.cameraContainer}>
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          onBarcodeScanned={({ data }) => handleCode(data)}
        />

        {/* Dark overlay — top */}
        <View style={[styles.overlaySlice, { height: TOP_H, width: SCREEN_WIDTH }]} />

        {/* Dark overlay — middle row */}
        <View style={styles.overlayMiddleRow}>
          <View style={[styles.overlaySlice, { width: SIDE_W, height: FRAME_H }]} />

          {/* Scan frame */}
          <View style={styles.scanFrame}>
            {/* Corner marks */}
            <View style={[styles.corner, styles.tlCorner]} />
            <View style={[styles.corner, styles.trCorner]} />
            <View style={[styles.corner, styles.blCorner]} />
            <View style={[styles.corner, styles.brCorner]} />
            {/* Center horizontal guide */}
            <View style={styles.centerLine} />
          </View>

          <View style={[styles.overlaySlice, { width: SIDE_W, height: FRAME_H }]} />
        </View>

        {/* Dark overlay — bottom */}
        <View style={[styles.overlaySlice, { flex: 1, width: SCREEN_WIDTH }]} />
      </View>

      {/* Instructions */}
      <Text style={styles.instruction}>
        Placez le code-barres ou le datamatrix dans le cadre — lecture quasi instantanée
      </Text>

      {/* Manual input */}
      <View style={styles.manualSection}>
        <Text style={styles.manualLabel}>SAISIE MANUELLE (SSCC / LOT / GTIN)</Text>
        <View style={styles.manualRow}>
          <TextInput
            style={styles.manualInput}
            placeholder="3761234567890123"
            placeholderTextColor="rgba(255,255,255,0.30)"
            value={manualInput}
            onChangeText={setManualInput}
            returnKeyType="done"
            onSubmitEditing={handleManualSubmit}
            autoCapitalize="characters"
            autoCorrect={false}
          />
          {manualInput.length > 0 && (
            <TouchableOpacity style={styles.manualSubmitBtn} onPress={handleManualSubmit} activeOpacity={0.8}>
              <Ionicons name="arrow-forward" size={20} color="#ffffff" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Aide de démonstration, jamais livrée en production : un opérateur qui l'actionne
          injecterait un code fictif dans une réception réelle. */}
      {__DEV__ && (
        <TouchableOpacity
          onPress={handleSimulate}
          activeOpacity={0.85}
          style={styles.simulateWrapper}
        >
          <LinearGradient
            colors={BRAND_GRADIENT}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={styles.simulateBtn}
          >
            <Text style={styles.simulateBtnText}>Simuler un scan (démo)</Text>
          </LinearGradient>
        </TouchableOpacity>
      )}
    </View>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────
function Header() {
  return (
    <View style={styles.header}>
      <TouchableOpacity
        onPress={() => router.navigate('/(tabs)')}
        style={styles.backBtn}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        <Ionicons name="arrow-back" size={20} color="#ffffff" />
        <Text style={styles.backText}>Retour</Text>
      </TouchableOpacity>
      <Text style={styles.headerTitle}>Scanner</Text>
      <View style={styles.headerRight} />
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────
const CORNER_SIZE = 22;
const CORNER_THICKNESS = 3;

const styles = StyleSheet.create({
  dark: {
    flex: 1,
    backgroundColor: '#111827',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 16,
  },

  /* ── Header ──────────────────────────────────────────────── */
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minWidth: 80,
  },
  backText: {
    fontSize: 15,
    color: '#ffffff',
    fontWeight: '500',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#ffffff',
  },
  headerRight: {
    minWidth: 80,
  },

  /* ── Camera + overlay ────────────────────────────────────── */
  cameraContainer: {
    width: SCREEN_WIDTH,
    height: CAMERA_HEIGHT,
    overflow: 'hidden',
  },
  overlaySlice: {
    backgroundColor: 'rgba(0,0,0,0.65)',
  },
  overlayMiddleRow: {
    flexDirection: 'row',
  },

  /* ── Scan frame ──────────────────────────────────────────── */
  scanFrame: {
    width: FRAME_W,
    height: FRAME_H,
    position: 'relative',
  },

  /* Corners */
  corner: {
    position: 'absolute',
    width: CORNER_SIZE,
    height: CORNER_SIZE,
    borderColor: BRAND.primary,
  },
  tlCorner: {
    top: 0,
    left: 0,
    borderTopWidth: CORNER_THICKNESS,
    borderLeftWidth: CORNER_THICKNESS,
    borderTopLeftRadius: 4,
  },
  trCorner: {
    top: 0,
    right: 0,
    borderTopWidth: CORNER_THICKNESS,
    borderRightWidth: CORNER_THICKNESS,
    borderTopRightRadius: 4,
  },
  blCorner: {
    bottom: 0,
    left: 0,
    borderBottomWidth: CORNER_THICKNESS,
    borderLeftWidth: CORNER_THICKNESS,
    borderBottomLeftRadius: 4,
  },
  brCorner: {
    bottom: 0,
    right: 0,
    borderBottomWidth: CORNER_THICKNESS,
    borderRightWidth: CORNER_THICKNESS,
    borderBottomRightRadius: 4,
  },
  centerLine: {
    position: 'absolute',
    top: '50%',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: 'rgba(13,148,136,0.40)',
  },

  /* ── Instruction ─────────────────────────────────────────── */
  instruction: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.60)',
    textAlign: 'center',
    paddingHorizontal: 32,
    paddingVertical: 14,
    lineHeight: 20,
  },

  /* ── Manual input ────────────────────────────────────────── */
  manualSection: {
    paddingHorizontal: 16,
    gap: 8,
  },
  manualLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.50)',
    letterSpacing: 0.8,
  },
  manualRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  manualInput: {
    flex: 1,
    height: 48,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    paddingHorizontal: 14,
    fontSize: 15,
    color: '#ffffff',
  },
  manualSubmitBtn: {
    width: 48,
    height: 48,
    backgroundColor: BRAND.primary,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },

  /* ── Simulate button ─────────────────────────────────────── */
  simulateWrapper: {
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 12,
    overflow: 'hidden',
  },
  simulateBtn: {
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  simulateBtnText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
    letterSpacing: 0.2,
  },

  /* ── Permission screen ───────────────────────────────────── */
  permissionIcon: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  permissionTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#ffffff',
    textAlign: 'center',
  },
  permissionDesc: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.60)',
    textAlign: 'center',
    lineHeight: 22,
  },
  permissionBtn: {
    width: '100%',
    borderRadius: 12,
    overflow: 'hidden',
    marginTop: 8,
  },
  permissionBtnGradient: {
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  permissionBtnText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
  },
});
