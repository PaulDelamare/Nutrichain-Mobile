import Toast from 'react-native-toast-message';

import { ApiError } from './errors';
import { toastError, toastMessage } from './toast';

jest.mock('react-native-toast-message', () => ({ show: jest.fn() }));

const show = jest.mocked(Toast.show);

describe('toastMessage', () => {
  it('affiche le message métier tel quel', () => {
    // Ces messages passaient par `toastError(titre, new Error(message))` : `getErrorMessage` ne
    // sait lire que les `ApiError` et renvoyait « Une erreur est survenue. ». L'explication —
    // quel lot, pourquoi il est refusé — n'atteignait JAMAIS l'opérateur.
    toastMessage('Lot inconnu', 'Ce code ne correspond à aucun lot de votre organisation.');

    expect(show).toHaveBeenCalledWith({
      type: 'error',
      text1: 'Lot inconnu',
      text2: 'Ce code ne correspond à aucun lot de votre organisation.',
    });
  });
});

describe('toastError', () => {
  it('traduit une erreur technique pour l’opérateur', () => {
    toastError('Transformation refusée', new ApiError('Erreur réseau', 0));

    expect(show).toHaveBeenCalledWith({
      type: 'error',
      text1: 'Transformation refusée',
      text2: 'Serveur injoignable. Vérifiez votre connexion.',
    });
  });
});
