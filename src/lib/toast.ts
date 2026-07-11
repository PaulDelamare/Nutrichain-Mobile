import Toast from 'react-native-toast-message';

import { getErrorMessage } from './errors';

/**
 * Un échec s'annonce toujours de la même façon : un titre métier, et le message traduit pour
 * l'opérateur. Le trio catch / Toast / getErrorMessage était recopié à l'identique.
 */
export function toastError(title: string, error: unknown): void {
  Toast.show({ type: 'error', text1: title, text2: getErrorMessage(error) });
}
