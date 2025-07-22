import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsStore } from "./settings";

// Mock the Tauri plugin-store
const mockStore = {
	get: vi.fn(),
	set: vi.fn(),
	delete: vi.fn(),
};

const mockLoad = vi.fn().mockResolvedValue(mockStore);

vi.mock("@tauri-apps/plugin-store", () => ({
	load: mockLoad,
}));

describe("SettingsStore", () => {
	let settingsStore: SettingsStore;

	beforeEach(() => {
		vi.clearAllMocks();
		mockLoad.mockResolvedValue(mockStore);
		settingsStore = new SettingsStore();
	});

	describe("Initialization", () => {
		it("should initialize with correct default state", () => {
			expect(settingsStore.initalized).toBe(false);
		});

		it("should set initialized to true after store loads", async () => {
			// Wait for the constructor promise to resolve
			await new Promise((resolve) => setTimeout(resolve, 0));

			expect(settingsStore.initalized).toBe(true);
			expect(mockLoad).toHaveBeenCalledWith("store.json", { autoSave: false });
		});
	});

	describe("Get Method", () => {
		beforeEach(async () => {
			// Ensure store is initialized
			await new Promise((resolve) => setTimeout(resolve, 0));
		});

		it("should get value from store", async () => {
			const mockValue = { test: "value" };
			mockStore.get.mockResolvedValue(mockValue);

			const result = await settingsStore.get("testKey");

			expect(mockStore.get).toHaveBeenCalledWith("testKey");
			expect(result).toEqual(mockValue);
		});

		it("should throw error when store is not initialized", async () => {
			const uninitializedStore = new SettingsStore();
			// Don't wait for initialization

			await expect(uninitializedStore.get("testKey")).rejects.toThrow(
				"Store not initialized",
			);
		});

		it("should handle store get errors", async () => {
			const error = new Error("Store get failed");
			mockStore.get.mockRejectedValue(error);

			await expect(settingsStore.get("testKey")).rejects.toThrow(
				"Store get failed",
			);
		});
	});

	describe("Set Method", () => {
		beforeEach(async () => {
			// Ensure store is initialized
			await new Promise((resolve) => setTimeout(resolve, 0));
		});

		it("should set value in store", async () => {
			const testValue = { data: "test" };
			mockStore.set.mockResolvedValue(undefined);

			await settingsStore.set("testKey", testValue);

			expect(mockStore.set).toHaveBeenCalledWith("testKey", testValue);
		});

		it("should throw error when store is not initialized", async () => {
			const uninitializedStore = new SettingsStore();

			await expect(uninitializedStore.set("testKey", "value")).rejects.toThrow(
				"Store not initialized",
			);
		});

		it("should handle store set errors", async () => {
			const error = new Error("Store set failed");
			mockStore.set.mockRejectedValue(error);

			await expect(settingsStore.set("testKey", "value")).rejects.toThrow(
				"Store set failed",
			);
		});

		it("should handle various data types", async () => {
			mockStore.set.mockResolvedValue(undefined);

			// Test string
			await settingsStore.set("string", "test");
			expect(mockStore.set).toHaveBeenCalledWith("string", "test");

			// Test number
			await settingsStore.set("number", 42);
			expect(mockStore.set).toHaveBeenCalledWith("number", 42);

			// Test boolean
			await settingsStore.set("boolean", true);
			expect(mockStore.set).toHaveBeenCalledWith("boolean", true);

			// Test object
			const obj = { nested: { value: "test" } };
			await settingsStore.set("object", obj);
			expect(mockStore.set).toHaveBeenCalledWith("object", obj);

			// Test array
			const arr = [1, 2, 3];
			await settingsStore.set("array", arr);
			expect(mockStore.set).toHaveBeenCalledWith("array", arr);

			// Test null
			await settingsStore.set("null", null);
			expect(mockStore.set).toHaveBeenCalledWith("null", null);
		});
	});

	describe("Remove Method", () => {
		beforeEach(async () => {
			// Ensure store is initialized
			await new Promise((resolve) => setTimeout(resolve, 0));
		});

		it("should remove value from store", async () => {
			mockStore.delete.mockResolvedValue(undefined);

			await settingsStore.remove("testKey");

			expect(mockStore.delete).toHaveBeenCalledWith("testKey");
		});

		it("should throw error when store is not initialized", async () => {
			const uninitializedStore = new SettingsStore();

			await expect(uninitializedStore.remove("testKey")).rejects.toThrow(
				"Store not initialized",
			);
		});

		it("should handle store delete errors", async () => {
			const error = new Error("Store delete failed");
			mockStore.delete.mockRejectedValue(error);

			await expect(settingsStore.remove("testKey")).rejects.toThrow(
				"Store delete failed",
			);
		});
	});

	describe("Integration Scenarios", () => {
		beforeEach(async () => {
			// Ensure store is initialized
			await new Promise((resolve) => setTimeout(resolve, 0));
		});

		it("should handle complete get-set-remove cycle", async () => {
			const testData = { user: "john", preferences: { theme: "dark" } };

			mockStore.set.mockResolvedValue(undefined);
			mockStore.get.mockResolvedValue(testData);
			mockStore.delete.mockResolvedValue(undefined);

			// Set data
			await settingsStore.set("userData", testData);
			expect(mockStore.set).toHaveBeenCalledWith("userData", testData);

			// Get data
			const retrieved = await settingsStore.get("userData");
			expect(retrieved).toEqual(testData);
			expect(mockStore.get).toHaveBeenCalledWith("userData");

			// Remove data
			await settingsStore.remove("userData");
			expect(mockStore.delete).toHaveBeenCalledWith("userData");
		});

		it("should handle multiple concurrent operations", async () => {
			mockStore.set.mockResolvedValue(undefined);
			mockStore.get.mockResolvedValue("value1");

			const promises = [
				settingsStore.set("key1", "value1"),
				settingsStore.set("key2", "value2"),
				settingsStore.get("key1"),
			];

			const results = await Promise.all(promises);

			expect(mockStore.set).toHaveBeenCalledWith("key1", "value1");
			expect(mockStore.set).toHaveBeenCalledWith("key2", "value2");
			expect(mockStore.get).toHaveBeenCalledWith("key1");
			expect(results[2]).toBe("value1");
		});
	});

	describe("Store Loading Failure", () => {
		it("should handle store loading failure gracefully", async () => {
			const loadError = new Error("Failed to load store");
			mockLoad.mockRejectedValue(loadError);

			const failingStore = new SettingsStore();

			// Wait for the failed initialization
			await new Promise((resolve) => setTimeout(resolve, 0));

			expect(failingStore.initalized).toBe(false);

			await expect(failingStore.get("key")).rejects.toThrow(
				"Store not initialized",
			);
			await expect(failingStore.set("key", "value")).rejects.toThrow(
				"Store not initialized",
			);
			await expect(failingStore.remove("key")).rejects.toThrow(
				"Store not initialized",
			);
		});
	});
});
