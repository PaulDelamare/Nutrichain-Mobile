import { render, screen } from '@testing-library/react-native';

import { useAuthStatus, type AuthStatus } from '@/hooks/use-auth-status';

import RootLayout from '@/app/_layout';

// Segment de route courant, piloté par le test : c'est lui qui distingue un écran métier
// (`expedition`) d'un écran d'authentification (`login`), lequel doit rester atteignable.
let mockSegments: string[] = [];

jest.mock('@/hooks/use-auth-status');
jest.mock('@/lib/barcode-polyfill', () => ({}));
jest.mock('@/lib/sync/auto-sync', () => ({
  startAutoSync: () => Promise.resolve(() => undefined),
}));
jest.mock('expo-router', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Text } = require('react-native');
  return {
    Stack: () => <Text>navigateur</Text>,
    Redirect: ({ href }: { href: string }) => <Text>redirection:{href}</Text>,
    useSegments: () => mockSegments,
  };
});
jest.mock('expo-status-bar', () => ({ StatusBar: () => null }));
jest.mock('react-native-toast-message', () => ({ __esModule: true, default: () => null }));

const mockedUseAuthStatus = jest.mocked(useAuthStatus);

function rendreSur(status: AuthStatus, segments: string[]) {
  mockedUseAuthStatus.mockReturnValue(status);
  mockSegments = segments;
  render(<RootLayout />);
}

/**
 * #102 — Seul le groupe `(tabs)` gardait la session. Or `expedition`, `reception`,
 * `transformation` et `quarantine` vivent HORS de ce groupe : un lien profond
 * `nutrichainmobile://expedition` ouvrait le formulaire complet sans session, rempli depuis le
 * SQLite local — clients de l'organisation précédente et leurs adresses de livraison comprises.
 *
 * La garde est portée à la racine parce que c'est le seul endroit qui couvre tous les écrans,
 * présents ET futurs : un écran ajouté demain hors de `(tabs)` est protégé sans rien faire.
 */
describe('garde de session à la racine du routeur (#102)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSegments = [];
  });

  it('ne monte PAS le navigateur tant que la session est en cours de vérification', () => {
    // Le point le plus important. Sur un lien profond à froid, le premier rendu est 'loading' :
    // monter le navigateur à cet instant afficherait l'écran métier — et ses données locales —
    // avant même de savoir s'il y a une session. L'écran ne doit jamais apparaître, pas même
    // le temps d'une image.
    rendreSur('loading', ['expedition']);

    expect(screen.queryByText('navigateur')).toBeNull();
    expect(screen.queryByText(/redirection:/)).toBeNull();
  });

  it('renvoie vers la connexion sur un écran métier sans session', () => {
    rendreSur('unauthenticated', ['expedition']);

    expect(screen.getByText(/redirection:\/login/)).toBeTruthy();
  });

  it.each([['reception'], ['transformation'], ['quarantine']])(
    'protège aussi %s, hors du groupe (tabs)',
    (ecran) => {
      rendreSur('unauthenticated', [ecran]);

      expect(screen.getByText(/redirection:\/login/)).toBeTruthy();
    }
  );

  it('laisse atteindre l’écran de connexion sans session', () => {
    // Sans cette exception, la garde se mordrait la queue : /login redirigerait vers /login.
    rendreSur('unauthenticated', ['login']);

    expect(screen.queryByText(/redirection:/)).toBeNull();
    expect(screen.getByText('navigateur')).toBeTruthy();
  });

  it('laisse atteindre le défi 2FA, qui précède la session complète', () => {
    // `isAuthenticated()` est faux entre le mot de passe et le second facteur : garder cet écran
    // rendrait la 2FA impossible à franchir.
    rendreSur('unauthenticated', ['verify-2fa']);

    expect(screen.queryByText(/redirection:/)).toBeNull();
    expect(screen.getByText('navigateur')).toBeTruthy();
  });

  it('monte le navigateur normalement avec une session valide', () => {
    rendreSur('authenticated', ['expedition']);

    expect(screen.getByText('navigateur')).toBeTruthy();
    expect(screen.queryByText(/redirection:/)).toBeNull();
  });
});
