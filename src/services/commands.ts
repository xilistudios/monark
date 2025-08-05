import { invoke } from "@tauri-apps/api/core";
import type { VaultContent } from "../interfaces/vault.interface";
/**
 * TauriCommands class provides methods to interact with Tauri's backend commands.
 */
export default class VaultCommands {
	static async read(filePath: string, password: string): Promise<VaultContent> {
		return await invoke<VaultContent>("read_vault", { filePath, password });
	}

	static async write(
		filePath: string,
		password: string,
		vaultContent: {
			updated_at: string;
			hmac: string;
			entries: any[];
		}
	) {
		console.log("Writing vault content:", vaultContent, filePath, password);
		return await invoke("write_vault", { filePath, password, vaultContent });
	}

	static async delete(filePath: string) {
		return await invoke("delete_vault", { filePath });
	}
}
