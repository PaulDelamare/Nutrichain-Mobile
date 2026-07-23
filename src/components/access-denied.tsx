import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HEADER_GRADIENT } from '@/lib/theme';

interface AccessDeniedProps {
  /** Titre de l'écran refusé — l'opérateur doit savoir OÙ il vient d'arriver. */
  title: string;
  reason: string;
}

/**
 * (issue #71) La garde de rôle posée à l'ENTRÉE d'un écran, et pas seulement sur l'accueil.
 *
 * Masquer les cartes de l'accueil ne suffit pas : sur le web, une URL tapée à la main
 * (`/reception`) ouvre l'écran sans jamais passer par l'accueil. Sans cette garde, le formulaire
 * s'affichait, la saisie partait en file locale, et n'était refusée qu'à la synchronisation.
 */
export function AccessDenied({ title, reason }: AccessDeniedProps) {
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.screen}>
      <LinearGradient
        colors={HEADER_GRADIENT}
        style={[styles.header, { paddingTop: insets.top + 12 }]}
      >
        <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{title}</Text>
      </LinearGradient>

      <View style={styles.body}>
        <Ionicons name="lock-closed-outline" size={44} color="#9CA3AF" />
        <Text style={styles.reason}>{reason}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F9FAFB' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  headerTitle: { color: '#fff', fontSize: 18, fontWeight: '700' },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 16 },
  reason: { fontSize: 15, color: '#4B5563', textAlign: 'center', lineHeight: 22 },
});
