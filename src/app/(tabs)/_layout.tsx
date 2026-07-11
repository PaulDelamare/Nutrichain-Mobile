import { Ionicons } from '@expo/vector-icons';
import { Redirect, Tabs } from 'expo-router';
import { ActivityIndicator, StyleSheet, View, type ColorValue } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuthStatus } from '@/hooks/use-auth-status';

import { BRAND } from '@/lib/theme';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

function tabIcon(active: IconName, inactive: IconName) {
  const TabIcon = ({ color, focused }: { color: ColorValue; focused: boolean }) => (
    <Ionicons name={focused ? active : inactive} size={22} color={color as string} />
  );
  return TabIcon;
}

export default function TabsLayout() {
  const status = useAuthStatus();
  const insets = useSafeAreaInsets();

  // Sans cette garde, un lien profond ouvre les onglets sans session : les écrans
  // s'afficheraient vides et chaque appel API partirait en 401.
  if (status === 'loading') {
    return (
      <View style={styles.loader}>
        <ActivityIndicator size="large" color={BRAND.primary} />
      </View>
    );
  }

  if (status === 'unauthenticated') {
    return <Redirect href="/login" />;
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: BRAND.primary,
        tabBarInactiveTintColor: '#9CA3AF',
        tabBarStyle: {
          backgroundColor: '#ffffff',
          borderTopColor: '#F3F4F6',
          borderTopWidth: 1,
          // Ajoute l'inset système du bas (barre de navigation Android / home indicator iOS)
          // à la hauteur ET au padding. Sans ça, en edge-to-edge (défaut Expo SDK 56) la barre
          // système recouvre les onglets et les rend intouchables.
          height: 60 + insets.bottom,
          paddingBottom: Math.max(insets.bottom, 8),
          paddingTop: 8,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '500',
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Accueil',
          tabBarIcon: tabIcon('home', 'home-outline'),
        }}
      />
      <Tabs.Screen
        name="scan"
        options={{
          title: 'Scan',
          tabBarIcon: tabIcon('qr-code', 'qr-code-outline'),
        }}
      />
      <Tabs.Screen
        name="sync"
        options={{
          title: 'Sync',
          tabBarIcon: tabIcon('sync', 'sync-outline'),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profil',
          tabBarIcon: tabIcon('person', 'person-outline'),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  loader: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F9FAFB',
  },
});
