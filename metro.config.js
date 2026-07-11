const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

/**
 * `expo-sqlite` s'appuie sur WebAssembly côté web, et Metro ne résout pas `.wasm` par défaut :
 * sans ces deux réglages, le build web échoue et `npm run web` est inutilisable.
 *
 * Les en-têtes COOP/COEP sont exigés par le moteur SQLite (SharedArrayBuffer).
 * Voir https://docs.expo.dev/versions/latest/sdk/sqlite/#web-setup
 */
config.resolver.assetExts.push('wasm');

config.server.enhanceMiddleware = (middleware) => {
  return (req, res, next) => {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
    return middleware(req, res, next);
  };
};

module.exports = config;
