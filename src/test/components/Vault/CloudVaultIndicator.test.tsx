import { configureStore } from "@reduxjs/toolkit";
import { render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { CloudVaultIndicator } from "../../../components/Vault/CloudVaultIndicator";
import { StorageProviderType } from "../../../interfaces/cloud-storage.interface";
import type { Vault } from "../../../redux/actions/vault";
import { vaultSlice } from "../../../redux/actions/vault";

// Mock the translation hook
vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string) => key,
	}),
}));

const createMockStore = (initialState = {}) => {
	return configureStore({
		reducer: {
			vault: vaultSlice.reducer,
		},
		preloadedState: {
			vault: {
				vaults: [],
				currentVaultId: null,
				loading: false,
				error: null,
				providers: [],
				defaultProvider: null,
				providerStatus: {},
				...initialState,
			},
		},
	});
};

describe("CloudVaultIndicator", () => {
	const mockLocalVault: Vault = {
		id: "local-vault-1",
		name: "Local Vault",
		path: "/path/to/local.vault",
		storageType: "local",
		isLocked: true,
		volatile: {
			credential: "",
			entries: [],
			navigationPath: "/",
		},
	};

	const mockCloudVault: Vault = {
		id: "cloud-vault-1",
		name: "Cloud Vault",
		path: "cloud-file-id-123",
		storageType: "cloud",
		providerId: "google-drive-provider",
		cloudMetadata: {
			fileId: "cloud-file-id-123",
			provider: "google-drive-provider",
			lastSync: "2023-12-01T10:00:00Z",
		},
		isLocked: true,
		volatile: {
			credential: "",
			entries: [],
			navigationPath: "/",
		},
	};

	const mockProviders = [
		{
			name: "google-drive-provider",
			providerType: StorageProviderType.GOOGLE_DRIVE,
			isDefault: true,
		},
	];

	it("renders local vault indicator correctly", () => {
		const store = createMockStore({ providers: mockProviders });

		render(
			<Provider store={store}>
				<CloudVaultIndicator vault={mockLocalVault} />
			</Provider>,
		);

		// Check for local storage icon
		const localIcon = screen.getByTitle("vaultSelector.localVault");
		expect(localIcon).toBeInTheDocument();

		// Check for local badge
		const localBadge = screen.getByTitle("vaultSelector.localVault");
		expect(localBadge).toBeInTheDocument();

		// Should not show cloud-specific elements
		expect(screen.queryByText("Google Drive")).not.toBeInTheDocument();
	});

	it("renders cloud vault indicator correctly", () => {
		const store = createMockStore({ providers: mockProviders });

		render(
			<Provider store={store}>
				<CloudVaultIndicator vault={mockCloudVault} />
			</Provider>,
		);

		// Check for cloud icon
		const cloudIcon = screen.getByTitle("vaultSelector.cloudVault");
		expect(cloudIcon).toBeInTheDocument();

		// Check for provider badge
		expect(screen.getByText("Google Drive")).toBeInTheDocument();

		// Check for last sync info
		expect(screen.getByText("vaultSelector.lastSync:")).toBeInTheDocument();
	});

	it("renders without tooltip when showTooltip is false", () => {
		const store = createMockStore({ providers: mockProviders });

		render(
			<Provider store={store}>
				<CloudVaultIndicator vault={mockCloudVault} showTooltip={false} />
			</Provider>,
		);

		// Should not have tooltip wrapper
		expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

		// But should still show the indicator content
		expect(screen.getByTitle("vaultSelector.cloudVault")).toBeInTheDocument();
	});

	it("applies custom className correctly", () => {
		const store = createMockStore({ providers: mockProviders });

		render(
			<Provider store={store}>
				<CloudVaultIndicator vault={mockLocalVault} className="custom-class" />
			</Provider>,
		);

		const indicator = screen
			.getByTitle("vaultSelector.localVault")
			.closest("div");
		expect(indicator).toHaveClass("custom-class");
	});

	it("handles cloud vault without provider gracefully", () => {
		const cloudVaultWithoutProvider: Vault = {
			...mockCloudVault,
			providerId: undefined,
		};

		const store = createMockStore({ providers: [] });

		render(
			<Provider store={store}>
				<CloudVaultIndicator vault={cloudVaultWithoutProvider} />
			</Provider>,
		);

		// Should still show cloud icon
		expect(screen.getByTitle("vaultSelector.cloudVault")).toBeInTheDocument();

		// Should not show provider badge
		expect(screen.queryByText("Google Drive")).not.toBeInTheDocument();
	});

	it("handles cloud vault without last sync gracefully", () => {
		const cloudVaultWithoutSync: Vault = {
			...mockCloudVault,
			cloudMetadata: {
				...mockCloudVault.cloudMetadata!,
				lastSync: undefined,
			},
		};

		const store = createMockStore({ providers: mockProviders });

		render(
			<Provider store={store}>
				<CloudVaultIndicator vault={cloudVaultWithoutSync} />
			</Provider>,
		);

		// Should still show cloud icon and provider
		expect(screen.getByTitle("vaultSelector.cloudVault")).toBeInTheDocument();
		expect(screen.getByText("Google Drive")).toBeInTheDocument();

		// Should not show last sync info
		expect(
			screen.queryByText("vaultSelector.lastSync:"),
		).not.toBeInTheDocument();
	});

	it("formats last sync time correctly", () => {
		const recentDate = new Date();
		recentDate.setMinutes(recentDate.getMinutes() - 5); // 5 minutes ago

		const cloudVaultWithRecentSync: Vault = {
			...mockCloudVault,
			cloudMetadata: {
				...mockCloudVault.cloudMetadata!,
				lastSync: recentDate.toISOString(),
			},
		};

		const store = createMockStore({ providers: mockProviders });

		render(
			<Provider store={store}>
				<CloudVaultIndicator vault={cloudVaultWithRecentSync} />
			</Provider>,
		);

		// Should show the last sync info
		expect(screen.getByText("vaultSelector.lastSync:")).toBeInTheDocument();
	});

	describe("Cloud Storage Error Scenarios", () => {
		it("handles cloud vault with authentication errors", () => {
			const store = createMockStore({
				providers: mockProviders,
				providerStatus: {
					"google-drive-provider": "error",
				},
			});

			render(
				<Provider store={store}>
					<CloudVaultIndicator vault={mockCloudVault} />
				</Provider>,
			);

			// Should still show cloud icon even when provider has errors
			expect(screen.getByTitle("vaultSelector.cloudVault")).toBeInTheDocument();

			// Should show provider badge
			expect(screen.getByText("Google Drive")).toBeInTheDocument();
		});

		it("handles cloud vault with provider being authenticated", () => {
			const store = createMockStore({
				providers: mockProviders,
				providerStatus: {
					"google-drive-provider": "authenticated",
				},
			});

			render(
				<Provider store={store}>
					<CloudVaultIndicator vault={mockCloudVault} />
				</Provider>,
			);

			// Should show cloud icon
			expect(screen.getByTitle("vaultSelector.cloudVault")).toBeInTheDocument();

			// Should show provider badge
			expect(screen.getByText("Google Drive")).toBeInTheDocument();
		});

		it("handles cloud vault with provider being authenticating", () => {
			const store = createMockStore({
				providers: mockProviders,
				providerStatus: {
					"google-drive-provider": "authenticating",
				},
			});

			render(
				<Provider store={store}>
					<CloudVaultIndicator vault={mockCloudVault} />
				</Provider>,
			);

			// Should show cloud icon during authentication
			expect(screen.getByTitle("vaultSelector.cloudVault")).toBeInTheDocument();

			// Should show provider badge
			expect(screen.getByText("Google Drive")).toBeInTheDocument();
		});

		it("handles cloud vault with different provider types", () => {
			const localProvider = {
				name: "local-provider",
				providerType: StorageProviderType.LOCAL,
				isDefault: false,
			};

			const cloudVaultWithLocalProvider: Vault = {
				...mockCloudVault,
				providerId: "local-provider",
			};

			const store = createMockStore({ providers: [localProvider] });

			render(
				<Provider store={store}>
					<CloudVaultIndicator vault={cloudVaultWithLocalProvider} />
				</Provider>,
			);

			// Should still show cloud icon
			expect(screen.getByTitle("vaultSelector.cloudVault")).toBeInTheDocument();

			// Should show provider name (Local for local provider)
			expect(screen.getByText("Local")).toBeInTheDocument();
		});

		it("handles cloud vault with corrupted metadata", () => {
			const corruptedCloudVault: Vault = {
				...mockCloudVault,
				cloudMetadata: undefined,
			};

			const store = createMockStore({ providers: mockProviders });

			render(
				<Provider store={store}>
					<CloudVaultIndicator vault={corruptedCloudVault} />
				</Provider>,
			);

			// Should still show cloud icon even with corrupted metadata
			expect(screen.getByTitle("vaultSelector.cloudVault")).toBeInTheDocument();

			// Should show provider badge
			expect(screen.getByText("Google Drive")).toBeInTheDocument();

			// Should not show last sync info
			expect(
				screen.queryByText("vaultSelector.lastSync:"),
			).not.toBeInTheDocument();
		});

		it("handles cloud vault with very old sync time", () => {
			const oldDate = new Date();
			oldDate.setFullYear(oldDate.getFullYear() - 1); // 1 year ago

			const cloudVaultWithOldSync: Vault = {
				...mockCloudVault,
				cloudMetadata: {
					...mockCloudVault.cloudMetadata!,
					lastSync: oldDate.toISOString(),
				},
			};

			const store = createMockStore({ providers: mockProviders });

			render(
				<Provider store={store}>
					<CloudVaultIndicator vault={cloudVaultWithOldSync} />
				</Provider>,
			);

			// Should still show cloud icon and provider
			expect(screen.getByTitle("vaultSelector.cloudVault")).toBeInTheDocument();
			expect(screen.getByText("Google Drive")).toBeInTheDocument();

			// Should show last sync info even for old sync
			expect(screen.getByText("vaultSelector.lastSync:")).toBeInTheDocument();
		});
	});

	describe("Performance and Edge Cases", () => {
		it("handles rapid re-rendering with different vaults", () => {
			const store = createMockStore({ providers: mockProviders });

			const { rerender } = render(
				<Provider store={store}>
					<CloudVaultIndicator vault={mockLocalVault} />
				</Provider>,
			);

			// Initially shows local vault
			expect(screen.getByTitle("vaultSelector.localVault")).toBeInTheDocument();

			// Rapidly switch to cloud vault
			rerender(
				<Provider store={store}>
					<CloudVaultIndicator vault={mockCloudVault} />
				</Provider>,
			);

			// Should show cloud vault
			expect(screen.getByTitle("vaultSelector.cloudVault")).toBeInTheDocument();
			expect(screen.getByText("Google Drive")).toBeInTheDocument();

			// Switch back to local vault
			rerender(
				<Provider store={store}>
					<CloudVaultIndicator vault={mockLocalVault} />
				</Provider>,
			);

			// Should show local vault again
			expect(screen.getByTitle("vaultSelector.localVault")).toBeInTheDocument();
			expect(screen.queryByText("Google Drive")).not.toBeInTheDocument();
		});

		it("handles vault with undefined properties gracefully", () => {
			const undefinedVault: any = {
				id: "undefined-vault",
				name: undefined,
				storageType: undefined,
				providerId: undefined,
				cloudMetadata: undefined,
				isLocked: undefined,
				volatile: undefined,
			};

			const store = createMockStore({ providers: mockProviders });

			render(
				<Provider store={store}>
					<CloudVaultIndicator vault={undefinedVault} />
				</Provider>,
			);

			// Should not crash and should render something
			expect(document.body).toBeInTheDocument();
		});

		it("handles very long provider names", () => {
			const longProviderName =
				"very-long-provider-name-that-might-cause-layout-issues";
			const cloudVaultWithLongProvider: Vault = {
				...mockCloudVault,
				providerId: longProviderName,
			};

			const longProvider = {
				name: longProviderName,
				providerType: StorageProviderType.GOOGLE_DRIVE,
				isDefault: false,
			};

			const store = createMockStore({ providers: [longProvider] });

			render(
				<Provider store={store}>
					<CloudVaultIndicator vault={cloudVaultWithLongProvider} />
				</Provider>,
			);

			// Should show cloud icon
			expect(screen.getByTitle("vaultSelector.cloudVault")).toBeInTheDocument();

			// Should show provider name (truncated or full depending on implementation)
			expect(screen.getByText(longProviderName)).toBeInTheDocument();
		});
	});
});
