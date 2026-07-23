import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  Dimensions,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useCurrentUser } from '@/hooks/use-current-user';
import { useOnlineStatus, type OnlineStatus } from '@/hooks/use-online-status';
import { loadActiveColdAlerts, type ColdAlerts } from '@/lib/alerts';
import { loadQuarantineBatches, type QuarantineBatches } from '@/lib/quarantine';
import { formatRole, writeBlockedReason } from '@/lib/roles';
import { countByStatus } from '@/lib/sync/queue';
import type { OperationStatus } from '@/lib/sync/types';

import { BRAND, HEADER_GRADIENT } from '@/lib/theme';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

/** « Vérification… » et non « En ligne » : au démarrage, on ne sait pas ENCORE si le serveur répond. */
const ONLINE_LABEL: Record<OnlineStatus, string> = {
  online: 'En ligne',
  offline: 'Hors ligne',
  checking: 'Vérification…',
};

/** On n'a pas pu savoir. Ce n'est PAS zéro. */
const UNKNOWN = '—';
/** On ne sait pas ENCORE. Ce n'est ni zéro, ni un échec. */
const LOADING = '…';

/** Les compteurs de la file locale — ou l'aveu que la base ne répond pas. */
type QueueCounts =
  | { kind: 'ok'; counts: Record<OperationStatus, number> }
  | { kind: 'unverifiable' };

interface StatCardProps {
  label: string;
  value: string | number;
}

