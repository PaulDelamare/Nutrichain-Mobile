import { apiClient } from './api';
import { CACHE_TTL_MS, readCache, writeCache } from './cache';

export interface Supplier {
  id: string;
  nom_ferme: string;
}

export interface Product {
  id: string;
  nom: string;
  unite_reference: string;
  /** GTIN du produit (non-null côté serveur) : la clé qui relie un code-barres scanné à ce produit. */
  code_gtin: string;
}

interface Envelope<T> {
  data: T;
}

/**
 * Réseau d'abord, cache en secours : le catalogue change rarement, mais sans lui
 * l'opérateur ne peut rien saisir — et c'est hors réseau que l'app doit servir.
 */
async function load<T>(key: string, url: string): Promise<T> {
  try {
    const { data } = await apiClient.get<Envelope<T>>(url);
    await writeCache(key, data.data);
    return data.data;
  } catch (error) {
    // Cache en secours, mais PAS à vie : au-delà du TTL, un catalogue d'âge inconnu est traité comme
    // absent → l'erreur remonte (« catalogue indisponible »), plutôt qu'un produit peut-être retiré.
    const cached = await readCache<T>(key, CACHE_TTL_MS);
    if (cached) {
      return cached;
    }
    throw error;
  }
}

export function loadSuppliers(): Promise<Supplier[]> {
  return load<Supplier[]>('suppliers', '/api/organization/suppliers');
}

export function loadProducts(): Promise<Product[]> {
  return load<Product[]>('products', '/api/traceability/products');
}
