import { load, type Store } from "@tauri-apps/plugin-store";

/**
 * SettingsStore is a wrapper around the Tauri Store API.
 * It provides methods to get, set, and remove settings from the store.
 */
export class SettingsStore {
  private store?: Store;
  public initialized: boolean = false;
  constructor() {
    load('store.json', { autoSave: false })
      .then((store) => {
        this.initialized = true;
        this.store = store;
      })
      .catch((err) => {
        console.error(
          'Failed to load store in SettingsStore constructor:',
          err
        );
      });
  }
  init = async () => {
    if (!this.store) {
      this.store = await load('store.json', { autoSave: false });
      this.initialized = true;
    }
  };
  async get(key: string): Promise<any> {
    if (!this.store) {
      throw new Error('Store not initialized');
    }
    const value = await this.store.get(key);
    return value;
  }
  async set(key: string, value: any): Promise<void> {
    if (!this.store) {
      throw new Error('Store not initialized');
    }
    await this.store.set(key, value);
  }
  async remove(key: string): Promise<void> {
    if (!this.store) {
      throw new Error('Store not initialized');
    }
    await this.store.delete(key);
  }
  async clear(): Promise<void> {
    if (!this.store) {
      throw new Error('Store not initialized');
    }
    await this.store.clear();
  }
}
export const settingsStore = new SettingsStore();