function StatCard({ label, value }: StatCardProps) {
  return (
    <View style={styles.statCard}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

interface QuickActionProps {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  iconColor: string;
  iconBg: string;
  title: string;
  subtitle: string;
  onPress: () => void;
  /** (issue #71) Rôle sans droit d'écriture : la carte reste VISIBLE mais inerte, et dit pourquoi. */
  blocked?: boolean;
}

function QuickAction({
  icon,
  iconColor,
  iconBg,
  title,
  subtitle,
  onPress,
  blocked = false,
}: QuickActionProps) {
  return (
    <TouchableOpacity
      style={[styles.actionCard, blocked && styles.actionCardBlocked]}
      onPress={onPress}
      // Masquer la carte laisserait croire que la fonction n'existe pas ; la griser et la
      // verrouiller dit la vérité : elle existe, mais pas pour ce rôle.
      disabled={blocked}
      activeOpacity={0.75}
    >
      <View style={[styles.actionIcon, { backgroundColor: blocked ? '#F3F4F6' : iconBg }]}>
        <Ionicons
          name={blocked ? 'lock-closed-outline' : icon}
          size={18}
          color={blocked ? '#9CA3AF' : iconColor}
        />
      </View>
      <Text style={[styles.actionTitle, blocked && styles.actionTextBlocked]}>{title}</Text>
      <Text style={[styles.actionSubtitle, blocked && styles.actionTextBlocked]}>{subtitle}</Text>
    </TouchableOpacity>
  );
}

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useCurrentUser();
  const online = useOnlineStatus();
  // (issue #71) `null` tant que le rôle est inconnu (hors ligne, ou première réponse en vol) :
  // on n'accuse pas sans savoir, et on ne ferme surtout pas l'écriture sur une supposition.
  const writeBlocked = writeBlockedReason(user?.role ?? null);
  // ⚠️ TROIS états, jamais deux. « Je charge » et « je n'ai pas pu » ne sont PAS la même chose :
  // les confondre ferait clignoter un message d'échec à chaque ouverture de l'app — un mensonge
  // à l'envers. Et `0` n'est aucun des deux : un compteur initialisé à zéro affiche
  // « ALERTES FROID : 0 » et « Tout est à jour » avant même d'avoir rien demandé.
  const [counts, setCounts] = useState<QueueCounts | null>(null);
  const [cold, setCold] = useState<ColdAlerts | null>(null);
  const [quarantine, setQuarantine] = useState<QuarantineBatches | null>(null);

  useFocusEffect(
    useCallback(() => {
      // Un échec SQLite ne doit pas laisser l'écran sur ses anciens compteurs en les faisant passer
      // pour frais : on ne SAIT plus, et on le dit.
      countByStatus()
        .then((value) => setCounts({ kind: 'ok', counts: value }))
        .catch(() => setCounts({ kind: 'unverifiable' }));

      // `loadActiveColdAlerts` / `loadQuarantineBatches` ne rejettent jamais : l'incertitude est
      // dans leur valeur de retour (`unverifiable`), jamais un zéro ou une liste vide muette.
      loadActiveColdAlerts().then(setCold);
      loadQuarantineBatches().then(setQuarantine);
    }, [])
  );

  const alerts = cold?.kind === 'ok' ? cold.alerts : [];
  const [firstAlert] = alerts;

  /** Le chiffre, ou l'aveu — jamais un zéro par défaut. */
  const stat = (value: number | undefined) =>
    counts === null ? LOADING : counts.kind === 'unverifiable' ? UNKNOWN : (value ?? UNKNOWN);

  const queue = counts?.kind === 'ok' ? counts.counts : null;

  // Compteur de quarantaine — même discipline « trois états » : … / — / N, jamais un 0 par défaut.
  const quarantineBadge =
    quarantine === null
      ? LOADING
      : quarantine.kind === 'unverifiable'
        ? UNKNOWN
        : String(quarantine.batches.length);
  const quarantineActive = quarantine?.kind === 'ok' && quarantine.batches.length > 0;

  return (
    <View style={styles.screen}>
      {/* ── Header gradient ─────────────────────────────────────── */}
      <LinearGradient
        colors={HEADER_GRADIENT}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.header, { paddingTop: insets.top + 16 }]}
      >
        {/* Top row: greeting + online badge */}
        <View style={styles.headerTopRow}>
          <View>
            <Text style={styles.greeting}>Bonjour,</Text>
            <Text style={styles.userName}>{user?.name ?? '…'}</Text>
            {user?.role && (
              <View style={styles.roleRow}>
                <Ionicons name="person-outline" size={12} color="rgba(255,255,255,0.75)" />
                <Text style={styles.roleText}>{formatRole(user.role)}</Text>
              </View>
            )}
          </View>

          <View style={styles.onlineBadge}>
            {/* Tant qu'on n'a pas interrogé le serveur, on ne prétend RIEN : « En ligne » par
                défaut, c'est affirmer exactement ce qu'on ignore. */}
            <View
              style={[
                styles.onlineDot,
                online === 'offline' && styles.offlineDot,
                online === 'checking' && styles.checkingDot,
              ]}
            />
            <Text style={styles.onlineText}>{ONLINE_LABEL[online]}</Text>
          </View>
        </View>

        {/* Stats grid 2×2 */}
        {/* « — » et non « 0 » : un chiffre qu'on n'a pas pu vérifier n'est pas un zéro. */}
        <View style={styles.statsGrid}>
          <StatCard label="EN ATTENTE SYNC" value={stat(queue?.PENDING)} />
          <StatCard label="SYNCHRONISÉES" value={stat(queue?.SYNCED)} />
          <StatCard
            label="ALERTES FROID"
            value={
              cold === null ? LOADING : cold.kind === 'unverifiable' ? UNKNOWN : alerts.length
            }
          />
          <StatCard
            label="À CORRIGER"
            value={stat(queue ? queue.CONFLICT + queue.REJECTED : undefined)}
          />
        </View>
      </LinearGradient>

      {/* ── Main scrollable content ──────────────────────────────── */}
      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.contentInner}
        showsVerticalScrollIndicator={false}
      >
        {/* Section label */}
        <Text style={styles.sectionLabel}>ACTION PRINCIPALE</Text>

        {/* Scanner card — main CTA */}
        <TouchableOpacity
          style={styles.scanCard}
          onPress={() => router.navigate('/scan')}
          activeOpacity={0.85}
        >
          <View style={styles.scanIconContainer}>
            <Ionicons name="qr-code" size={36} color={BRAND.primary} />
          </View>
          <Text style={styles.scanTitle}>Scanner un lot</Text>
          <Text style={styles.scanSubtitle}>GTIN, SSCC, datamatrix — lecture rapide</Text>
        </TouchableOpacity>

        {/* Quick actions 2×2 */}
        <View style={styles.actionsGrid}>
          <QuickAction
            icon="arrow-down-circle-outline"
            iconColor="#EA580C"
            iconBg="#FFF7ED"
            title="Réception"
            subtitle="Marchandise entrante"
            onPress={() => router.navigate('/reception')}
            blocked={writeBlocked !== null}
          />
          <QuickAction
            icon="flask-outline"
            iconColor="#7C3AED"
            iconBg="#F5F3FF"
            title="Transformation"
            subtitle="Cuve et lots utilisés"
            onPress={() => router.navigate('/transformation')}
            blocked={writeBlocked !== null}
          />
          <QuickAction
            icon="send-outline"
            iconColor="#0891B2"
            iconBg="#ECFEFF"
            title="Expédition"
            subtitle="Lots chargés pour un client"
            onPress={() => router.navigate('/expedition')}
            blocked={writeBlocked !== null}
          />
          <QuickAction
            icon="cloud-upload-outline"
            iconColor="#2563EB"
            iconBg="#EFF6FF"
            title="Synchroniser"
            // « Tout est à jour » est une AFFIRMATION. Sans compteurs lisibles, on n'en sait rien —
            // et l'écran l'écrivait quand même, sous le bouton de synchronisation.
            subtitle={
              counts === null
                ? 'Vérification…'
                : counts.kind === 'unverifiable'
                  ? 'File non vérifiée'
                  : queue && queue.PENDING === 0
                    ? 'Tout est à jour'
                    : `${queue?.PENDING ?? 0} en attente`
            }
            onPress={() => router.navigate('/sync')}
          />
        </View>

        {/* Le motif, une seule fois sous la grille : le répéter sur trois cartes serait du bruit. */}
        {writeBlocked && <Text style={styles.blockedNotice}>{writeBlocked}</Text>}

        {/* Lots en quarantaine — TOUJOURS présent : l'écran doit rester atteignable même à 0, et le
            compteur reste honnête (… en chargement, — si non vérifié, sinon le nombre). Avant, ces
            lots bloqués par un contrôle qualité étaient invisibles : personne sur le terrain ne
            savait qu'ils existaient. */}
        <TouchableOpacity
          style={[styles.quarantineCard, quarantineActive && styles.quarantineCardActive]}
          onPress={() => router.navigate('/quarantine')}
          activeOpacity={0.8}
        >
          <View style={[styles.quarantineIcon, quarantineActive && styles.quarantineIconActive]}>
            <Ionicons name="lock-closed" size={18} color={quarantineActive ? '#B45309' : '#6B7280'} />
          </View>
          <View style={styles.quarantineTextWrap}>
            <Text style={styles.quarantineTitle}>Lots en quarantaine</Text>
            <Text style={styles.quarantineSub}>Marchandise bloquée — à ne pas utiliser</Text>
          </View>
          <Text style={[styles.quarantineBadge, quarantineActive && styles.quarantineBadgeActive]}>
            {quarantineBadge}
          </Text>
          <Ionicons name="chevron-forward" size={18} color="#9CA3AF" />
        </TouchableOpacity>

        {/* Ne PAS taire l'incertitude : une bannière absente se lit « aucune alerte ».
            Mais seulement sur un ÉCHEC — pas pendant le chargement, sinon l'opérateur verrait
            passer un message d'erreur à chaque ouverture de l'application. */}
        {cold?.kind === 'unverifiable' && (
          <View style={styles.alertUnknown}>
            <Ionicons name="cloud-offline-outline" size={18} color="#6B7280" />
            <Text style={styles.alertUnknownText}>
              Alertes froid non vérifiées — impossible de joindre le serveur.
            </Text>
          </View>
        )}

        {firstAlert && (
          <TouchableOpacity
            style={styles.alertBanner}
            onPress={() =>
              router.navigate({ pathname: '/alert/[id]', params: { id: firstAlert.id } })
            }
            activeOpacity={0.8}
          >
            <View style={styles.alertIconWrap}>
              <Ionicons name="warning" size={20} color="#D97706" />
            </View>
            <View style={styles.alertContent}>
              <Text style={styles.alertTitle}>Chaîne du froid</Text>
              <Text style={styles.alertMessage}>{firstAlert.message}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color="#D97706" />
          </TouchableOpacity>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#F3F4F6',
  },

  /* ── Header ──────────────────────────────────────────────── */
  header: {
    paddingHorizontal: 20,
    paddingBottom: 24,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
  },
  headerTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 20,
  },
  greeting: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.80)',
    marginBottom: 2,
  },
  userName: {
    fontSize: 22,
    fontWeight: '700',
    color: '#ffffff',
    marginBottom: 4,
  },
  roleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  roleText: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.75)',
  },
  onlineBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: 'rgba(0,0,0,0.20)',
    borderRadius: 20,
  },
  onlineDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#4ADE80',
  },
  offlineDot: {
    backgroundColor: '#FBBF24',
  },
  checkingDot: {
    backgroundColor: 'rgba(255,255,255,0.5)',
  },
  onlineText: {
    fontSize: 12,
    color: '#ffffff',
    fontWeight: '500',
  },

  /* ── Stats grid ──────────────────────────────────────────── */
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  statCard: {
    width: (SCREEN_WIDTH - 40 - 8) / 2,
    backgroundColor: 'rgba(0,0,0,0.12)',
    borderRadius: 12,
    padding: 12,
    gap: 4,
  },
  statLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.70)',
    letterSpacing: 0.5,
  },
  statValue: {
    fontSize: 24,
    fontWeight: '700',
    color: '#ffffff',
  },

  /* ── Main content ────────────────────────────────────────── */
  content: {
    flex: 1,
  },
  contentInner: {
    padding: 16,
    gap: 16,
    paddingBottom: 24,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#6B7280',
    letterSpacing: 0.8,
    marginBottom: -8,
  },

  /* ── Scanner CTA card ────────────────────────────────────── */
  scanCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    gap: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 12,
    elevation: 4,
  },
  scanIconContainer: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#CCFBF1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
  },
  scanSubtitle: {
    fontSize: 13,
    color: '#6B7280',
    textAlign: 'center',
  },

  /* ── Quick actions grid ──────────────────────────────────── */
  actionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  actionCardBlocked: { backgroundColor: '#F9FAFB', opacity: 0.7 },
  actionTextBlocked: { color: '#9CA3AF' },
  blockedNotice: {
    fontSize: 12,
    color: '#B45309',
    backgroundColor: '#FEF3C7',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginTop: 10,
  },
  actionCard: {
    width: (SCREEN_WIDTH - 32 - 10) / 2,
    backgroundColor: '#ffffff',
    borderRadius: 14,
    padding: 14,
    gap: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  actionIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  actionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#111827',
  },
  actionSubtitle: {
    fontSize: 12,
    color: '#6B7280',
  },

  /* ── Quarantaine card ────────────────────────────────────── */
  quarantineCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#ffffff',
    borderRadius: 14,
    padding: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  // Des lots réellement bloqués : la carte prend une teinte ambrée pour attirer l'œil.
  quarantineCardActive: {
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  quarantineIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  quarantineIconActive: { backgroundColor: '#FEF3C7' },
  quarantineTextWrap: { flex: 1 },
  quarantineTitle: { fontSize: 14, fontWeight: '700', color: '#111827' },
  quarantineSub: { fontSize: 12, color: '#6B7280', marginTop: 2 },
  quarantineBadge: { fontSize: 20, fontWeight: '700', color: '#6B7280' },
  quarantineBadgeActive: { color: '#B45309' },

  /* ── Cold chain alert banner ─────────────────────────────── */
  alertBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFBEB',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#FDE68A',
    padding: 14,
    gap: 10,
  },
  alertIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#FEF3C7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  alertContent: {
    flex: 1,
  },
  alertTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#D97706',
  },
  alertUnknown: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#F3F4F6',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 8,
  },
  alertUnknownText: { flex: 1, fontSize: 13, color: '#4B5563', lineHeight: 18 },
  alertMessage: {
    fontSize: 12,
    color: '#92400E',
    marginTop: 2,
  },
});
