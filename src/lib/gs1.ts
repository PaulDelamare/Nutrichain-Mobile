// ── Décoder ce que la caméra a lu ────────────────────────────────────────────────────────────
//
// Trois familles de codes arrivent dans le même scanner :
//   • NOS étiquettes de lot  → une URL GS1 Digital Link (`…/gs1/01/{gtin}/10/{lot}`). Elles ne
//     contiennent PAS le numéro de lot en clair : sans ce décodage, scanner notre propre étiquette
//     ne résout rien.
//   • Les étiquettes fournisseur → un « element string » GS1 (`01…17…10…`).
//   • Tout le reste (saisie manuelle, code maison) → on ne l'interprète pas, on le rend tel quel.

/** Longueur max d'un numéro de lot GS1 (AI 10) — et la borne qu'applique l'API. */
const LOT_NUMBER_MAX_LENGTH = 20;

/** AI de longueur fixe qu'on sait lire, et leur longueur de valeur. */
const FIXED_LENGTH_AIS: Record<string, number> = {
  '00': 18, // SSCC — un colis
  '01': 14, // GTIN — un produit
  '17': 6, // DLC — AAMMJJ
};

/** Séparateur FNC1 (GS, 0x1D) : il clôt un AI de longueur variable. */
const FNC1 = '\x1d';

export interface ScannedCode {
  /** GTIN normalisé sur 14 chiffres (nos produits sont en 13 : sinon rien ne se compare). */
  gtin: string | null;
  /** Numéro de lot (AI 10) — la seule chose avec laquelle on peut retrouver un lot. */
  lotNumber: string | null;
  /** DLC (AI 17) au format `YYYY-MM-DD`. */
  expiry: string | null;
  /** SSCC (AI 00) — identifie un COLIS, jamais un lot. */
  sscc: string | null;
  /** Le code tel qu'il a été lu. */
  raw: string;
}

const empty = (raw: string): ScannedCode => ({
  gtin: null,
  lotNumber: null,
  expiry: null,
  sscc: null,
  raw,
});

/** Un GTIN-13 et un GTIN-14 zéro-paddé désignent le même produit — mais ne s'égalent pas. */
function normalizeGtin(value: string): string | null {
  const digits = value.trim();
  if (!/^\d{8,14}$/.test(digits)) {
    return null;
  }
  return digits.padStart(14, '0');
}

/**
 * AI 17 : `AAMMJJ`. Un jour à « 00 » signifie « fin de mois » dans la norme GS1.
 * Une date impossible (31 février, mois 99) est REFUSÉE, jamais reportée : `Date` la décalerait
 * silencieusement au 3 mars, et une DLC décalée est une donnée sanitaire fausse.
 */
function parseExpiry(value: string): string | null {
  if (!/^\d{6}$/.test(value)) {
    return null;
  }

  const year = 2000 + Number(value.slice(0, 2));
  const month = Number(value.slice(2, 4));
  const day = Number(value.slice(4, 6));

  if (month < 1 || month > 12 || day > 31) {
    return null;
  }

  // Jour 0 → dernier jour du mois : le jour 0 du mois SUIVANT (index `month`, base 0).
  const date =
    day === 0
      ? new Date(Date.UTC(year, month, 0))
      : new Date(Date.UTC(year, month - 1, day));

  // Si `Date` a reporté la date sur le mois suivant, c'est que le jour n'existait pas.
  if (Number.isNaN(date.getTime()) || date.getUTCMonth() !== month - 1) {
    return null;
  }

  return date.toISOString().slice(0, 10);
}

/**
 * Une valeur d'URL peut être percent-encodée — et `decodeURIComponent` JETTE sur un `%` isolé.
 * Laisser passer cette exception tuerait le scanner : le verrou anti-double-scan resterait armé,
 * sans navigation ni message, et plus rien ne réagirait jusqu'au changement d'onglet.
 */
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * `…/gs1/01/{gtin}/10/{lot}/17/{aammjj}` — les paires AI/valeur d'une URL Digital Link.
 *
 * La casse est ignorée : un QR en mode alphanumérique encode l'URL TOUT EN MAJUSCULES, et un
 * `/GS1/` non reconnu ferait passer notre propre étiquette pour un code illisible — donc pour une
 * marchandise inconnue, donc pour une réception en double.
 */
