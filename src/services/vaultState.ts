import { invoke } from '@tauri-apps/api/core';
import type { Vault } from '../redux/actions/vault';

export interface PersistedVault {
  id: string;
  name: string;
  path: string;
  lastAccessed?: string;
  isLocked: boolean;
  storageType: 'local' | 'cloud';
  providerId?: string;
  cloudMetadata?: {
    fileId: string;
    provider: string;
    lastSync?: string;
  };
}

export interface PersistedVaultState {
  vaults: PersistedVault[];
  providers: Array<{
    name: string;
    provider_type: string;
    is_default: boolean;
  }>;
  defaultProvider: string | null;
  providerStatus: Record<string, string>;
}

const mapVaultToPersisted = (vault: Vault): PersistedVault => ({
  id: vault.id,
  name: vault.name,
  path: vault.path,
  lastAccessed: vault.lastAccessed,
  isLocked: vault.isLocked,
  storageType: vault.storageType,
  providerId: vault.providerId,
  cloudMetadata: vault.cloudMetadata,
});

const mapProviderToPersisted = (
  provider: PersistedVaultState['providers'][number]
): PersistedVaultState['providers'][number] => ({
  name: provider.name,
  provider_type: provider.provider_type,
  is_default: provider.is_default,
});

export const VaultStateCommands = {
  async load(): Promise<PersistedVaultState> {
    const state = await invoke<PersistedVaultState>('load_vault_state');
    return {
      vaults: state.vaults ?? [],
      providers: state.providers ?? [],
      defaultProvider: state.defaultProvider ?? null,
      providerStatus: state.providerStatus ?? {},
    };
  },
  async save(state: PersistedVaultState): Promise<void> {
    await invoke('save_vault_state', {
      newState: state,
    });
  },
  async persistVaultsSnapshot(params: {
    vaults: Vault[];
    providers: Array<{
      name: string;
      provider_type: string;
      is_default: boolean;
    }>;
    defaultProvider: string | null;
    providerStatus: Record<string, string>;
  }): Promise<void> {
    const { vaults, providers, defaultProvider, providerStatus } = params;
    const payload: PersistedVaultState = {
      vaults: vaults.map(mapVaultToPersisted),
      providers: providers.map(mapProviderToPersisted),
      defaultProvider,
      providerStatus,
    };
    await this.save(payload);
  },
};
