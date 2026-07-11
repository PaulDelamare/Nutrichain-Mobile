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
import { useOnlineStatus } from '@/hooks/use-online-status';
import { loadActiveColdAlerts, type Alert } from '@/lib/alerts';
import { formatRole } from '@/lib/roles';
import { countByStatus } from '@/lib/sync/queue';
import type { OperationStatus } from '@/lib/sync/types';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

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
}

function QuickAction({ icon, iconColor, iconBg, title, subtitle, onPress }: QuickActionProps) {
  return (
    <TouchableOpacity style={styles.actionCard} onPress={onPress} activeOpacity={0.75}>
      <View style={[styles.actionIcon, { backgroundColor: iconBg }]}>
        <Ionicons name={icon} size={18} color={iconColor} />
      </View>
      <Text style={styles.actionTitle}>{title}</Text>
      <Text style={styles.actionSubtitle}>{subtitle}</Text>
    </TouchableOpacity>
  );
}

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useCurrentUser();
  const online = useOnlineStatus();
  const [counts, setCounts] = useState<Record<OperationStatus, number>>({
    PENDING: 0,
    SYNCED: 0,
    CONFLICT: 0,
    REJECTED: 0,
  });
  const [coldAlerts, setColdAlerts] = useState<Alert[]>([]);

  useFocusEffect(
    useCallback(() => {
      // Un échec SQLite ne doit pas faire tomber l'accueil en rejet non géré : l'écran
      // reste sur ses derniers compteurs plutôt que de disparaître.
      countByStatus().then(setCounts).catch(() => undefined);
      loadActiveColdAlerts().then(setColdAlerts);
    }, [])
  );

  const [firstAlert] = coldAlerts;

  return (
    <View style={styles.screen}>
      {/* ── Header gradient ─────────────────────────────────────── */}
      <LinearGradient
        colors={['#0F766E', '#0D9488']}
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
            <View style={[styles.onlineDot, !online && styles.offlineDot]} />
            <Text style={styles.onlineText}>{online ? 'En ligne' : 'Hors ligne'}</Text>
          </View>
        </View>

        {/* Stats grid 2×2 */}
        <View style={styles.statsGrid}>
          <StatCard label="EN ATTENTE SYNC" value={counts.PENDING} />
          <StatCard label="SYNCHRONISÉES" value={counts.SYNCED} />
          <StatCard label="ALERTES FROID" value={coldAlerts.length} />
          <StatCard label="À CORRIGER" value={counts.CONFLICT + counts.REJECTED} />
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
            <Ionicons name="qr-code" size={36} color="#0D9488" />
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
          />
          <QuickAction
            icon="cloud-upload-outline"
            iconColor="#2563EB"
            iconBg="#EFF6FF"
            title="Synchroniser"
            subtitle={
              counts.PENDING === 0 ? 'Tout est à jour' : `${counts.PENDING} en attente`
            }
            onPress={() => router.navigate('/sync')}
          />
        </View>

        {firstAlert && (
          <View style={styles.alertBanner}>
            <View style={styles.alertIconWrap}>
              <Ionicons name="warning" size={20} color="#D97706" />
            </View>
            <View style={styles.alertContent}>
              <Text style={styles.alertTitle}>Chaîne du froid</Text>
              <Text style={styles.alertMessage}>{firstAlert.message}</Text>
            </View>
          </View>
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
  alertMessage: {
    fontSize: 12,
    color: '#92400E',
    marginTop: 2,
  },
});
