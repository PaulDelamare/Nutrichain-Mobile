import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import Toast from 'react-native-toast-message';

import { startAutoSync } from '@/lib/sync/auto-sync';

export default function RootLayout() {
  // Monté à la racine : la file doit repartir au retour du réseau quel que soit
  // l'écran affiché, y compris si l'opérateur n'ouvre jamais l'onglet Sync.
  useEffect(() => {
    const stop = startAutoSync();
    return () => {
      stop.then((unsubscribe) => unsubscribe());
    };
  }, []);

  return (
    <>
      <Stack screenOptions={{ headerShown: false }} />
      <StatusBar style="light" />
      <Toast />
    </>
  );
}
