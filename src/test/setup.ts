/// <reference types="vitest/globals" />
import '@testing-library/jest-dom';

// Extend the Window interface to include Tauri's internal API for mocking
declare global {
  interface Window {
    __TAURI_INTERNALS__: {
      invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
    };
  }
}

// Mock the Tauri API for testing
// This ensures that tests can run without a real Tauri environment
// and allows for spying on or controlling the behavior of Tauri commands.
global.window = global.window || {};
global.window.__TAURI_INTERNALS__ = {
  invoke: vi.fn(),
};

// Mock the clipboard manager plugin
vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({
  clipboard: {
    writeText: vi.fn(),
    readText: vi.fn(),
  },
}));

// Mock the store plugin
vi.mock('@tauri-apps/plugin-store', () => ({
  Store: vi.fn().mockImplementation(() => ({
    get: vi.fn(),
    set: vi.fn(),
    save: vi.fn(),
    load: vi.fn(),
    delete: vi.fn(),
    has: vi.fn(),
    clear: vi.fn(),
    path: vi.fn(),
    onKeyChange: vi.fn(),
    onChange: vi.fn(),
  })),
}));
