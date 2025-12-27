/**
 * Deep Link Service for handling OAuth callbacks globally
 * This service ensures deep links are received regardless of which component is mounted
 * @module deepLinkService
 */

import { onOpenUrl } from '@tauri-apps/plugin-deep-link';
import type { AppDispatch, RootState } from '../redux/store';
import { setProviderStatus, clearOAuthState } from '../redux/actions/vault';
import { CloudStorageCommands } from './cloudStorage';

interface DeepLinkServiceConfig {
	dispatch: AppDispatch;
	getState: () => RootState;
}

/**
 * Deep Link Service class
 * Manages global deep link listeners for OAuth callbacks
 */
class DeepLinkService {
	private dispatch: AppDispatch | null = null;
	private getState: (() => RootState) | null = null;
	private unlistenDeepLink: (() => void) | null = null;
	private handleMessage: ((event: MessageEvent) => void) | null = null;
	private isInitialized = false;

	/**
	 * Initialize the deep link service
	 * @param config - Service configuration with dispatch and getState
	 */
	initialize(config: DeepLinkServiceConfig): void {
		if (this.isInitialized) {
			console.warn('[DeepLinkService] Already initialized, skipping');
			return;
		}

		this.dispatch = config.dispatch;
		this.getState = config.getState;

		console.log('[DeepLinkService] Initializing global deep link listener');

		// Set up the global deep link listener
		this.setupDeepLinkListener();

		// Set up window message listener as fallback
		this.setupWindowMessageListener();

		this.isInitialized = true;
		console.log('[DeepLinkService] Global deep link listener initialized successfully');
	}

	/**
	 * Set up the Tauri deep link listener
	 */
	private setupDeepLinkListener(): void {
		console.log('[DeepLinkService] Setting up Tauri onOpenUrl listener');

		onOpenUrl((urls) => {
			console.log('[DeepLinkService] Deep link URLs received:', urls);
			console.log('[DeepLinkService] Number of URLs:', urls.length);

			if (urls.length > 0) {
				this.handleDeepLink(urls[0]);
			} else {
				console.warn('[DeepLinkService] Received empty URLs array');
			}
		}).then((unlisten) => {
			this.unlistenDeepLink = unlisten;
			console.log('[DeepLinkService] Tauri onOpenUrl listener registered successfully');
		}).catch((error) => {
			console.error('[DeepLinkService] Failed to register Tauri onOpenUrl listener:', error);
		});
	}

	/**
	 * Set up window message listener as fallback for OAuth callbacks
	 */
	private setupWindowMessageListener(): void {
		console.log('[DeepLinkService] Setting up window message listener as fallback');

		this.handleMessage = (event: MessageEvent) => {
			console.log('[DeepLinkService] Window message received:', event.data);

			if (event.data?.type === 'oauth_callback') {
				console.log('[DeepLinkService] OAuth callback message detected');
				this.handleDeepLink(event.data.url);
			} else {
				console.log('[DeepLinkService] Non-OAuth message received, ignoring');
			}
		};

		window.addEventListener('message', this.handleMessage);
		console.log('[DeepLinkService] Window message listener registered successfully');
	}

