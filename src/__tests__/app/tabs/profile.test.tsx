import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';

import { useCurrentUser } from '@/hooks/use-current-user';
import { signOut } from '@/lib/api';

import ProfileScreen from '@/app/(tabs)/profile';

jest.mock('@/hooks/use-current-user');
jest.mock('@/lib/api');
jest.mock('expo-router', () => ({ router: { replace: jest.fn() } }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0 }) }));

const mockedUser = jest.mocked(useCurrentUser);
const mockedSignOut = jest.mocked(signOut);
const mockedRouter = jest.mocked(router);

const OPERATEUR = {
  id: 'u-1',
  name: 'Paul Delamare',
  email: 'paul@nutrichain.local',
  role: 'logistics_operator',
  organizationId: 'org-1',
};

describe('écran de profil', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedSignOut.mockResolvedValue(undefined);
    mockedUser.mockReturnValue({ user: OPERATEUR, loading: false });
  });

  it('affiche l’utilisateur réellement connecté', async () => {
    // L'écran affichait « Marie L. » en dur, venue de la maquette.
    render(<ProfileScreen />);

    expect(screen.getByText('Paul Delamare')).toBeTruthy();
    expect(screen.getByText('paul@nutrichain.local')).toBeTruthy();
  });

  it('traduit le rôle technique en langage métier', () => {
    render(<ProfileScreen />);

    expect(screen.getByText('Opérateur logistique')).toBeTruthy();
  });

  it('déconnecte et renvoie à l’écran de connexion', async () => {
    render(<ProfileScreen />);

    fireEvent.press(screen.getByText('Se déconnecter'));

    await waitFor(() => expect(mockedSignOut).toHaveBeenCalled());
    expect(mockedRouter.replace).toHaveBeenCalledWith('/login');
  });

  it('reste utilisable pendant le chargement de l’identité', () => {
    // La déconnexion doit rester possible même si /api/me tarde ou échoue : sinon un jeton
    // périmé enferme l'opérateur sur un écran dont il ne peut plus sortir.
    mockedUser.mockReturnValue({ user: null, loading: true });

    render(<ProfileScreen />);

    expect(screen.getByText('Se déconnecter')).toBeTruthy();
  });
});
