import { renderHook, waitFor } from '@testing-library/react-native';

import { isAuthenticated } from '@/lib/api';

import { useAuthStatus } from './use-auth-status';

jest.mock('@/lib/api');

const mockedIsAuthenticated = jest.mocked(isAuthenticated);

describe('useAuthStatus', () => {
  beforeEach(() => jest.clearAllMocks());

  it('part de l’état chargement', async () => {
    mockedIsAuthenticated.mockResolvedValue(true);

    const { result } = renderHook(() => useAuthStatus());

    expect(result.current).toBe('loading');
    await waitFor(() => expect(result.current).not.toBe('loading'));
  });

  it('passe à authentifié quand un jeton existe', async () => {
    mockedIsAuthenticated.mockResolvedValue(true);

    const { result } = renderHook(() => useAuthStatus());

    await waitFor(() => expect(result.current).toBe('authenticated'));
  });

  it('passe à non authentifié sans jeton', async () => {
    mockedIsAuthenticated.mockResolvedValue(false);

    const { result } = renderHook(() => useAuthStatus());

    await waitFor(() => expect(result.current).toBe('unauthenticated'));
  });
});
