import { shelfWithdrawalBlockedReason } from './roles';
import { withdrawalQuantityError, withdrawalReasonError } from './withdrawals';

describe('withdrawalReasonError', () => {
  it('refuse un motif plus court que ce que le serveur accepte', () => {
    // Mêmes bornes que l'API : partir en requête pour se faire refuser fait perdre le réseau et
    // la patience de l'opérateur.
    expect(withdrawalReasonError('abc')).toContain('trop court');
  });

  it('accepte un motif conforme', () => {
    expect(withdrawalReasonError('Retrait du rayon apres rappel')).toBeNull();
  });

  it("refuse un motif d'espaces, qui n'informe personne", () => {
    expect(withdrawalReasonError('        ')).toContain('trop court');
  });
});

describe('withdrawalQuantityError', () => {
  it('refuse zéro et les valeurs négatives', () => {
    expect(withdrawalQuantityError('0', '100')).toContain('positive');
    expect(withdrawalQuantityError('-5', '100')).toContain('positive');
  });

  it('refuse au-delà du reste à retirer annoncé par le serveur', () => {
    expect(withdrawalQuantityError('101', '100')).toContain('reste à retirer');
  });

  it('accepte exactement le reste — le dernier retrait légitime', () => {
    expect(withdrawalQuantityError('100', '100')).toBeNull();
  });

  it('accepte la virgule décimale, que le clavier du terrain produit', () => {
    expect(withdrawalQuantityError('12,5', '100')).toBeNull();
  });

  it('refuse une saisie qui n’est pas un nombre', () => {
    expect(withdrawalQuantityError('douze', '100')).toContain('positive');
  });
});

describe('shelfWithdrawalBlockedReason', () => {
  /**
   * La garde est PLUS large que celle du rappel, et c'est voulu : un retrait est un fait rapporté
   * par un magasin, pas une décision qualité. Refuser l'opérateur bloquerait celui qui prend
   * l'appel, alors que l'API l'accepte.
   */
  it("autorise l'opérateur, que le rappel refuse", () => {
    expect(shelfWithdrawalBlockedReason('operator')).toBeNull();
  });

  it('autorise les rôles qualité', () => {
    expect(shelfWithdrawalBlockedReason('quality')).toBeNull();
    expect(shelfWithdrawalBlockedReason('admin')).toBeNull();
    expect(shelfWithdrawalBlockedReason('owner')).toBeNull();
  });

  it('refuse la lecture seule, en nommant le rôle', () => {
    expect(shelfWithdrawalBlockedReason('viewer')).toContain('lecture seule');
  });

  /** Trois états : « on ne sait pas » n'est pas « vous n'avez pas le droit ». */
  it('distingue un rôle non vérifié d’un rôle refusé', () => {
    const inconnu = shelfWithdrawalBlockedReason(null);

    expect(inconnu).toContain('non verifie');
    expect(inconnu).not.toContain('lecture seule');
  });
});
