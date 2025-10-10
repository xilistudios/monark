/**
 * LocalOAuthServer - HTTP server for handling OAuth callbacks
 * Listens on localhost:1420 for OAuth redirect callbacks from Google
 * @module LocalOAuthServer
 */

export class LocalOAuthServer {
  private static instance: LocalOAuthServer | null = null;
  private isRunning = false;
  private callbackHandler: ((url: string) => void) | null = null;

  private constructor() {}

  static getInstance(): LocalOAuthServer {
    if (!LocalOAuthServer.instance) {
      LocalOAuthServer.instance = new LocalOAuthServer();
    }
    return LocalOAuthServer.instance;
  }

  /**
   * Starts listening for OAuth callbacks
   * @param handler - Function to call when a callback is received
   */
  async start(handler: (url: string) => void): Promise<void> {
    if (this.isRunning) {
      console.log('OAuth server already running');
      return;
    }

    this.callbackHandler = handler;
    this.isRunning = true;

    // Since we're in a Tauri/Vite environment, the Vite dev server
    // already handles localhost:1420. We'll use a window route handler
    // to catch OAuth callbacks instead of starting another server.

    console.log('OAuth callback handler registered');
  }

  /**
   * Stops listening for OAuth callbacks
   */
  stop(): void {
    this.isRunning = false;
    this.callbackHandler = null;
    console.log('OAuth callback handler stopped');
  }

  /**
   * Handles an OAuth callback URL
   * @param url - The full callback URL with query parameters
   */
  handleCallback(url: string): void {
    if (!this.isRunning || !this.callbackHandler) {
      console.warn('OAuth callback received but no handler registered');
      return;
    }

    console.log('Processing OAuth callback:', url);
    this.callbackHandler(url);
  }

  /**
   * Checks if the server is currently running
   */
  isListening(): boolean {
    return this.isRunning;
  }
}
