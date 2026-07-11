import Toast from 'react-native-toast-message';

import { getErrorMessage } from './errors';

/**
 * Un échec s'annonce toujours de la même façon : un titre métier, et le message traduit pour
 * l'opérateur. Le trio catch / Toast / getErrorMessage était recopié à l'identique.
 */
export function toastError(title: string, error: unknown): void {
  Toast.show({ type: 'error', text1: title, text2: getErrorMessage(error) });
}

/**
 * Un refus métier (lot inconnu, statut bloquant) n'est pas une erreur technique : il n'a rien à
 * traduire. L'emballer dans un `Error` pour le passer à `toastError` le faisait disparaître —
 * `getErrorMessage` ne sait lire que les `ApiError` et renvoyait « Une erreur est survenue. ».
 */
export function toastMessage(title: string, message: string): void {
  Toast.show({ type: 'error', text1: title, text2: message });
}
