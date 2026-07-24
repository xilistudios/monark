import { writeText } from "@tauri-apps/plugin-clipboard-manager";

const CLIPBOARD_CLEAR_DELAY_MS = 30_000; // 30 seconds
let clearTimeoutId: ReturnType<typeof setTimeout> | null = null;

/**
 * Copies text to clipboard and automatically clears it after 30 seconds.
 * Use this for sensitive data (passwords, TOTP codes, tokens).
 * If another sensitive copy happens before the timeout, the previous timeout is cancelled
 * and a new one starts.
 */
export async function copySensitive(text: string): Promise<void> {
  await writeText(text);

  if (clearTimeoutId !== null) {
    clearTimeout(clearTimeoutId);
  }

  clearTimeoutId = setTimeout(async () => {
    try {
      await writeText("");
    } catch {
      // Ignore errors when clearing
    }
    clearTimeoutId = null;
  }, CLIPBOARD_CLEAR_DELAY_MS);
}
