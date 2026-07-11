import { render, screen } from '@testing-library/react-native';

import { useAuthStatus, type AuthStatus } from '@/hooks/use-auth-status';

import TabsLayout from '@/app/(tabs)/_layout';

jest.mock('@/hooks/use-auth-status');
jest.mock('expo-router', () => {
  // Requis dans la factory : jest.mock est hissé avant les imports du module.
  const { Text } = require('react-native');
  return {
    Tabs: Object.assign(() => null, { Screen: () => null }),
    Redirect: ({ href }: { href: string }) => <Text>redirection:{href}</Text>,
  };
});

const mockedUseAuthStatus = jest.mocked(useAuthStatus);

function renderWithStatus(status: AuthStatus) {
  mockedUseAuthStatus.mockReturnValue(status);
  render(<TabsLayout />);
}

describe('garde du groupe (tabs)', () => {
  beforeEach(() => jest.clearAllMocks());

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
});