	/**
	 * Handle incoming deep link URL
	 * @param url - The deep link URL to process
	 */
	private async handleDeepLink(url: string): Promise<void> {
		console.log('[DeepLinkService] Processing deep link:', url);
		console.log('[DeepLinkService] URL length:', url.length);

		if (!this.dispatch || !this.getState) {
			console.error('[DeepLinkService] Service not initialized - dispatch or getState is null');
			return;
		}

		try {
			// Parse the URL to extract code and state
			console.log('[DeepLinkService] Parsing URL parameters');
			const urlObj = new URL(url);
			const code = urlObj.searchParams.get('code');
			const state = urlObj.searchParams.get('state');
			const error = urlObj.searchParams.get('error');

			console.log('[DeepLinkService] URL parameters parsed:');
			console.log('[DeepLinkService]   - code:', code ? `${code.substring(0, 20)}...` : 'null');
			console.log('[DeepLinkService]   - state:', state ? `${state.substring(0, 20)}...` : 'null');
			console.log('[DeepLinkService]   - error:', error);

			// Check for OAuth error
			if (error) {
				console.error('[DeepLinkService] OAuth error received:', error);
				this.handleOAuthError(error);
				return;
			}

			// Get current OAuth state from Redux
			const currentState = this.getState();
			const oauthState = currentState.vault.oauthState;

			console.log('[DeepLinkService] Current OAuth state from Redux:');
			console.log('[DeepLinkService]   - providerName:', oauthState.providerName);
			console.log('[DeepLinkService]   - state:', oauthState.state ? `${oauthState.state.substring(0, 20)}...` : 'null');
			console.log('[DeepLinkService]   - isOpen:', oauthState.isOpen);

			// Validate state parameter
			if (!state) {
				console.error('[DeepLinkService] No state parameter in URL');
				this.handleOAuthError('Missing state parameter in callback URL');
				return;
			}

			if (!oauthState.state) {
				console.warn('[DeepLinkService] No OAuth state in Redux - may have been cleared');
				this.handleOAuthError('No pending OAuth request found');
				return;
			}

			if (state !== oauthState.state) {
				console.error('[DeepLinkService] State mismatch!');
				console.error('[DeepLinkService]   Expected:', oauthState.state);
				console.error('[DeepLinkService]   Received:', state);
				this.handleOAuthError('State mismatch - possible CSRF attack');
				return;
			}

			if (!code) {
				console.error('[DeepLinkService] No code parameter in URL');
				this.handleOAuthError('Missing authorization code in callback URL');
				return;
			}

			if (!oauthState.providerName) {
				console.error('[DeepLinkService] No provider name in OAuth state');
				this.handleOAuthError('Missing provider name in OAuth state');
				return;
			}

			// State matches, process the OAuth callback
			console.log('[DeepLinkService] State validation successful, processing OAuth callback');
			console.log('[DeepLinkService] Provider:', oauthState.providerName);

			await CloudStorageCommands.handleGoogleDriveOAuthCallback(
				oauthState.providerName,
				code,
				state
			);

			console.log('[DeepLinkService] OAuth callback processed successfully');
			this.dispatch(setProviderStatus({
				providerId: oauthState.providerName,
				status: 'authenticated',
			}));

			// Clear OAuth state after successful authentication
			this.dispatch(clearOAuthState());
			console.log('[DeepLinkService] OAuth state cleared');

		} catch (error) {
			console.error('[DeepLinkService] Failed to handle OAuth callback:', error);
			console.error('[DeepLinkService] Error details:', JSON.stringify(error, null, 2));
			console.error('[DeepLinkService] Error message:', error instanceof Error ? error.message : String(error));
			this.handleOAuthError(
				error instanceof Error
					? error.message
					: 'Failed to complete authentication'
			);
		}
	}

	/**
	 * Handle OAuth error
	 * @param errorMessage - The error message to dispatch
	 */
	private handleOAuthError(errorMessage: string): void {
		console.error('[DeepLinkService] Handling OAuth error:', errorMessage);

		if (!this.dispatch) {
			console.error('[DeepLinkService] Cannot dispatch error - dispatch is null');
			return;
		}

		if (!this.getState) {
			console.error('[DeepLinkService] Cannot get state - getState is null');
			return;
		}

		const currentState = this.getState();
		const oauthState = currentState.vault.oauthState;

		if (oauthState.providerName) {
			this.dispatch(setProviderStatus({
				providerId: oauthState.providerName,
				status: 'error',
			}));
			console.log('[DeepLinkService] Provider status set to error:', oauthState.providerName);
		}

		// Clear OAuth state on error
		this.dispatch(clearOAuthState());
		console.log('[DeepLinkService] OAuth state cleared due to error');
	}

	/**
	 * Cleanup the deep link service
	 */
	cleanup(): void {
		console.log('[DeepLinkService] Cleaning up deep link service');

		if (this.unlistenDeepLink) {
			this.unlistenDeepLink();
			this.unlistenDeepLink = null;
			console.log('[DeepLinkService] Tauri onOpenUrl listener unregistered');
		}

		if (this.handleMessage) {
			window.removeEventListener('message', this.handleMessage);
			this.handleMessage = null;
			console.log('[DeepLinkService] Window message listener removed');
		}

		this.dispatch = null;
		this.getState = null;
		this.isInitialized = false;

		console.log('[DeepLinkService] Cleanup complete');
	}

	/**
	 * Check if the service is initialized
	 */
	isReady(): boolean {
		return this.isInitialized;
	}
}

// Export singleton instance
export const deepLinkService = new DeepLinkService();
