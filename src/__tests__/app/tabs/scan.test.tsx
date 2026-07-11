import { render, screen, fireEvent } from '@testing-library/react-native';
import { router } from 'expo-router';

import ScanScreen from '@/app/(tabs)/scan';

const mockOnBarcodeScanned = { current: undefined as ((result: { data: string }) => void) | undefined };

jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  useFocusEffect: (effect: () => void) => effect(),
}));

jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0 }) }));

// La caméra est native : on capture le callback qu'elle recevrait pour le déclencher à la main.
jest.mock('expo-camera', () => {
  const { Text: RNText } = require('react-native');
  return {
    useCameraPermissions: () => [{ granted: true }, jest.fn()],
    CameraView: (props: { onBarcodeScanned?: (r: { data: string }) => void }) => {
      mockOnBarcodeScanned.current = props.onBarcodeScanned;
      return <RNText>camera</RNText>;
    },
  };
});

const mockedRouter = jest.mocked(router);

describe('écran de scan', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockOnBarcodeScanned.current = undefined;
  });

  it('n’ouvre la réception qu’une fois malgré une rafale de la caméra', () => {
    // expo-camera rappelle depuis le processeur natif de frames, sans attendre le re-rendu
    // de React : un verrou dans l'état laisserait passer deux lectures de la même frame,
    // et l'opérateur enregistrerait deux fois la même palette.
    render(<ScanScreen />);

    mockOnBarcodeScanned.current?.({ data: '00376112345678901234' });
    mockOnBarcodeScanned.current?.({ data: '00376112345678901234' });

    expect(mockedRouter.push).toHaveBeenCalledTimes(1);
  });

  it('transmet le code scanné au formulaire de réception', () => {
    render(<ScanScreen />);

    mockOnBarcodeScanned.current?.({ data: 'SSCC-123' });

    expect(mockedRouter.push).toHaveBeenCalledWith({
      pathname: '/reception',
      params: { code: 'SSCC-123' },
    });
  });

  it('accepte une saisie manuelle et ignore une saisie vide', () => {
    // Le scanner échoue sur un code abîmé ou givré : la saisie manuelle est le recours.
    render(<ScanScreen />);

    const input = screen.getByPlaceholderText('3761234567890123');

    fireEvent.changeText(input, '   ');
    expect(mockedRouter.push).not.toHaveBeenCalled();

    fireEvent.changeText(input, '  SSCC-456  ');
    fireEvent(input, 'submitEditing');

    expect(mockedRouter.push).toHaveBeenCalledWith({
      pathname: '/reception',
      params: { code: 'SSCC-456' },
    });
  });
});
