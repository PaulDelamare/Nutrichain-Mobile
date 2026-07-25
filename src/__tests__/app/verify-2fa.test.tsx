import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { useFonts } from '@expo-google-fonts/rajdhani';
import { router } from 'expo-router';

import { verifyTwoFactorTotp } from '@/lib/api';
import { ApiError } from '@/lib/errors';

import VerifyTwoFactorScreen from '@/app/verify-2fa';

jest.mock('@expo-google-fonts/rajdhani', () => ({
  useFonts: jest.fn(),
  Rajdhani_400Regular: 'Rajdhani_400Regular',
  Rajdhani_700Bold: 'Rajdhani_700Bold',
}));
jest.mock('@/lib/api');
jest.mock('expo-router', () => ({
  router: { replace: jest.fn(), push: jest.fn() },
  useLocalSearchParams: jest.fn(() => ({})),
}));

const mockedUseFonts = jest.mocked(useFonts);
const mockedVerify = jest.mocked(verifyTwoFactorTotp);
const mockedRouter = jest.mocked(router);

function fonts(loaded: boolean, error: Error | null = null) {
  mockedUseFonts.mockReturnValue([loaded, error] as never);
}

describe('écran de vérification 2FA', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedVerify.mockResolvedValue(undefined);
    fonts(true);
  });

  it('valide le code et redirige vers l’application', async () => {
    render(<VerifyTwoFactorScreen />);

    fireEvent.changeText(screen.getByPlaceholderText('123456'), '123456');
    fireEvent.press(screen.getByText('Valider'));

    await waitFor(() => expect(mockedVerify).toHaveBeenCalledWith('123456'));
    expect(mockedRouter.replace).toHaveBeenCalledWith('/(tabs)');
  });

  it('n’envoie rien tant que le code n’a pas 6 chiffres', () => {
    render(<VerifyTwoFactorScreen />);

    fireEvent.changeText(screen.getByPlaceholderText('123456'), '123');
    fireEvent.press(screen.getByText('Valider'));

    expect(mockedVerify).not.toHaveBeenCalled();
  });

  it('n’accuse pas un mot de passe erroné sur un code TOTP invalide, et vide le champ', async () => {
    // Better-Auth ne renvoie aucun `field` sur un code invalide : un 401 générique aurait été
    // traduit par « Email ou mot de passe incorrect », un message absurde sur cet écran.
    mockedVerify.mockRejectedValue(new ApiError('Invalid code', 401));

    render(<VerifyTwoFactorScreen />);
    const input = screen.getByPlaceholderText('123456');
    fireEvent.changeText(input, '000000');
    fireEvent.press(screen.getByText('Valider'));

    await waitFor(() => expect(mockedVerify).toHaveBeenCalled());
    expect(mockedRouter.replace).not.toHaveBeenCalled();
    expect(input.props.value).toBe('');
  });
});
