/**
 * Type definitions for Tauri updater plugin
 */

export interface UpdateInfo {
	version: string;
	date: string;
	body: string;
	signatures: string[];
}

export interface UpdateProgressEvent {
	event: 'Started' | 'Progress' | 'Finished';
	data: {
		contentLength?: number;
		chunkLength?: number;
	};
}

export interface Update {
	version: string;
	date: string;
	body: string;
	downloadAndInstall: (onProgress?: (event: UpdateProgressEvent) => void) => Promise<void>;
}