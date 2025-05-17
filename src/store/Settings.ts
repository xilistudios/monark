import { load, Store } from '@tauri-apps/plugin-store';

/**
 * SettingsStore is a wrapper around the Tauri Store API.
 * It provides methods to get, set, and remove settings from the store.
 */
export class SettingsStore {
    private store?: Store;
    public initalized: boolean = false;
    constructor() {
        load('store.json', { autoSave: false }).then((store) => {
            this.initalized = true;
            this.store = store;
        }
        );
    }
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
}
export const settingsStore = new SettingsStore();