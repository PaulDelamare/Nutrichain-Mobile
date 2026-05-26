import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function SyncScreen() {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Ionicons name="sync-outline" size={48} color="#D1D5DB" />
      <Text style={styles.title}>Synchronisation</Text>
      <Text style={styles.subtitle}>En cours de développement</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  title: { fontSize: 18, fontWeight: '600', color: '#374151' },
  subtitle: { fontSize: 14, color: '#9CA3AF' },
});
