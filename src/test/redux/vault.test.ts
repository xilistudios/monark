import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { configureStore } from '@reduxjs/toolkit';
import vaultReducer, {
  addVault,
  setStorageProviders,
  addStorageProvider,
  removeStorageProvider,
  setDefaultStorageProvider,
  setProviderStatus,
  setCloudVaults,
  syncCloudVault,
  setVaultCredential,
  setVaultEntries,
  lockVault,
  isCloudVault,
  getVaultProvider,
  createCloudVault,
  migrateVaultToCloud,
  migrateVaultToLocal,
  loadVaultStateFromSettings,
  type Vault,
} from '../../redux/actions/vault';
import type {
  StorageProvider,
  StorageProviderType,
} from '../../interfaces/cloud-storage.interface';
import type { Entry, DataEntry } from '../../interfaces/vault.interface';

const mockVaultStateCommands = vi.hoisted(() => ({
  load: vi.fn().mockResolvedValue({
    vaults: [],
    defaultProvider: null,
    providerStatus: {},
  }),
  save: vi.fn(),
  persistVaultsSnapshot: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../services/vaultState', () => ({
  VaultStateCommands: mockVaultStateCommands,
}))

const createEntry = (
  overrides: Partial<Omit<DataEntry, 'entry_type'>> = {}
): Entry => ({
  id: overrides.id ?? 'entry-1',
  entry_type: 'entry',
  name: overrides.name ?? 'Test Entry',
  data_type: overrides.data_type ?? 'note',
  created_at: overrides.created_at ?? '2023-01-01T00:00:00Z',
  updated_at: overrides.updated_at ?? '2023-01-01T00:00:00Z',
  fields: overrides.fields ?? ([] as DataEntry['fields']),
  tags: overrides.tags ?? ['test'],
});

