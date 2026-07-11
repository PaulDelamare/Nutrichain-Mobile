import { Redirect } from 'expo-router';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { useAuthStatus } from '@/hooks/use-auth-status';

import { BRAND } from '@/lib/theme';

export default function Index() {
  const status = useAuthStatus();

  if (status === 'loading') {
    return (
      <View style={styles.loader}>
        <ActivityIndicator size="large" color={BRAND.primary} />
      </View>
    );
  }

  return <Redirect href={status === 'authenticated' ? '/(tabs)' : '/login'} />;
}

const styles = StyleSheet.create({
  loader: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0F3D36',
  },
});
