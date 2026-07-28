import { Redirect, Stack, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import Toast from 'react-native-toast-message';

import { useAuthStatus } from '@/hooks/use-auth-status';
import { BRAND } from '@/lib/theme';

// Installé AVANT qu'un écran ne monte une caméra : expo-camera n'ira chercher son propre décodeur
// (et son WASM sur un CDN) que si aucun n'est déjà en place.
import '@/lib/barcode-polyfill';
import { startAutoSync } from '@/lib/sync/auto-sync';

/**
 * Écrans atteignables SANS session — et il n'y en a pas d'autres.
 *
 * `verify-2fa` en fait partie : entre le mot de passe et le second facteur, `isAuthenticated()`
 * est faux. Le garder rendrait la 2FA infranchissable.
 */
const ECRANS_PUBLICS = ['login', 'verify-2fa'];

export default function RootLayout() {
  const status = useAuthStatus();
  const segments = useSegments();

  // Monté à la racine : la file doit repartir au retour du réseau quel que soit
  // l'écran affiché, y compris si l'opérateur n'ouvre jamais l'onglet Sync.
  useEffect(() => {
    const stop = startAutoSync();
    return () => {
      stop.then((unsubscribe) => unsubscribe());
    };
  }, []);

  /**
   * Garde de session portée à la RACINE (#102).
   *
   * Seul le groupe `(tabs)` la portait. Or `expedition`, `reception`, `transformation` et
   * `quarantine` vivent hors de ce groupe : un lien profond `nutrichainmobile://expedition`
   * ouvrait le formulaire complet sans session, rempli depuis le SQLite local — clients de
   * l'organisation précédente et leurs adresses de livraison comprises. Le serveur aurait refusé
   * l'écriture en 403 ; c'est la LECTURE des données locales qui fuyait.
   *
   * Ici plutôt que sur chaque écran : c'est le seul endroit qui couvre aussi les écrans qui
   * n'existent pas encore.
   */
  const ecranPublic = ECRANS_PUBLICS.includes(segments[0] ?? '');

  // Pendant la vérification, on ne monte PAS le navigateur. Sur un lien profond à froid, le
  // premier rendu est 'loading' : monter le navigateur à cet instant afficherait l'écran métier
  // et ses données avant même de savoir s'il y a une session. Il ne doit jamais apparaître, pas
  // même le temps d'une image — c'est précisément la fuite qu'on ferme.
  if (status === 'loading' && !ecranPublic) {
    return (
      <View style={styles.loader}>
        <ActivityIndicator size="large" color={BRAND.primary} />
      </View>
    );
  }

  return (
    <>
      {/* Le navigateur reste monté sous la redirection : `<Redirect>` a besoin de lui pour
          naviguer, et l'écran de connexion s'affichera dedans. */}
      {status === 'unauthenticated' && !ecranPublic && <Redirect href="/login" />}
      <Stack screenOptions={{ headerShown: false }} />
      <StatusBar style="light" />
      <Toast />
    </>
  );
}

const styles = StyleSheet.create({
  loader: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
  },
});