function parseDigitalLink(code: string): ScannedCode | null {
  const match = /\/gs1\/(.+)$/i.exec(code);
  if (!match) {
    return null;
  }

  // Un résolveur GS1 ajoute une query string (`?linkType=all`). Sans la retirer, elle se colle au
  // numéro de lot — qui devient introuvable, et dépasse la limite de 20 caractères.
  const [path] = match[1].split(/[?#]/);
  const segments = path.split('/').filter(Boolean);
  const result = empty(code);

  for (let i = 0; i + 1 < segments.length; i += 2) {
    const ai = segments[i];
    const value = safeDecode(segments[i + 1]);

    if (ai === '01') result.gtin = normalizeGtin(value);
    if (ai === '10') result.lotNumber = value || null;
    if (ai === '17') result.expiry = parseExpiry(value);
    if (ai === '00') result.sscc = value || null;
  }

  return result.gtin || result.lotNumber ? result : null;
}

/**
 * Element string : `01…17…10…`, les AI collés bout à bout.
 *
 * ⚠️ Un AI de longueur VARIABLE (le 10) n'est délimité que par un FNC1 — ou par la fin de la
 * chaîne. Sans lui, `10ABC17261231` est INDÉCIDABLE : « 17 » ouvre-t-il la DLC, ou fait-il partie
 * du numéro de lot ? Un vrai lecteur ne devine pas. Nous non plus : on prend tout ce qui suit.
 * Inventer une coupure enverrait l'opérateur sur la fiche d'un AUTRE lot.
 */
function parseElementString(code: string): ScannedCode | null {
  if (!/^\d{2}/.test(code)) {
    return null;
  }

  const result = empty(code);
  let rest = code;
  let decodedSomething = false;

  while (rest.length >= 2) {
    const ai = rest.slice(0, 2);
    const fixedLength = FIXED_LENGTH_AIS[ai];

    if (fixedLength !== undefined) {
      const value = rest.slice(2, 2 + fixedLength);
      if (value.length < fixedLength) {
        break;
      }

      // Une valeur d'AI à longueur fixe qui ne SE PARSE PAS prouve que ce n'était pas un element
      // string : `171231-ABC123` est un numéro de lot ordinaire, pas une DLC. Le prendre pour un
      // AI 17 malformé rendait un résultat « décodé mais vide », qui court-circuitait le repli
      // « code nu » — l'onglet Scan filait alors en réception au lieu de chercher le lot.
      if (ai === '00') {
        if (!/^\d{18}$/.test(value)) return null;
        result.sscc = value;
      }
      if (ai === '01') {
        const gtin = normalizeGtin(value);
        if (!gtin) return null;
        result.gtin = gtin;
      }
      if (ai === '17') {
        const expiry = parseExpiry(value);
        if (!expiry) return null;
        result.expiry = expiry;
      }

      decodedSomething = true;
      rest = rest.slice(2 + fixedLength);
      if (rest.startsWith(FNC1)) rest = rest.slice(1);
      continue;
    }

    if (ai === '10') {
      const [value] = rest.slice(2).split(FNC1);
      result.lotNumber = value || null;
      decodedSomething = true;
      rest = rest.slice(2 + value.length);
      if (rest.startsWith(FNC1)) rest = rest.slice(1);
      continue;
    }

    // Un AI qu'on ne connaît pas : on ne sait plus où on est dans la chaîne. On s'arrête.
    break;
  }

  return decodedSomething ? result : null;
}

export function parseScannedCode(code: string): ScannedCode {
  const trimmed = code.trim();
  if (trimmed === '') {
    return empty('');
  }

  const parsed =
    parseDigitalLink(trimmed) ??
    parseElementString(trimmed) ??
    // Ni URL, ni element string : c'est probablement un numéro de lot tapé à la main (le champ de
    // saisie annonce « SSCC / LOT / GTIN »). On le PROPOSE comme candidat — c'est le serveur qui
    // tranchera.
    { ...empty(code), lotNumber: trimmed };

  return {
    ...parsed,
    raw: code,
    // La borne s'applique en SORTIE, quelle que soit la façon dont le lot a été lu : un AI 10 fait
    // 20 caractères au plus, et l'API refuse au-delà (400). Un numéro plus long n'est pas un numéro
    // de lot — le présenter comme tel enverrait le scan chercher un lot qui ne peut pas exister,
    // et l'échec serait annoncé à l'opérateur comme une panne réseau.
    lotNumber:
      parsed.lotNumber && parsed.lotNumber.length <= LOT_NUMBER_MAX_LENGTH
        ? parsed.lotNumber
        : null,
  };
}
