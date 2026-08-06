import {
  Rajdhani_400Regular,
  Rajdhani_700Bold,
  useFonts,
} from '@expo-google-fonts/rajdhani';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import React, { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
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

import { signIn } from '@/lib/api';
import { ApiError } from '@/lib/errors';
import { BRAND, BRAND_GRADIENT } from '@/lib/theme';
import { toastError } from '@/lib/toast';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [emailTouched, setEmailTouched] = useState(false);

  const passwordRef = useRef<TextInput>(null);

  const [fontsLoaded, fontError] = useFonts({ Rajdhani_400Regular, Rajdhani_700Bold });

  // Une police n'est qu'un habillage : elle ne doit jamais empêcher de se connecter. L'erreur
  // de `useFonts` était ignorée, donc une police introuvable laissait l'écran VIDE À VIE —
  // application morte, sans message, et sans diagnostic possible sur le terrain.
  if (!fontsLoaded && !fontError) return null;

  const isEmailValid = email.length > 0 && EMAIL_REGEX.test(email);
  const isFormValid = isEmailValid && password.length > 0;
  const showEmailError = emailTouched && email.length > 0 && !isEmailValid;

  const handleLogin = async () => {
    if (!isFormValid) return;
    setLoading(true);
    try {
      await signIn(email.trim(), password);
      Toast.show({
        type: 'success',
        text1: 'Connexion réussie',
        text2: 'Bienvenue sur NutriChain.',
        visibilityTime: 1800,
      });
      router.replace('/(tabs)');
    } catch (err) {
      // Un compte avec la 2FA activée n'a pas échoué : il attend son code. Un toast d'erreur ici
      // laisserait l'opérateur bloqué sans jamais pouvoir saisir le code demandé.
      if (err instanceof ApiError && err.field === 'two_factor_required') {
        router.push({ pathname: '/verify-2fa', params: { email: email.trim() } });
        return;
      }
      // `visibilityTime: 4000` retiré : c'est déjà le défaut de la librairie.
      toastError('Erreur de connexion', err);
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
          {/* Logo */}
          <View style={styles.logoContainer}>
            <Image
              source={require('../../assets/images/nutrichain-logo.png')}
              style={styles.logoImage}
              resizeMode="contain"
              accessibilityLabel="NutriChain"
            />
          </View>

          {/* App title */}
          <View style={styles.titleRow}>
            <Text style={styles.titleBold}>Nutri</Text>
            <Text style={styles.titleRegular}>Chain</Text>
          </View>

          <Text style={styles.subtitle}>Traçabilité agroalimentaire</Text>

          {/* Form card */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Connexion sécurisée</Text>

            {/* Email */}
            <View style={styles.field}>
              <Text style={styles.label}>E-MAIL PROFESSIONNEL</Text>
              <TextInput
                style={[styles.input, showEmailError && styles.inputError]}
                placeholder="prenom.nom@entreprise.fr"
                placeholderTextColor="#9CA3AF"
                value={email}
                onChangeText={setEmail}
                onBlur={() => setEmailTouched(true)}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="next"
                onSubmitEditing={() => passwordRef.current?.focus()}
                blurOnSubmit={false}
              />
              {showEmailError && (
                <Text style={styles.validationError}>Format d&apos;email invalide</Text>
              )}
            </View>

            {/* Password */}
            <View style={styles.field}>
              <Text style={styles.label}>MOT DE PASSE</Text>
              <View style={styles.inputWrapper}>
                <TextInput
                  ref={passwordRef}
                  style={[styles.input, styles.inputWithIcon]}
                  placeholder="••••••••"
                  placeholderTextColor="#9CA3AF"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                  returnKeyType="done"
                  onSubmitEditing={handleLogin}
                />
                <TouchableOpacity
                  onPress={() => setShowPassword((v) => !v)}
                  style={styles.eyeButton}
                  activeOpacity={0.7}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <Ionicons
                    name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                    size={20}
                    color="#9CA3AF"
                  />
                </TouchableOpacity>
              </View>
            </View>

            {/* Login button */}
            <TouchableOpacity
              onPress={handleLogin}
              disabled={!isFormValid || loading}
              activeOpacity={0.85}
              style={styles.buttonWrapper}
            >
              <LinearGradient
                colors={BRAND_GRADIENT}
                start={{ x: 0, y: 0 }}
                end={{ x: 0, y: 1 }}
                style={[styles.button, (!isFormValid || loading) && styles.buttonDisabled]}
              >
                {loading ? (
                  <ActivityIndicator color="#ffffff" />
                ) : (
                  <Text style={styles.buttonText}>Se connecter</Text>
                )}
              </LinearGradient>
            </TouchableOpacity>

          </View>

          {/* « Rester connecté », « Mot de passe oublié ? » et « SSO entreprise » ont été
              retirés : trois contrôles sans aucun code derrière. Un bouton mort dans une app
              terrain, c'est un opérateur qui appuie, n'obtient rien, et cesse de faire
              confiance à l'écran. Ils reviendront quand l'API les portera. */}
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

  /* Logo */
  logoContainer: {
    width: 72,
    height: 72,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.20)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
    overflow: 'hidden',
  },
  logoImage: {
    width: 56,
    height: 56,
  },

  /* Title */
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

  /* Card */
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

  /* Form fields */
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
    fontSize: 15,
    color: '#111827',
    backgroundColor: '#FAFAFA',
  },
  inputError: {
    borderColor: '#EF4444',
    backgroundColor: '#FFF5F5',
  },
  validationError: {
    fontSize: 12,
    color: '#EF4444',
    marginTop: 2,
  },

  /* Password with eye icon */
  inputWrapper: {
    position: 'relative',
  },
  inputWithIcon: {
    paddingRight: 48,
  },
  eyeButton: {
    position: 'absolute',
    right: 14,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },

  /* Options row */

  /* Button */
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

  /* SSO */

  /* Footer */
});
