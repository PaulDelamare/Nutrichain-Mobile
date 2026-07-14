import { parseScannedCode } from './gs1';

// Séparateur FNC1 (GS, 0x1D) : le seul moyen de savoir où s'arrête un AI de longueur variable.
const FNC1 = '\x1d';

describe('parseScannedCode', () => {
  describe('nos propres étiquettes — un GS1 Digital Link', () => {
    // C'est ce que l'API imprime réellement (label.service.ts) : le QR d'un lot NutriChain ne
    // contient PAS son numéro de lot, mais une URL. Sans ce décodage, scanner notre propre
    // étiquette ne résout jamais rien.
    it("décode l'URL imprimée sur l'étiquette d'un lot", () => {
      const code = parseScannedCode('https://api.nutrichain.fr/gs1/01/3042040209123/10/260714-ABC123');

      expect(code.gtin).toBe('03042040209123');
      expect(code.lotNumber).toBe('260714-ABC123');
    });

    it('accepte une DLC dans le lien (AI 17)', () => {
      const code = parseScannedCode('https://api.nutrichain.fr/gs1/01/3042040209123/10/LOT9/17/261231');

      expect(code.lotNumber).toBe('LOT9');
      expect(code.expiry).toBe('2026-12-31');
    });

    // Un résolveur GS1 ajoute `?linkType=…`. Collée au numéro, la query string le rend introuvable
    // ET dépasse la limite de 20 caractères — l'API répondrait 400, le mobile crierait à la panne
    // réseau, et l'opérateur réceptionnerait un lot déjà en stock.
    it('ignore la query string du lien', () => {
      const code = parseScannedCode(
        'https://api.nutrichain.fr/gs1/01/3042040209123/10/FRN-77?linkType=all'
      );

      expect(code.lotNumber).toBe('FRN-77');
    });

    // Un QR en mode alphanumérique encode l'URL TOUT EN MAJUSCULES. Un `/GS1/` non reconnu ferait
    // passer notre propre étiquette pour un code illisible — donc pour une marchandise inconnue.
    it('reconnaît le lien même tout en majuscules', () => {
      const code = parseScannedCode('HTTPS://API.NUTRICHAIN.FR/GS1/01/3042040209123/10/FRN-77');

      expect(code.lotNumber).toBe('FRN-77');
    });

    // `decodeURIComponent` JETTE sur un `%` isolé. Laisser passer l'exception tuerait le scanner :
    // le verrou resterait armé, sans navigation ni message — plus rien ne réagirait.
    it('ne jette JAMAIS sur un pourcentage mal encodé', () => {
      expect(() => parseScannedCode('https://x/gs1/01/3042040209123/10/LOT-50%')).not.toThrow();
    });

    it('décode un numéro de lot percent-encodé', () => {
      expect(parseScannedCode('https://x/gs1/01/3042040209123/10/A%2FB').lotNumber).toBe('A/B');
    });
  });

  describe('étiquettes fournisseur — un element string', () => {
    it('décode GTIN, lot et DLC séparés par un FNC1', () => {
      const code = parseScannedCode(`010304204020912317261231${FNC1}10FRN-77`);

      expect(code.gtin).toBe('03042040209123');
      expect(code.expiry).toBe('2026-12-31');
      expect(code.lotNumber).toBe('FRN-77');
    });

    it('décode un AI 10 placé en dernier, sans séparateur', () => {
      const code = parseScannedCode('010304204020912310FRN-77');

      expect(code.gtin).toBe('03042040209123');
      expect(code.lotNumber).toBe('FRN-77');
    });

    // LE piège du GS1 : un AI de longueur variable non délimité est INDÉCIDABLE. Dans
    // « 10ABC1712 », impossible de savoir si « 17 » ouvre la DLC ou fait partie du numéro de lot.
    // Un vrai lecteur ne devine pas — et nous non plus : mieux vaut ne rien affirmer que d'inventer
    // un numéro de lot, qui enverrait l'opérateur sur la fiche d'un AUTRE lot.
    it('refuse de deviner un AI 10 non délimité suivi d’un autre AI', () => {
      const code = parseScannedCode('0103042040209123' + '10ABC' + '17261231');

      expect(code.lotNumber).toBe('ABC17261231');
    });

    // ⚠️ Une vraie étiquette GS1 commence par un SSCC ou un GTIN, JAMAIS par un numéro de lot nu.
    // Un code qui commence par « 10 » est donc bien plus probablement un numéro de lot ordinaire —
    // et le lire comme « AI 10 » transformerait le lot « 10ABC » en « ABC », c'est-à-dire ferait
    // engager UN AUTRE LOT. Face à une ambiguïté indécidable, on refuse d'interpréter.
    it.each([
      ['10ABC'],
      ['10-2026-045'],
      ['17ABC'],
      ['00ABC'],
    ])('ne prend pas « %s » pour une étiquette GS1 : c’est un numéro de lot', (code) => {
      expect(parseScannedCode(code).lotNumber).toBe(code);
    });

    it('décode le SSCC (AI 00) — c’est un colis, pas un lot', () => {
      const code = parseScannedCode('00376112345678901234');

      expect(code.sscc).toBe('376112345678901234');
      expect(code.lotNumber).toBeNull();
    });
  });

  describe('les codes qu’on ne sait pas décoder', () => {
    // Le champ de saisie manuelle annonce « SSCC / LOT / GTIN » : un opérateur y tape un numéro de
    // lot nu. C'est un candidat légitime — mais on ne l'INVENTE pas, on le propose tel quel.
    it('traite un code nu comme un numéro de lot candidat', () => {
      const code = parseScannedCode('FRN-2026-045');

      expect(code.lotNumber).toBe('FRN-2026-045');
      expect(code.gtin).toBeNull();
    });

    // Un numéro de lot ordinaire peut commencer par les mêmes chiffres qu'un identifiant GS1. Une
    // valeur d'AI qui ne se parse pas PROUVE que ce n'était pas un element string : le prendre pour
    // un AI malformé rendait un résultat « décodé mais vide », qui court-circuitait ce repli — et
    // l'onglet Scan filait en réception au lieu de chercher le lot.
    it.each([
      ['une fausse DLC', '171231-ABC123'],
      ['un faux GTIN', '01ABC-2026-XYZ'],
    ])('rend tel quel un numéro de lot qui ressemble à %s', (_cas, code) => {
      expect(parseScannedCode(code).lotNumber).toBe(code);
    });

    it('rogne les espaces', () => {
      expect(parseScannedCode('  FRN-1  ').lotNumber).toBe('FRN-1');
    });

    it('ne renvoie rien pour une chaîne vide', () => {
      const code = parseScannedCode('   ');

      expect(code.lotNumber).toBeNull();
      expect(code.gtin).toBeNull();
      expect(code.raw).toBe('');
    });

    // Un numéro de lot GS1 fait 20 caractères au plus (AI 10), et l'API refuse au-delà (400).
    // Un code plus long n'est pas un numéro de lot : ne pas le présenter comme tel. La borne
    // s'applique à TOUTES les formes — un lot trop long lu dans une URL enverrait le scan chercher
    // un lot impossible, et l'échec serait annoncé à l'opérateur comme une panne réseau.
    it.each([
      ['un code nu', 'A'.repeat(21)],
      ['un lien Digital Link', `https://x/gs1/01/3042040209123/10/${'A'.repeat(21)}`],
      ['un element string', `0103042040209123${'10' + 'A'.repeat(21)}`],
    ])('ne prend pas %s trop long pour un numéro de lot', (_cas, raw) => {
      expect(parseScannedCode(raw).lotNumber).toBeNull();
    });

    it("garde toujours le code d'origine", () => {
      expect(parseScannedCode('n’importe quoi').raw).toBe('n’importe quoi');
    });
  });

  describe('le GTIN', () => {
    // Nos produits ont un GTIN de 13 chiffres en base (seed), alors qu'une étiquette GS1-128 porte
    // un GTIN-14 zéro-paddé. Sans normalisation, les deux ne se compareraient JAMAIS.
    it('normalise un GTIN-13 sur 14 chiffres', () => {
      expect(parseScannedCode('https://x/gs1/01/3042040209123/10/L1').gtin).toBe('03042040209123');
    });

    it('laisse un GTIN-14 tel quel', () => {
      expect(parseScannedCode('https://x/gs1/01/03042040209123/10/L1').gtin).toBe('03042040209123');
    });
  });

  describe('la DLC (AI 17)', () => {
    it('décode AAMMJJ en date ISO', () => {
      expect(parseScannedCode(`0103042040209123${FNC1}17270105`).expiry).toBe('2027-01-05');
    });

    // GS1 : « 00 » en jour signifie « fin de mois ». Tester février seul se rassurait tout seul —
    // ma première version PERDAIT la fin janvier (elle retombait au 31 décembre précédent).
    it.each([
      ['janvier', '270100', '2027-01-31'],
      ['février', '270200', '2027-02-28'],
      ['février bissextile', '280200', '2028-02-29'],
      ['décembre', '271200', '2027-12-31'],
    ])('traite un jour « 00 » comme la fin du mois — %s', (_mois, ai17, attendu) => {
      expect(parseScannedCode(`0103042040209123${FNC1}17${ai17}`).expiry).toBe(attendu);
    });

    // `Date` reporte silencieusement un 31 février au 3 mars. Une DLC décalée est une donnée
    // sanitaire fausse : mieux vaut ne rien dire.
    it.each([
      ['un mois impossible', '279901'],
      ['un 31 février', '270231'],
      ['un 32e jour', '270132'],
    ])('ignore une DLC impossible plutôt que de la décaler — %s', (_cas, ai17) => {
      expect(parseScannedCode(`0103042040209123${FNC1}17${ai17}`).expiry).toBeNull();
    });
  });
});