describe('Vault Redux State Extensions', () => {
  let store: any;

  beforeEach(() => {
    mockVaultStateCommands.load.mockClear();
    mockVaultStateCommands.save.mockClear();
    mockVaultStateCommands.persistVaultsSnapshot.mockClear();

    store = configureStore({
      reducer: {
        vault: vaultReducer,
      },
    });
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  describe('Vault Interface Extensions', () => {
    it('should create a local vault with default storage type', () => {
      const localVault: Vault = {
        id: 'vault-1',
        name: 'Local Vault',
        path: '/path/to/vault.bc',
        storageType: 'local',
        isLocked: true,
        volatile: {
          credential: '',
          entries: [],
          navigationPath: '/',
        },
      };

      store.dispatch(addVault(localVault));
      const state = store.getState().vault;

      expect(state.vaults).toHaveLength(1);
      expect(state.vaults[0].storageType).toBe('local');
      expect(state.vaults[0].providerId).toBeUndefined();
      expect(state.vaults[0].cloudMetadata).toBeUndefined();
    });

    it('should create a cloud vault with proper metadata', () => {
      const cloudVault: Vault = {
        id: 'vault-2',
        name: 'Cloud Vault',
        path: 'cloud-file-id',
        storageType: 'cloud',
        providerId: 'google-drive',
        cloudMetadata: {
          fileId: 'cloud-file-id',
          provider: 'google-drive',
          lastSync: '2023-01-01T00:00:00Z',
        },
        isLocked: true,
        volatile: {
          credential: '',
          entries: [],
          navigationPath: '/',
        },
      };

      store.dispatch(addVault(cloudVault));
      const state = store.getState().vault;

      expect(state.vaults).toHaveLength(1);
      expect(state.vaults[0].storageType).toBe('cloud');
      expect(state.vaults[0].providerId).toBe('google-drive');
      expect(state.vaults[0].cloudMetadata).toBeDefined();
      expect(state.vaults[0].cloudMetadata?.fileId).toBe('cloud-file-id');
    });
  });

  describe('Storage Provider Actions', () => {
    const mockProvider: StorageProvider = {
      name: 'google-drive',
      provider_type: 'google_drive' as StorageProviderType,
      is_default: false,
    };

    it('should set storage providers', async () => {
      const providers = [mockProvider];
      store.dispatch(setStorageProviders(providers));

      const state = store.getState().vault;
      expect(state.providers).toEqual(providers);
      expect(mockVaultStateCommands.persistVaultsSnapshot).toHaveBeenCalled();
    });

    it('should add a storage provider', () => {
      store.dispatch(addStorageProvider(mockProvider));

      const state = store.getState().vault;
      expect(state.providers).toHaveLength(1);
      expect(state.providers[0]).toEqual(mockProvider);
    });

    it('should remove a storage provider and update associated vaults', () => {
      // Add a provider and a vault that uses it
      store.dispatch(addStorageProvider(mockProvider));

      const cloudVault: Vault = {
        id: 'vault-1',
        name: 'Cloud Vault',
        path: 'cloud-file-id',
        storageType: 'cloud',
        providerId: 'google-drive',
        isLocked: true,
        volatile: {
          credential: '',
          entries: [],
          navigationPath: '/',
        },
      };
      store.dispatch(addVault(cloudVault));

      // Remove the provider
      store.dispatch(removeStorageProvider('google-drive'));

      const state = store.getState().vault;
      expect(state.providers).toHaveLength(0);
      expect(state.vaults[0].storageType).toBe('local');
      expect(state.vaults[0].providerId).toBeUndefined();
      expect(state.vaults[0].cloudMetadata).toBeUndefined();
      expect(mockVaultStateCommands.persistVaultsSnapshot).toHaveBeenCalled();
    });

    it('should set default storage provider', () => {
      store.dispatch(setDefaultStorageProvider('google-drive'));

      const state = store.getState().vault;
      expect(state.defaultProvider).toBe('google-drive');
      expect(mockVaultStateCommands.persistVaultsSnapshot).toHaveBeenCalled();
    });

    it('should set provider authentication status', () => {
      store.dispatch(
        setProviderStatus({
          providerId: 'google-drive',
          status: 'authenticated',
        })
      );

      const state = store.getState().vault;
      expect(state.providerStatus['google-drive']).toBe('authenticated');
      expect(mockVaultStateCommands.persistVaultsSnapshot).toHaveBeenCalled();
    });
  });

  describe('Cloud Vault Actions', () => {
    it('should set cloud vaults list', () => {
      const cloudVaults: Vault[] = [
        {
          id: 'vault-1',
          name: 'Cloud Vault 1',
          path: 'file-id-1',
          storageType: 'cloud',
          providerId: 'google-drive',
          isLocked: true,
          volatile: {
            credential: '',
            entries: [],
            navigationPath: '/',
          },
        },
      ];

      store.dispatch(setCloudVaults(cloudVaults));

      const state = store.getState().vault;
      expect(state.vaults).toHaveLength(1);
      expect(state.vaults[0].storageType).toBe('cloud');
      expect(mockVaultStateCommands.persistVaultsSnapshot).toHaveBeenCalled();
    });

    it('should sync cloud vault and update lastSync time', () => {
      const cloudVault: Vault = {
        id: 'vault-1',
        name: 'Cloud Vault',
        path: 'cloud-file-id',
        storageType: 'cloud',
        providerId: 'google-drive',
        cloudMetadata: {
          fileId: 'cloud-file-id',
          provider: 'google-drive',
        },
        isLocked: true,
        volatile: {
          credential: '',
          entries: [],
          navigationPath: '/',
        },
      };

      store.dispatch(addVault(cloudVault));
      store.dispatch(syncCloudVault('vault-1'));

      const state = store.getState().vault;
      expect(state.vaults[0].cloudMetadata?.lastSync).toBeDefined();
      expect(mockVaultStateCommands.persistVaultsSnapshot).toHaveBeenCalled();
    });
  });

  describe('Cloud Vault Error Handling', () => {
    it('should handle provider removal with dependent vaults', () => {
      const mockProvider: StorageProvider = {
        name: 'google-drive',
        provider_type: 'google_drive' as StorageProviderType,
        is_default: false,
      };

      // Add provider and vault
      store.dispatch(addStorageProvider(mockProvider));

      const cloudVault: Vault = {
        id: 'dependent-vault',
        name: 'Dependent Vault',
        path: 'cloud-file-id',
        storageType: 'cloud',
        providerId: 'google-drive',
        cloudMetadata: {
          fileId: 'cloud-file-id',
          provider: 'google-drive',
          lastSync: '2023-01-01T00:00:00Z',
        },
        isLocked: true,
        volatile: {
          credential: '',
          entries: [],
          navigationPath: '/',
        },
      };
      store.dispatch(addVault(cloudVault));

      // Remove provider
      store.dispatch(removeStorageProvider('google-drive'));

      const state = store.getState().vault;
      expect(state.providers).toHaveLength(0);
      // Vault should be migrated to local
      expect(state.vaults[0].storageType).toBe('local');
      expect(state.vaults[0].providerId).toBeUndefined();
      expect(state.vaults[0].cloudMetadata).toBeUndefined();
    });

    it('should handle cloud vault sync status updates', () => {
      const cloudVault: Vault = {
        id: 'sync-status-vault',
        name: 'Sync Status Vault',
        path: 'cloud-file-id',
        storageType: 'cloud',
        providerId: 'google-drive',
        cloudMetadata: {
          fileId: 'cloud-file-id',
          provider: 'google-drive',
        },
        isLocked: false,
        volatile: {
          credential: 'test-password',
          entries: [],
          navigationPath: '/',
        },
      };

      store.dispatch(addVault(cloudVault));

      // Update sync status
      store.dispatch(syncCloudVault('sync-status-vault'));

      const state = store.getState().vault;
      expect(state.vaults[0].cloudMetadata?.lastSync).toBeDefined();
    });

    it('should handle multiple cloud vaults from different providers', () => {
      const provider1: StorageProvider = {
        name: 'google-drive-primary',
        provider_type: 'google_drive' as StorageProviderType,
        is_default: false,
      };

      const provider2: StorageProvider = {
        name: 'google-drive-secondary',
        provider_type: 'google_drive' as StorageProviderType,
        is_default: false,
      };

      store.dispatch(addStorageProvider(provider1));
      store.dispatch(addStorageProvider(provider2));

      const cloudVault1: Vault = {
        id: 'vault-1',
        name: 'Cloud Vault 1',
        path: 'file-id-1',
        storageType: 'cloud',
        providerId: 'google-drive-primary',
        isLocked: true,
        volatile: {
          credential: '',
          entries: [],
          navigationPath: '/',
        },
      };

      const cloudVault2: Vault = {
        id: 'vault-2',
        name: 'Cloud Vault 2',
        path: 'file-id-2',
        storageType: 'cloud',
        providerId: 'google-drive-secondary',
        isLocked: true,
        volatile: {
          credential: '',
          entries: [],
          navigationPath: '/',
        },
      };

      store.dispatch(addVault(cloudVault1));
      store.dispatch(addVault(cloudVault2));

      const state = store.getState().vault;
      expect(state.vaults).toHaveLength(2);
      expect(state.vaults[0].providerId).toBe('google-drive-primary');
      expect(state.vaults[1].providerId).toBe('google-drive-secondary');
    });

    it('should handle cloud vault credential management', () => {
      const cloudVault: Vault = {
        id: 'credential-vault',
        name: 'Credential Vault',
        path: 'cloud-file-id',
        storageType: 'cloud',
        providerId: 'google-drive',
        isLocked: true,
        volatile: {
          credential: '',
          entries: [],
          navigationPath: '/',
        },
      };

      store.dispatch(addVault(cloudVault));

      // Set credential
      store.dispatch(
        setVaultCredential({
          vaultId: 'credential-vault',
          credential: 'test-password',
        })
      );

      const state = store.getState().vault;
      expect(state.vaults[0].volatile.credential).toBe('test-password');
      expect(mockVaultStateCommands.persistVaultsSnapshot).toHaveBeenCalled();
    });

    it('should handle cloud vault entry management', () => {
      const cloudVault: Vault = {
        id: 'entry-vault',
        name: 'Entry Vault',
        path: 'cloud-file-id',
        storageType: 'cloud',
        providerId: 'google-drive',
        isLocked: false,
        volatile: {
          credential: 'test-password',
          entries: [],
          navigationPath: '/',
        },
      };

      store.dispatch(addVault(cloudVault));

      // Set entries
      const entries: Entry[] = [createEntry()];

      store.dispatch(
        setVaultEntries({
          vaultId: 'entry-vault',
          entries,
        })
      );

      const state = store.getState().vault;
      expect(state.vaults[0].volatile.entries).toEqual(entries);
      expect(mockVaultStateCommands.persistVaultsSnapshot).toHaveBeenCalled();
    });

    it('should handle cloud vault locking and unlocking', () => {
      const cloudVault: Vault = {
        id: 'lock-vault',
        name: 'Lock Vault',
        path: 'cloud-file-id',
        storageType: 'cloud',
        providerId: 'google-drive',
        isLocked: false,
        volatile: {
          credential: 'test-password',
          entries: [createEntry()],
          navigationPath: '/',
        },
      };

      store.dispatch(addVault(cloudVault));

      // Lock the vault
      store.dispatch(lockVault('lock-vault'));

      const state = store.getState().vault;
      expect(state.vaults[0].isLocked).toBe(true);
      expect(state.vaults[0].volatile.credential).toBe('');
      expect(state.vaults[0].volatile.entries).toEqual([]);
  expect(mockVaultStateCommands.persistVaultsSnapshot).toHaveBeenCalled();
    });
  });

  describe('Helper Functions', () => {
    it('should correctly identify cloud vaults', () => {
      const localVault: Vault = {
        id: 'vault-1',
        name: 'Local Vault',
        path: '/path/to/vault.bc',
        storageType: 'local',
        isLocked: true,
        volatile: {
          credential: '',
          entries: [],
          navigationPath: '/',
        },
      };

      const cloudVault: Vault = {
        id: 'vault-2',
        name: 'Cloud Vault',
        path: 'cloud-file-id',
        storageType: 'cloud',
        providerId: 'google-drive',
        isLocked: true,
        volatile: {
          credential: '',
          entries: [],
          navigationPath: '/',
        },
      };

      expect(isCloudVault(localVault)).toBe(false);
      expect(isCloudVault(cloudVault)).toBe(true);
    });

    it('should get vault provider correctly', () => {
      const providers: StorageProvider[] = [
        {
          name: 'google-drive',
          provider_type: 'google_drive' as StorageProviderType,
          is_default: false,
        },
      ];

      const cloudVault: Vault = {
        id: 'vault-1',
        name: 'Cloud Vault',
        path: 'cloud-file-id',
        storageType: 'cloud',
        providerId: 'google-drive',
        isLocked: true,
        volatile: {
          credential: '',
          entries: [],
          navigationPath: '/',
        },
      };

      const provider = getVaultProvider(cloudVault, providers);
      expect(provider).toEqual(providers[0]);
    });

    it('should create cloud vault object', () => {
      const cloudVault = createCloudVault(
        'vault-1',
        'Cloud Vault',
        'google-drive',
        'file-id-123',
        'password'
      );

      expect(cloudVault.id).toBe('vault-1');
      expect(cloudVault.name).toBe('Cloud Vault');
      expect(cloudVault.storageType).toBe('cloud');
      expect(cloudVault.providerId).toBe('google-drive');
      expect(cloudVault.cloudMetadata?.fileId).toBe('file-id-123');
      expect(cloudVault.volatile.credential).toBe('password');
    });

    it('should migrate local vault to cloud', () => {
      const localVault: Vault = {
        id: 'vault-1',
        name: 'Local Vault',
        path: '/path/to/vault.bc',
        storageType: 'local',
        isLocked: true,
        volatile: {
          credential: '',
          entries: [],
          navigationPath: '/',
        },
      };

      const cloudVault = migrateVaultToCloud(
        localVault,
        'google-drive',
        'file-id-123'
      );

      expect(cloudVault.storageType).toBe('cloud');
      expect(cloudVault.providerId).toBe('google-drive');
      expect(cloudVault.path).toBe('file-id-123');
      expect(cloudVault.cloudMetadata?.fileId).toBe('file-id-123');
    });

    it('should migrate cloud vault to local', () => {
      const cloudVault: Vault = {
        id: 'vault-1',
        name: 'Cloud Vault',
        path: 'file-id-123',
        storageType: 'cloud',
        providerId: 'google-drive',
        cloudMetadata: {
          fileId: 'file-id-123',
          provider: 'google-drive',
        },
        isLocked: true,
        volatile: {
          credential: '',
          entries: [],
          navigationPath: '/',
        },
      };

      const localVault = migrateVaultToLocal(cloudVault, '/new/path/vault.bc');

      expect(localVault.storageType).toBe('local');
      expect(localVault.providerId).toBeUndefined();
      expect(localVault.cloudMetadata).toBeUndefined();
      expect(localVault.path).toBe('/new/path/vault.bc');
    });
  });

  describe('Backward Compatibility', () => {
    it('should migrate existing vaults to local storage type', async () => {
      const oldVaultFormat = {
        id: 'vault-1',
        name: 'Old Vault',
        path: '/path/to/vault.bc',
        lastAccessed: '2023-01-01T00:00:00Z',
        isLocked: true,
      };

      mockVaultStateCommands.load.mockResolvedValueOnce({
        vaults: [oldVaultFormat],
        defaultProvider: null,
        providerStatus: {},
      });

      const result = await loadVaultStateFromSettings();

      expect(result.vaults).toHaveLength(1);
      expect(result.vaults![0].storageType).toBe('local');
      expect(result.vaults![0].volatile).toBeDefined();
      expect(result.vaults![0].volatile.entries).toEqual([]);
    });

    it('should hydrate volatile state from persisted data', async () => {
      const persistedEntries = [createEntry({ id: 'entry-volatile' })];

      mockVaultStateCommands.load.mockResolvedValueOnce({
        vaults: [
          {
            id: 'vault-volatile',
            name: 'Persisted Vault',
            path: '/path/to/vault.bc',
            storageType: 'cloud',
            isLocked: false,
            volatile: {
              credential: 'persisted-secret',
              entries: persistedEntries,
              navigationPath: '/group/child',
              encryptedData: 'opaque-data',
            },
          },
        ],
        defaultProvider: 'google-drive',
        providerStatus: {},
      });

      const result = await loadVaultStateFromSettings();

      const hydratedVault = result.vaults?.[0];
      expect(hydratedVault?.id).toBe('vault-volatile');
      expect(hydratedVault?.isLocked).toBe(false);
      expect(hydratedVault?.volatile.credential).toBe('persisted-secret');
      expect(hydratedVault?.volatile.entries).toEqual(persistedEntries);
      expect(hydratedVault?.volatile.navigationPath).toBe('/group/child');
      expect(hydratedVault?.volatile.encryptedData).toBe('opaque-data');
    });

    it('should treat vault as locked when credential is missing on hydrate', async () => {
      mockVaultStateCommands.load.mockResolvedValueOnce({
        vaults: [
          {
            id: 'vault-missing-credential',
            name: 'Persisted Vault (Missing Credential)',
            path: '/path/to/vault.bc',
            storageType: 'cloud',
            isLocked: false,
            // volatile omitted: backend drops credential on save
          },
        ],
        defaultProvider: 'google-drive',
        providerStatus: {},
      });

      const result = await loadVaultStateFromSettings();

      const hydratedVault = result.vaults?.[0];
      expect(hydratedVault?.id).toBe('vault-missing-credential');
      expect(hydratedVault?.volatile.credential).toBe('');
      expect(hydratedVault?.isLocked).toBe(true);
    });

    it('should handle missing vault data gracefully', async () => {
      mockVaultStateCommands.load.mockResolvedValueOnce({
        vaults: [],
        defaultProvider: null,
        providerStatus: {},
      });

      const result = await loadVaultStateFromSettings();

      expect(result.vaults).toEqual([]);
      expect(result.providers).toEqual([]);
      expect(result.defaultProvider).toBe(null);
      expect(result.providerStatus).toEqual({});
    });
  });
});
