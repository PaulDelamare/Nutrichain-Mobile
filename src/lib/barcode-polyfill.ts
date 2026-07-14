/**
 * Rien à faire en natif : le décodage des codes-barres y est fourni par le système (Vision sur iOS,
 * ML Kit sur Android). Le polyfill WebAssembly ne concerne que le navigateur — voir la variante
 * `.web.ts`, que Metro substitue automatiquement.
 */
export {};
