import { render, screen, fireEvent } from '@testing-library/react-native';
import { Linking } from 'react-native';

import { CodeScanner } from './code-scanner';

const mockOnBarcodeScanned = { current: undefined as ((r: { data: string }) => void) | undefined };

// Permission pilotable par test : la modale change de forme selon `granted`/`canAskAgain`.
const mockPermission = {
  current: { granted: true, canAskAgain: true } as { granted: boolean; canAskAgain: boolean },
};
const mockRequestPermission = jest.fn();

jest.mock('expo-camera', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Text } = require('react-native');
  return {
    useCameraPermissions: () => [mockPermission.current, mockRequestPermission],
    CameraView: (props: { onBarcodeScanned?: (r: { data: string }) => void }) => {
      mockOnBarcodeScanned.current = props.onBarcodeScanned;
      return <Text>camera</Text>;
    },
  };
});

describe('scanner d’emplacement', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockOnBarcodeScanned.current = undefined;
    mockPermission.current = { granted: true, canAskAgain: true };
    jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
  });

  it('ne résout qu’une fois par ouverture, malgré une rafale de la caméra', () => {
    const onScan = jest.fn();
    render(<CodeScanner visible title="Scanner" hint="Placez le code dans le cadre" onClose={jest.fn()} onScan={onScan} />);

    mockOnBarcodeScanned.current?.({ data: 'EQP-1' });
    mockOnBarcodeScanned.current?.({ data: 'EQP-1' });

    expect(onScan).toHaveBeenCalledTimes(1);
  });

  it('redevient utilisable à la réouverture', () => {
    // Le chemin nominal referme la modale depuis le parent, sans passer par « Annuler » :
    // un verrou relâché seulement à la fermeture resterait armé, et le scanner serait mort
    // dès le premier scan — y compris après une erreur d'emplacement, donc sans recours.
    const onScan = jest.fn();
    const { rerender } = render(
      <CodeScanner visible title="Scanner" hint="Placez le code dans le cadre" onClose={jest.fn()} onScan={onScan} />
    );

    mockOnBarcodeScanned.current?.({ data: 'CODE-ERRONE' });

    rerender(<CodeScanner visible={false} title="Scanner" hint="Placez le code dans le cadre" onClose={jest.fn()} onScan={onScan} />);
    rerender(<CodeScanner visible title="Scanner" hint="Placez le code dans le cadre" onClose={jest.fn()} onScan={onScan} />);

    mockOnBarcodeScanned.current?.({ data: 'EQP-2' });

    expect(onScan).toHaveBeenCalledTimes(2);
    expect(onScan).toHaveBeenLastCalledWith('EQP-2');
  });

  // Tant qu'on peut encore demander, le bouton relance le dialogue système natif.
  it('redemande l’accès tant que le refus n’est pas définitif', () => {
    mockPermission.current = { granted: false, canAskAgain: true };
    render(<CodeScanner visible title="Scanner" hint="Placez le code" onClose={jest.fn()} onScan={jest.fn()} />);

    fireEvent.press(screen.getByText(/^Autoriser l.accès$/));
    expect(mockRequestPermission).toHaveBeenCalledTimes(1);
    expect(Linking.openSettings).not.toHaveBeenCalled();
  });

  // Refus DÉFINITIF : requestPermission() ne rouvrirait plus aucun dialogue — bouton mort. La modale
  // n'ayant pas de saisie manuelle, le seul recours est d'ouvrir les réglages système.
  it('renvoie vers les réglages quand le refus est définitif', () => {
    mockPermission.current = { granted: false, canAskAgain: false };
    render(<CodeScanner visible title="Scanner" hint="Placez le code" onClose={jest.fn()} onScan={jest.fn()} />);

    expect(screen.queryByText(/^Autoriser l.accès$/)).toBeNull();
    fireEvent.press(screen.getByText('Ouvrir les réglages'));
    expect(Linking.openSettings).toHaveBeenCalledTimes(1);
    expect(mockRequestPermission).not.toHaveBeenCalled();
  });
});
