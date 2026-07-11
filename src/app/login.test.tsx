import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { useFonts } from '@expo-google-fonts/rajdhani';
import { router } from 'expo-router';

import { signIn } from '@/lib/api';
import { ApiError } from '@/lib/errors';

import LoginScreen from './login';

jest.mock('@expo-google-fonts/rajdhani', () => ({
  useFonts: jest.fn(),
  Rajdhani_400Regular: 'Rajdhani_400Regular',
  Rajdhani_700Bold: 'Rajdhani_700Bold',
}));
jest.mock('@/lib/api');
jest.mock('expo-router', () => ({ router: { replace: jest.fn() } }));

const mockedUseFonts = jest.mocked(useFonts);
const mockedSignIn = jest.mocked(signIn);
const mockedRouter = jest.mocked(router);

/** `useFonts` renvoie [chargée, erreur]. */
function fonts(loaded: boolean, error: Error | null = null) {
  mockedUseFonts.mockReturnValue([loaded, error] as never);
}

describe('écran de connexion', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedSignIn.mockResolvedValue(undefined);
    fonts(true);
  });

  it('reste utilisable quand la police ne se charge pas', async () => {
    // L'erreur de `useFonts` était ignorée et l'écran renvoyait `null` : une police
    // introuvable laissait donc l'écran de connexion VIDE À VIE. L'application est morte,
    // sans message, et sans diagnostic possible sur le terrain.
    fonts(false, new Error('police introuvable'));

    render(<LoginScreen />);

    expect(screen.getByText('Se connecter')).toBeTruthy();
  });

  it('n’affiche rien tant que la police charge encore', () => {
    // Le cas nominal : on attend, mais sans jamais s'y figer (cf. test précédent).
    fonts(false);

    render(<LoginScreen />);

    expect(screen.queryByText('Se connecter')).toBeNull();
  });

  it('refuse un email mal formé', () => {
    render(<LoginScreen />);

    fireEvent.changeText(screen.getByPlaceholderText(/prenom.nom/), 'pas-un-email');
    fireEvent(screen.getByPlaceholderText(/prenom.nom/), 'blur');

    expect(screen.getByText(/Format d'email invalide/)).toBeTruthy();
  });

  it('connecte et redirige vers l’application', async () => {
    render(<LoginScreen />);

    fireEvent.changeText(screen.getByPlaceholderText(/prenom.nom/), 'op@nutrichain.local');
    fireEvent.changeText(screen.getByPlaceholderText('••••••••'), 'motdepasse');
    fireEvent.press(screen.getByText('Se connecter'));

    await waitFor(() => expect(mockedSignIn).toHaveBeenCalledWith('op@nutrichain.local', 'motdepasse'));
    expect(mockedRouter.replace).toHaveBeenCalledWith('/(tabs)');
  });

  it('ne connecte pas et ne redirige pas quand l’API refuse', async () => {
    mockedSignIn.mockRejectedValue(new ApiError('Invalid credentials', 401));

    render(<LoginScreen />);

    fireEvent.changeText(screen.getByPlaceholderText(/prenom.nom/), 'op@nutrichain.local');
    fireEvent.changeText(screen.getByPlaceholderText('••••••••'), 'mauvais');
    fireEvent.press(screen.getByText('Se connecter'));

    await waitFor(() => expect(mockedSignIn).toHaveBeenCalled());
    expect(mockedRouter.replace).not.toHaveBeenCalled();
  });
});
