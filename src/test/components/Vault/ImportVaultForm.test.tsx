import { configureStore } from "@reduxjs/toolkit";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { Provider } from "react-redux";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ImportVaultForm } from "../../../components/Vault/Forms/ImportVaultForm";
import i18n from "../../../i18n";
import type {
	StorageProvider,
	Vault,
} from "../../../interfaces/cloud-storage.interface";
import { StorageProviderType } from "../../../interfaces/cloud-storage.interface";
import vaultReducer from "../../../redux/actions/vault";

// Mock Tauri APIs
vi.mock("@tauri-apps/plugin-dialog", () => ({
	open: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
	invoke: vi.fn(),
}));

vi.mock("../../../services/vault", () => ({
	VaultManager: {
		getInstance: vi.fn(() => ({
			listCloudVaults: vi.fn(),
			getInstance: vi.fn(() => ({
				unlock: vi.fn(),
			})),
		})),
	},
}));

describe("ImportVaultForm with Cloud Storage", () => {
	let store: any;
	const mockOnSuccess = vi.fn();
	const mockOnCancel = vi.fn();

	const mockCloudVaults: Vault[] = [
		{
			id: "cloud-vault-1",
			name: "Cloud Vault 1",
			path: "file-id-1",
			storageType: "cloud",
			providerId: "google-drive",
			cloudMetadata: {
				fileId: "file-id-1",
				provider: "google-drive",
				lastSync: "2023-01-01T00:00:00Z",
			},
			isLocked: true,
			volatile: {
				credential: "",
				entries: [],
				navigationPath: "/",
			},
		},
		{
			id: "cloud-vault-2",
			name: "Cloud Vault 2",
			path: "file-id-2",
			storageType: "cloud",
			providerId: "google-drive",
			cloudMetadata: {
				fileId: "file-id-2",
				provider: "google-drive",
				lastSync: "2023-01-02T00:00:00Z",
			},
			isLocked: true,
			volatile: {
				credential: "",
				entries: [],
				navigationPath: "/",
			},
		},
	];

	beforeEach(() => {
		store = configureStore({
			reducer: {
				vault: vaultReducer,
			},
			preloadedState: {
				vault: {
					vaults: [],
					currentVaultId: null,
					loading: false,
					error: null,
					providers: [
						{
							name: "google-drive",
							providerType: StorageProviderType.GOOGLE_DRIVE,
							isDefault: false,
						},
						{
							name: "dropbox",
							providerType: StorageProviderType.LOCAL,
							isDefault: false,
						},
					],
					defaultProvider: null,
					providerStatus: {
						"google-drive": "authenticated",
						dropbox: "idle",
					},
				},
			},
		});

		vi.clearAllMocks();
	});

	const renderComponent = () => {
		return render(
			<Provider store={store}>
				<I18nextProvider i18n={i18n}>
					<ImportVaultForm onSuccess={mockOnSuccess} onCancel={mockOnCancel} />
				</I18nextProvider>
			</Provider>,
		);
	};

	describe("Import Source Selection", () => {
		it("should show import source selector", () => {
			renderComponent();

			expect(screen.getByText("Import Source")).toBeInTheDocument();
			expect(screen.getByText("Local File")).toBeInTheDocument();
			expect(screen.getByText("Cloud Storage")).toBeInTheDocument();
		});

		it("should default to local file import", () => {
			renderComponent();

			const localRadio = screen.getByDisplayValue("local");
			expect(localRadio).toBeChecked();
		});

		it("should show file selection for local import", () => {
			renderComponent();

			expect(screen.getByText("Vault File")).toBeInTheDocument();
			expect(screen.getByText("Browse")).toBeInTheDocument();
		});

		it("should hide file selection when cloud storage is selected", async () => {
			renderComponent();

			const cloudRadio = screen.getByDisplayValue("cloud");
			fireEvent.click(cloudRadio);

			await waitFor(() => {
				expect(screen.queryByText("Vault File")).not.toBeInTheDocument();
				expect(screen.queryByText("Browse")).not.toBeInTheDocument();
			});
		});
	});

	describe("Cloud Provider Selection", () => {
		it("should show provider selector when cloud storage is selected", async () => {
			renderComponent();

			const cloudRadio = screen.getByDisplayValue("cloud");
			fireEvent.click(cloudRadio);

			await waitFor(() => {
				expect(screen.getByText("Select Provider")).toBeInTheDocument();
			});
		});

		it("should only show authenticated providers", async () => {
			renderComponent();

			const cloudRadio = screen.getByDisplayValue("cloud");
			fireEvent.click(cloudRadio);

			await waitFor(() => {
				const select = screen.getByDisplayValue("Select Provider");
				const options = select.querySelectorAll("option");

				// Should have placeholder + authenticated providers only
				expect(options).toHaveLength(2); // placeholder + google-drive
				expect(Array.from(options).map((opt) => opt.textContent)).toContain(
					"google-drive (google_drive)",
				);
			});
		});

		it("should show warning when no authenticated providers", async () => {
			store = configureStore({
				reducer: {
					vault: vaultReducer,
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
					},
				},
			});

			render(
				<Provider store={store}>
					<I18nextProvider i18n={i18n}>
						<ImportVaultForm
							onSuccess={mockOnSuccess}
							onCancel={mockOnCancel}
						/>
					</I18nextProvider>
				</Provider>,
			);

			const cloudRadio = screen.getByDisplayValue("cloud");
			fireEvent.click(cloudRadio);

			await waitFor(() => {
				expect(
					screen.getByText("No cloud storage providers configured"),
				).toBeInTheDocument();
				expect(screen.getByText("Go to Settings")).toBeInTheDocument();
			});
		});
	});

	describe("Cloud Vault Selection", () => {
		it("should show cloud vault selector when provider is selected", async () => {
			const { listCloudVaults } = await import("../../../services/vault");
			vi.mocked(listCloudVaults).mockResolvedValue(mockCloudVaults);

			renderComponent();

			const cloudRadio = screen.getByDisplayValue("cloud");
			fireEvent.click(cloudRadio);

			await waitFor(() => {
				const providerSelect = screen.getByDisplayValue("Select Provider");
				fireEvent.change(providerSelect, { target: { value: "google-drive" } });
			});

			await waitFor(() => {
				expect(screen.getByText("Select Cloud Vault")).toBeInTheDocument();
				expect(screen.getByText("Cloud Vault 1")).toBeInTheDocument();
				expect(screen.getByText("Cloud Vault 2")).toBeInTheDocument();
			});
		});

		it("should show loading state while fetching cloud vaults", async () => {
			const { listCloudVaults } = await import("../../../services/vault");
			vi.mocked(listCloudVaults).mockImplementation(
				() =>
					new Promise((resolve) =>
						setTimeout(() => resolve(mockCloudVaults), 100),
					),
			);

			renderComponent();

			const cloudRadio = screen.getByDisplayValue("cloud");
			fireEvent.click(cloudRadio);

			await waitFor(() => {
				const providerSelect = screen.getByDisplayValue("Select Provider");
				fireEvent.change(providerSelect, { target: { value: "google-drive" } });
			});

			expect(screen.getByText("Loading cloud vaults...")).toBeInTheDocument();

			await waitFor(
				() => {
					expect(
						screen.queryByText("Loading cloud vaults..."),
					).not.toBeInTheDocument();
				},
				{ timeout: 200 },
			);
		});

		it("should show message when no cloud vaults found", async () => {
			const { listCloudVaults } = await import("../../../services/vault");
			vi.mocked(listCloudVaults).mockResolvedValue([]);

			renderComponent();

			const cloudRadio = screen.getByDisplayValue("cloud");
			fireEvent.click(cloudRadio);

			await waitFor(() => {
				const providerSelect = screen.getByDisplayValue("Select Provider");
				fireEvent.change(providerSelect, { target: { value: "google-drive" } });
			});

			await waitFor(() => {
				expect(
					screen.getByText("No vaults found in cloud storage"),
				).toBeInTheDocument();
			});
		});

		it("should auto-fill vault name when cloud vault is selected", async () => {
			const { listCloudVaults } = await import("../../../services/vault");
			vi.mocked(listCloudVaults).mockResolvedValue(mockCloudVaults);

			renderComponent();

			const cloudRadio = screen.getByDisplayValue("cloud");
			fireEvent.click(cloudRadio);

			await waitFor(() => {
				const providerSelect = screen.getByDisplayValue("Select Provider");
				fireEvent.change(providerSelect, { target: { value: "google-drive" } });
			});

			await waitFor(() => {
				const vaultSelect = screen.getByDisplayValue("Select Cloud Vault");
				fireEvent.change(vaultSelect, { target: { value: "cloud-vault-1" } });
			});

			await waitFor(() => {
				const nameInput = screen.getByPlaceholderText(
					"Enter vault name (optional)",
				);
				expect(nameInput).toHaveValue("Cloud Vault 1");
			});
		});
	});

	describe("Form Validation", () => {
		it("should validate required fields for local import", async () => {
			renderComponent();

			const importButton = screen.getByText("Import Vault");
			fireEvent.click(importButton);

			await waitFor(() => {
				expect(
					screen.getByText("Please fill in all fields"),
				).toBeInTheDocument();
			});
		});

		it("should validate provider and vault selection for cloud import", async () => {
			renderComponent();

			const cloudRadio = screen.getByDisplayValue("cloud");
			fireEvent.click(cloudRadio);

			await waitFor(() => {
				const importButton = screen.getByText("Import Vault");
				fireEvent.click(importButton);

				expect(
					screen.getByText("Please fill in all fields"),
				).toBeInTheDocument();
			});
		});

		it("should enable import button when all fields are filled for local import", async () => {
			const { open } = await import("@tauri-apps/plugin-dialog");
			vi.mocked(open).mockResolvedValue("/path/to/vault.monark");

			renderComponent();

			const browseButton = screen.getByText("Browse");
			fireEvent.click(browseButton);

			await waitFor(() => {
				fireEvent.change(screen.getByPlaceholderText("Enter password"), {
					target: { value: "password123" },
				});

				const importButton = screen.getByText("Import Vault");
				expect(importButton).not.toBeDisabled();
			});
		});

		it("should enable import button when all fields are filled for cloud import", async () => {
			const { listCloudVaults } = await import("../../../services/vault");
			vi.mocked(listCloudVaults).mockResolvedValue(mockCloudVaults);

			renderComponent();

			const cloudRadio = screen.getByDisplayValue("cloud");
			fireEvent.click(cloudRadio);

			await waitFor(() => {
				const providerSelect = screen.getByDisplayValue("Select Provider");
				fireEvent.change(providerSelect, { target: { value: "google-drive" } });
			});

			await waitFor(() => {
				const vaultSelect = screen.getByDisplayValue("Select Cloud Vault");
				fireEvent.change(vaultSelect, { target: { value: "cloud-vault-1" } });

				fireEvent.change(screen.getByPlaceholderText("Enter password"), {
					target: { value: "password123" },
				});

				const importButton = screen.getByText("Import Vault");
				expect(importButton).not.toBeDisabled();
			});
		});
	});

	describe("Form Submission", () => {
		it("should handle local vault import", async () => {
			const { open } = await import("@tauri-apps/plugin-dialog");
			const { invoke } = await import("@tauri-apps/api/core");

			vi.mocked(open).mockResolvedValue("/path/to/vault.monark");
			vi.mocked(invoke).mockResolvedValue({ entries: [] });

			renderComponent();

			const browseButton = screen.getByText("Browse");
			fireEvent.click(browseButton);

			await waitFor(() => {
				fireEvent.change(screen.getByPlaceholderText("Enter password"), {
					target: { value: "password123" },
				});

				const importButton = screen.getByText("Import Vault");
				fireEvent.click(importButton);
			});

			await waitFor(() => {
				expect(invoke).toHaveBeenCalledWith("read_vault", {
					filePath: "/path/to/vault.monark",
					password: "password123",
				});
			});
		});

		it("should handle cloud vault import", async () => {
			const { listCloudVaults } = await import("../../../services/vault");
			const vaultManager = vi.mocked(listCloudVaults);
			vaultManager.mockResolvedValue(mockCloudVaults);

			const mockVaultInstance = {
				unlock: vi.fn().mockResolvedValue(undefined),
			};

			const vaultManagerMock = {
				getInstance: vi.fn().mockReturnValue(mockVaultInstance),
				listCloudVaults: vaultManager,
			};

			vi.doMock("../../../services/vault", () => ({
				VaultManager: vaultManagerMock,
			}));

			renderComponent();

			const cloudRadio = screen.getByDisplayValue("cloud");
			fireEvent.click(cloudRadio);

			await waitFor(() => {
				const providerSelect = screen.getByDisplayValue("Select Provider");
				fireEvent.change(providerSelect, { target: { value: "google-drive" } });
			});

			await waitFor(() => {
				const vaultSelect = screen.getByDisplayValue("Select Cloud Vault");
				fireEvent.change(vaultSelect, { target: { value: "cloud-vault-1" } });

				fireEvent.change(screen.getByPlaceholderText("Enter password"), {
					target: { value: "password123" },
				});

				const importButton = screen.getByText("Import Vault");
				fireEvent.click(importButton);
			});

			await waitFor(() => {
				expect(mockVaultInstance.unlock).toHaveBeenCalledWith("password123");
			});
		});
	});

	describe("Error Handling", () => {
		it("should show error when cloud vault listing fails", async () => {
			const { listCloudVaults } = await import("../../../services/vault");
			vi.mocked(listCloudVaults).mockRejectedValue(
				new Error("Failed to load vaults"),
			);

			renderComponent();

			const cloudRadio = screen.getByDisplayValue("cloud");
			fireEvent.click(cloudRadio);

			await waitFor(() => {
				const providerSelect = screen.getByDisplayValue("Select Provider");
				fireEvent.change(providerSelect, { target: { value: "google-drive" } });
			});

			await waitFor(() => {
				expect(
					screen.getByText(/Error: Failed to load vaults/),
				).toBeInTheDocument();
			});
		});

		it("should show error when vault import fails", async () => {
			const { open } = await import("@tauri-apps/plugin-dialog");
			const { invoke } = await import("@tauri-apps/api/core");

			vi.mocked(open).mockResolvedValue("/path/to/vault.monark");
			vi.mocked(invoke).mockRejectedValue(new Error("Invalid password"));

			renderComponent();

			const browseButton = screen.getByText("Browse");
			fireEvent.click(browseButton);

			await waitFor(() => {
				fireEvent.change(screen.getByPlaceholderText("Enter password"), {
					target: { value: "wrongpassword" },
				});

				const importButton = screen.getByText("Import Vault");
				fireEvent.click(importButton);
			});

			await waitFor(() => {
				expect(screen.getByText("Error importing vault")).toBeInTheDocument();
			});
		});
	});
});
