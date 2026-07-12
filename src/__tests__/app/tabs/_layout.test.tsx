import { render, screen } from '@testing-library/react-native';

import { useAuthStatus, type AuthStatus } from '@/hooks/use-auth-status';

import TabsLayout from '@/app/(tabs)/_layout';

type TabBarStyle = { height: number; paddingBottom: number; paddingTop: number };

// Capture les options passées à <Tabs> pour vérifier le dimensionnement de la tab bar.
const mockTabsProps: { screenOptions?: { tabBarStyle?: TabBarStyle } } = {};
// Inset système bas piloté par le test (barre de navigation Android / home indicator iOS).
let mockBottomInset = 0;

jest.mock('@/hooks/use-auth-status');
jest.mock('expo-router', () => {
  // Requis dans la factory : jest.mock est hissé avant les imports du module, donc un import
  // classique ne serait pas encore évalué ici. C'est la seule forme qui fonctionne.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Text } = require('react-native');
  return {
    Tabs: Object.assign(
      (props: { screenOptions?: { tabBarStyle?: TabBarStyle } }) => {
        mockTabsProps.screenOptions = props.screenOptions;
        return null;
      },
      { Screen: () => null }
    ),
    Redirect: ({ href }: { href: string }) => <Text>redirection:{href}</Text>,
  };
});
// TabsLayout lit l'inset bas (useSafeAreaInsets) pour placer la tab bar au-dessus de la
// barre système. Le SafeAreaProvider n'existe pas en test → on stub l'inset.
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: mockBottomInset, left: 0, right: 0 }),
}));

const mockedUseAuthStatus = jest.mocked(useAuthStatus);

function renderWithStatus(status: AuthStatus) {
  mockedUseAuthStatus.mockReturnValue(status);
  render(<TabsLayout />);
}

describe('garde du groupe (tabs)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockBottomInset = 0;
    mockTabsProps.screenOptions = undefined;
  });

  it('renvoie vers la connexion quand aucune session n’est active', () => {
    // C'est LE contrôle d'accès de l'app : sans lui, un lien profond ouvre les écrans métier.
    renderWithStatus('unauthenticated');

    expect(screen.getByText(/redirection:\/login/)).toBeTruthy();
  });

  it('ne redirige pas tant que la session est en cours de vérification', () => {
    renderWithStatus('loading');

    expect(screen.queryByText(/redirection:/)).toBeNull();
  });

  it('affiche les onglets pour une session valide', () => {
    renderWithStatus('authenticated');

    expect(screen.queryByText(/redirection:/)).toBeNull();
  });

  it('réserve la place de la barre système sous les onglets (inset bas)', () => {
    // Régression : à hauteur fixe, la tab bar se faisait recouvrir par la barre de
    // navigation Android en edge-to-edge. Hauteur ET padding doivent inclure l'inset.
    mockBottomInset = 48;
    renderWithStatus('authenticated');

    const tabBarStyle = mockTabsProps.screenOptions?.tabBarStyle;
    expect(tabBarStyle?.height).toBe(60 + 48);
    expect(tabBarStyle?.paddingBottom).toBe(48);
  });

  it('garde la même place aux libellés quand il n’y a pas de barre système', () => {
    // Le padding minimum de 8 px était PRÉLEVÉ sur la hauteur au lieu d'y être ajouté :
    // sur un téléphone sans barre de navigation (et sur le web), la zone de contenu tombait
    // à 44 px et les libellés « Accueil / Scan / Sync / Profil » étaient coupés.
    mockBottomInset = 0;
    renderWithStatus('authenticated');

    const tabBarStyle = mockTabsProps.screenOptions?.tabBarStyle;
    const contenu =
      (tabBarStyle?.height ?? 0) -
      (tabBarStyle?.paddingTop ?? 0) -
      (tabBarStyle?.paddingBottom ?? 0);

    expect(contenu).toBe(52);
  });

  it('laisse la même place aux libellés quel que soit l’inset', () => {
    // La hauteur suit le padding : la place de l'icône et du libellé ne doit JAMAIS dépendre
    // de la taille de la barre système.
    const contenus = [0, 8, 34, 48].map((inset) => {
      mockBottomInset = inset;
      renderWithStatus('authenticated');
      const style = mockTabsProps.screenOptions?.tabBarStyle;
      return (style?.height ?? 0) - (style?.paddingTop ?? 0) - (style?.paddingBottom ?? 0);
    });

    expect(contenus).toEqual([52, 52, 52, 52]);
  });
});
