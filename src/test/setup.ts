/// <reference types="vitest/globals" />
import "@testing-library/jest-dom";

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
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
	clipboard: {
		writeText: vi.fn(),
		readText: vi.fn(),
	},
}));

// Mock the store plugin
const mockStore = {
	get: vi.fn(),
	set: vi.fn(),
	save: vi.fn(),
	load: vi.fn().mockResolvedValue(undefined),
	delete: vi.fn(),
	has: vi.fn(),
	clear: vi.fn(),
	path: vi.fn(),
	onKeyChange: vi.fn(),
	onChange: vi.fn(),
};

vi.mock("@tauri-apps/plugin-store", () => ({
	Store: vi.fn().mockImplementation(() => mockStore),
	load: vi.fn().mockResolvedValue(mockStore),
}));
// Mock Tauri core invoke BEFORE any modules that import it are loaded
vi.mock("@tauri-apps/api/core", () => ({
	invoke: vi.fn(),
}));

// Expose CloudStorageCommands methods as spy-able functions (call-through by default)
import { CloudStorageCommands as CloudStorageClass } from "../services/cloudStorage";

const _originalCloudStorageMethods: Record<string, any> = {};
for (const name of Object.getOwnPropertyNames(CloudStorageClass)) {
	if (["length", "name", "prototype"].includes(name)) continue;
	const val = (CloudStorageClass as any)[name];
	if (typeof val === "function") {
		_originalCloudStorageMethods[name] = val;
		(CloudStorageClass as any)[name] = vi.fn((...args: any[]) => {
			return _originalCloudStorageMethods[name].apply(CloudStorageClass, args);
		});
	}
}
// Provide a Jest-compatible global alias so tests that use `jest.*` APIs still work under Vitest
(globalThis as any).jest = vi;

// CloudStorageCommands wrapper: spy-able but delegates to real implementation.
// This makes CloudStorageCommands methods replaceable via vi.mocked(...).mockImplementation
// in integration tests, while still calling through to the real implementation by default.
// Do NOT import or wrap CloudStorageCommands here — importing the module in the
// global setup causes its internal `invoke` import to be bound before tests can
// mock '@tauri-apps/api/core'. Tests should mock '@tauri-apps/api/core' (or
// CloudStorageCommands) locally as needed.

// Note: Tests can now call vi.mocked(CloudStorageClass.someMethod).mockImplementation(...)
// to override behavior per-test. If a test needs the raw original method, it can call
// _originalCloudStorageMethods['methodName'] directly.

// Export mock store for test files to use
export { mockStore };
