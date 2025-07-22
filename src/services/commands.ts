import { invoke } from '@tauri-apps/api/core'
import { VaultContent } from '../interfaces/vault.interface'
/**
 * TauriCommands class provides methods to interact with Tauri's backend commands.
 */
export default class VaultCommands {
  static async read(filePath: string, password: string): Promise<VaultContent> {
    return await invoke<VaultContent>('read_vault', { filePath, password })
  }

  static async write(filePath: string, password: string, vaultContent?: VaultContent) {
    if (!vaultContent) {
      throw new Error('Vault content is required for writing')
    }
    return await invoke('write_vault', { filePath, password, vaultContent });
  }

  static async delete(filePath: string) {
    return await invoke('delete_vault', { filePath });
  }
}