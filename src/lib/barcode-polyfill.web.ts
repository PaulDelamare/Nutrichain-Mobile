import { BarcodeDetector, setZXingModuleOverrides } from 'barcode-detector/pure';

/**
 * Le décodeur de codes-barres du web, servi DEPUIS LE DÉPÔT et non depuis un CDN.
 *
 * Chrome sous Windows n'implémente pas `BarcodeDetector`. expo-camera charge alors un polyfill
 * (`barcode-detector`) qui va chercher son moteur WebAssembly sur **fastly.jsdelivr.net**, à
 * l'exécution.
 *
 * _Conséquence : sans Internet, le scan caméra est MORT_ — sur une application dont l'argument est
 * précisément « ça marche hors ligne ». La salle de soutenance devenait une dépendance technique.
 *
 * On installe donc nous-mêmes le polyfill, en le pointant sur le `.wasm` du dépôt (`public/`, servi
 * à la racine). expo-camera ne charge le sien QUE si `globalThis.BarcodeDetector` est absent : en
 * arrivant en premier, c'est notre version — hors ligne — qui sert.
 */
setZXingModuleOverrides({
  locateFile: (path: string, prefix: string) =>
    path.endsWith('.wasm') ? '/zxing_reader.wasm' : prefix + path,
});

const globals = globalThis as typeof globalThis & { BarcodeDetector?: unknown };

if (typeof globals.BarcodeDetector === 'undefined') {
  globals.BarcodeDetector = BarcodeDetector;
}
