import { invoke } from "@tauri-apps/api/core";

// ─── Types (mirrors of the plugin's guest-js) ───

export enum BiometryType {
  None = 0,
  Auto = 1,
  TouchID = 2,
  FaceID = 3,
  Iris = 4,
}

export interface BiometricStatus {
  isAvailable: boolean;
  biometryType: BiometryType;
  error?: string;
  errorCode?: string;
}

export interface AuthOptions {
  allowDeviceCredential?: boolean;
  cancelTitle?: string;
  fallbackTitle?: string;
  title?: string;
  subtitle?: string;
  confirmationRequired?: boolean;
}

// ─── Constants ───

const BIOMETRIC_DOMAIN = "com.monark.app";

/**
 * Build the storage key for a given vault.
 * Each vault gets its own biometric-protected entry.
 */
const vaultKeyName = (vaultId: string): string => `vault_password_${vaultId}`;

// ─── Public API ───

/**
 * Check if biometric authentication is available on this device.
 */
export async function checkBiometricAvailability(): Promise<BiometricStatus> {
  return await invoke<BiometricStatus>("plugin:biometry|status");
}

/**
 * Prompt the user for biometric authentication.
 * @returns true if authentication succeeded, false otherwise
 */
export async function authenticate(
  reason: string,
  options?: AuthOptions,
): Promise<boolean> {
  try {
    await invoke("plugin:biometry|authenticate", {
      reason,
      options: options ?? {},
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Store the vault password securely with biometric protection.
 * The data is encrypted and can only be retrieved after successful biometric auth.
 */
export async function storeVaultPassword(
  vaultId: string,
  password: string,
): Promise<void> {
  await invoke("plugin:biometry|set_data", {
    options: {
      domain: BIOMETRIC_DOMAIN,
      name: vaultKeyName(vaultId),
      data: password,
    },
  });
}

/**
 * Retrieve the vault password after biometric authentication.
 * This will trigger a biometric prompt.
 * @returns The password string, or null if retrieval failed
 */
export async function retrieveVaultPassword(
  vaultId: string,
  reason: string,
): Promise<string | null> {
  try {
    const response = await invoke<{ data: string }>("plugin:biometry|get_data", {
      options: {
        domain: BIOMETRIC_DOMAIN,
        name: vaultKeyName(vaultId),
        reason,
        cancelTitle: "Cancel",
      },
    });
    return response.data;
  } catch {
    return null;
  }
}

/**
 * Delete the stored vault password from biometric secure storage.
 */
export async function deleteVaultPassword(vaultId: string): Promise<void> {
  try {
    await invoke("plugin:biometry|remove_data", {
      options: {
        domain: BIOMETRIC_DOMAIN,
        name: vaultKeyName(vaultId),
      },
    });
  } catch {
    // Ignore errors if data doesn't exist
  }
}

/**
 * Check if biometric data exists for a vault (does NOT trigger auth prompt).
 */
export async function hasBiometricData(vaultId: string): Promise<boolean> {
  try {
    return await invoke<boolean>("plugin:biometry|has_data", {
      options: {
        domain: BIOMETRIC_DOMAIN,
        name: vaultKeyName(vaultId),
      },
    });
  } catch {
    return false;
  }
}
