import type { BarcodeType } from 'expo-camera';

/**
 * Les formats que la caméra doit décoder.
 *
 * ⚠️ Sur le WEB, sans cette liste, le scanner n'est **jamais démarré** :
 * `isScannerEnabled = !!barcodeTypes?.length && !!onBarcodeScanned` (expo-camera, ExpoCamera.web.js).
 * `onBarcodeScanned` n'était donc jamais appelé — et la démonstration se fait dans un navigateur.
 *
 * ⚠️ Sur le NATIF, la prop n'est pas lue : le module scanne déjà TOUS les formats. Restreindre la
 * liste ne « configurerait » donc rien, ça RÉGRESSERAIT le natif. D'où la liste complète : elle
 * rétablit le web sans rien retirer au natif.
 *
 * On y trouve ce dont le métier a besoin : `qr` (nos étiquettes GS1 Digital Link), `datamatrix` et
 * `code128` (GS1-128 des fournisseurs), `ean13`/`ean8` (produits de détail), `itf14` (colis).
 */
export const SCANNED_BARCODE_TYPES: BarcodeType[] = [
  'qr',
  'datamatrix',
  'code128',
  'code39',
  'code93',
  'codabar',
  'ean13',
  'ean8',
  'itf14',
  'upc_a',
  'upc_e',
  'pdf417',
  'aztec',
];
