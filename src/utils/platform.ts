import { platform } from '@tauri-apps/plugin-os';

const MOBILE_PLATFORMS = ['android', 'ios'];

export function isMobile() {
  const currentPlatform = platform();

  return MOBILE_PLATFORMS.includes(currentPlatform);
}
