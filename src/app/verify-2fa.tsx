import {
  Rajdhani_400Regular,
  Rajdhani_700Bold,
  useFonts,
} from '@expo-google-fonts/rajdhani';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Toast from 'react-native-toast-message';

import { verifyTwoFactorTotp } from '@/lib/api';
import { ApiError } from '@/lib/errors';
import { BRAND, BRAND_GRADIENT } from '@/lib/theme';
import { toastError, toastMessage } from '@/lib/toast';

const CODE_LENGTH = 6;

export default function VerifyTwoFactorScreen() {
  const { email } = useLocalSearchParams<{ email?: string }>();
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);

  const [fontsLoaded, fontError] = useFonts({ Rajdhani_400Regular, Rajdhani_700Bold });

  // Cf. login.tsx : une police introuvable ne doit jamais bloquer un écran d'authentification.
  if (!fontsLoaded && !fontError) return null;

  const isCodeValid = code.length === CODE_LENGTH;

  const handleVerify = async () => {
    if (!isCodeValid) return;
    setLoading(true);
    try {
      await verifyTwoFactorTotp(code);
      Toast.show({
        type: 'success',
        text1: 'Connexion réussie',
        text2: 'Bienvenue sur NutriChain.',
        visibilityTime: 1800,
      });
      router.replace('/(tabs)');
    } catch (err) {
      // Better-Auth ne renvoie aucun `field` sur un code TOTP invalide — un 401 générique, que
      // `getErrorMessage` traduirait par « Email ou mot de passe incorrect » : un message qui n'a
      // aucun sens sur cet écran, qui ne comporte ni email ni mot de passe.
      if (err instanceof ApiError && err.status === 401) {
        toastMessage('Code de vérification refusé', 'Code invalide ou expiré. Réessayez.');
      } else {
        toastError('Code de vérification refusé', err);
      }
      setCode('');
    } finally {
      setLoading(false);
    }
  };

  return (
    <LinearGradient
      colors={['#0F3D36', '#1A5C52', BRAND.primary]}
      locations={[0, 0.45, 1]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.gradient}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.logoContainer}>
            <Text style={styles.logoLetter}>N</Text>
          </View>

          <View style={styles.titleRow}>
            <Text style={styles.titleBold}>Nutri</Text>
            <Text style={styles.titleRegular}>Chain</Text>
          </View>

          <Text style={styles.subtitle}>Vérification en deux étapes</Text>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Double authentification</Text>
            {email ? (
              <Text style={styles.helper}>Connexion pour {email}</Text>
            ) : null}

            <View style={styles.field}>
              <Text style={styles.label}>CODE DE VOTRE APPLICATION D&apos;AUTHENTIFICATION</Text>
              <TextInput
                style={styles.input}
                placeholder="123456"
                placeholderTextColor="#9CA3AF"
                value={code}
                onChangeText={(text) => setCode(text.replace(/\D/g, '').slice(0, CODE_LENGTH))}
                keyboardType="number-pad"
                maxLength={CODE_LENGTH}
                autoFocus
                returnKeyType="done"
                onSubmitEditing={handleVerify}
              />
            </View>

            <TouchableOpacity
              onPress={handleVerify}
              disabled={!isCodeValid || loading}
              activeOpacity={0.85}
              style={styles.buttonWrapper}
            >
              <LinearGradient
                colors={BRAND_GRADIENT}
                start={{ x: 0, y: 0 }}
                end={{ x: 0, y: 1 }}
                style={[styles.button, (!isCodeValid || loading) && styles.buttonDisabled]}
              >
                {loading ? (
                  <ActivityIndicator color="#ffffff" />
                ) : (
                  <Text style={styles.buttonText}>Valider</Text>
                )}
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  gradient: { flex: 1 },
  flex: { flex: 1 },
  scrollContent: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 48,
  },
  logoContainer: {
    width: 56,
    height: 56,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.20)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  logoLetter: {
    fontSize: 26,
    fontFamily: 'Rajdhani_700Bold',
    color: '#ffffff',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginBottom: 4,
  },
  titleBold: {
    fontSize: 30,
    fontFamily: 'Rajdhani_700Bold',
    color: '#ffffff',
    letterSpacing: 0.3,
  },
  titleRegular: {
    fontSize: 30,
    fontFamily: 'Rajdhani_400Regular',
    color: '#ffffff',
    letterSpacing: 0.3,
  },
  subtitle: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.70)',
    marginBottom: 32,
    letterSpacing: 0.2,
  },
  card: {
    width: '100%',
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: 24,
    gap: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 10,
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111827',
  },
  helper: {
    fontSize: 13,
    color: '#6B7280',
    marginTop: -8,
  },
  field: { gap: 6 },
  label: {
    fontSize: 11,
    fontWeight: '600',
    color: '#6B7280',
    letterSpacing: 0.8,
  },
  input: {
    height: 48,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    paddingHorizontal: 14,
    fontSize: 20,
    letterSpacing: 4,
    textAlign: 'center',
    color: '#111827',
    backgroundColor: '#FAFAFA',
  },
  buttonWrapper: {
    borderRadius: 12,
    overflow: 'hidden',
  },
  button: {
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDisabled: {
    opacity: 0.55,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
    letterSpacing: 0.3,
  },
});
