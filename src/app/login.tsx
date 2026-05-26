import {
  Rajdhani_400Regular,
  Rajdhani_700Bold,
  useFonts,
} from '@expo-google-fonts/rajdhani';
import { Ionicons } from '@expo/vector-icons';
import Checkbox from 'expo-checkbox';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import React, { useRef, useState } from 'react';
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

import { ApiError, signIn } from '@/lib/api';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function getErrorMessage(err: unknown): string {
  if (!(err instanceof ApiError)) {
    return 'Une erreur inattendue est survenue.';
  }
  switch (err.status) {
    case 0:
      return 'Aucune connexion réseau. Vérifiez votre connexion internet.';
    case 401:
      return 'Email ou mot de passe incorrect.';
    case 403:
      return 'Votre compte est désactivé. Contactez votre administrateur.';
    case 422:
      return "Format d'email invalide ou champs manquants.";
    case 429:
      return 'Trop de tentatives de connexion. Veuillez patienter quelques instants.';
  }
  if (err.status >= 500) {
    return 'Service temporairement indisponible. Réessayez dans quelques instants.';
  }
  return err.message || 'Une erreur est survenue.';
}

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [emailTouched, setEmailTouched] = useState(false);

  const passwordRef = useRef<TextInput>(null);

  const [fontsLoaded] = useFonts({ Rajdhani_400Regular, Rajdhani_700Bold });

  if (!fontsLoaded) return null;

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
        text2: 'Bienvenue sur NutriChain. Redirection…',
        visibilityTime: 1800,
      });
      setTimeout(() => router.replace('/dashboard'), 1900);
    } catch (err) {
      Toast.show({
        type: 'error',
        text1: 'Erreur de connexion',
        text2: getErrorMessage(err),
        visibilityTime: 4000,
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <LinearGradient
      colors={['#0F3D36', '#1A5C52', '#0D9488']}
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
            <Text style={styles.logoLetter}>N</Text>
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
                <Text style={styles.validationError}>Format d'email invalide</Text>
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

            {/* Remember me + Forgot password */}
            <View style={styles.optionsRow}>
              <TouchableOpacity
                style={styles.checkboxRow}
                onPress={() => setRememberMe((v) => !v)}
                activeOpacity={0.7}
              >
                <Checkbox
                  value={rememberMe}
                  onValueChange={setRememberMe}
                  color={rememberMe ? '#0D9488' : undefined}
                  style={styles.checkbox}
                />
                <Text style={styles.rememberLabel}>Rester connecté</Text>
              </TouchableOpacity>

              <TouchableOpacity activeOpacity={0.7}>
                <Text style={styles.forgotPassword}>Mot de passe oublié ?</Text>
              </TouchableOpacity>
            </View>

            {/* Login button */}
            <TouchableOpacity
              onPress={handleLogin}
              disabled={!isFormValid || loading}
              activeOpacity={0.85}
              style={styles.buttonWrapper}
            >
              <LinearGradient
                colors={['#14B8A6', '#0D9488']}
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

            {/* SSO */}
            <TouchableOpacity activeOpacity={0.7}>
              <Text style={styles.ssoText}>SSO entreprise</Text>
            </TouchableOpacity>
          </View>

          {/* Footer */}
          <Text style={styles.footer}>Chiffrement TLS · Session conforme RGPD</Text>
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
  optionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 4,
  },
  rememberLabel: {
    fontSize: 14,
    color: '#374151',
  },
  forgotPassword: {
    fontSize: 14,
    color: '#0D9488',
    fontWeight: '500',
  },

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
  ssoText: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
  },

  /* Footer */
  footer: {
    marginTop: 24,
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.55)',
    textAlign: 'center',
  },
});
