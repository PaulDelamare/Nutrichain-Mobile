/**
 * Couleurs de MARQUE uniquement. Le teal était recopié 23 fois dans 9 fichiers : changer la
 * charte demandait 23 éditions à la main.
 *
 * Les gris, rayons et espacements restent locaux aux écrans : ce sont des valeurs standard
 * qui se ressemblent par coïncidence, pas par couplage — un gris de sous-titre et un gris de
 * label ne changeront jamais ensemble, et les centraliser rendrait les styles moins lisibles.
 */
export const BRAND = {
  primary: '#0D9488',
  dark: '#0F766E',
  light: '#14B8A6',
} as const;

/** Dégradé des boutons d'action principaux. */
export const BRAND_GRADIENT = [BRAND.light, BRAND.primary] as const;

/** Dégradé des en-têtes d'écran. */
export const HEADER_GRADIENT = [BRAND.dark, BRAND.primary] as const;
