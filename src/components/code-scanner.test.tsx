import { render } from '@testing-library/react-native';

import { CodeScanner } from './code-scanner';

const mockOnBarcodeScanned = { current: undefined as ((r: { data: string }) => void) | undefined };

jest.mock('expo-camera', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Text } = require('react-native');
  return {
    useCameraPermissions: () => [{ granted: true }, jest.fn()],
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
});
