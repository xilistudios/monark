/**
 * Component tests for `PasskeyImportModal` (T18).
 *
 * What is pinned here:
 *
 * 1. the flow calls `PasskeyCommands.importCxf` with the **file content** and
 *    the **session password** (never a user-typed one — there is no password
 *    input in this modal);
 * 2. the report reaches the user: `imported` / `duplicates` counts and the
 *    per-credential rows, with the two kinds of `skipped` row rendered
 *    differently (rejected vs. imported-with-data-ignored);
 * 3. a locked vault blocks the flow with a message and **never** calls the
 *    command;
 * 4. an error is shown inline and the file content never reaches a log line;
 * 5. the entries are refreshed after a successful import (the backend wrote the
 *    vault file; the Redux view is stale until `refreshEntries`);
 * 6. an unexpected report shape is rejected by `cxfImportReportSchema` instead
 *    of being rendered;
 * 7. `EXTENSIONS_IGNORED_NOTE` is pinned **against the Rust source**
 *    (`src-tauri/src/passkey/cxf.rs`), not against itself;
 * 8. closing the modal while an import is in flight is refused.
 *
 * Mocks are registered before the module under test is imported (vitest hoists
 * `vi.mock` above the imports). `waitFor` from Testing Library is unreliable
 * under bun+jsdom, so the async assertions poll with their own helper.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { configureStore } from "@reduxjs/toolkit";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { Provider } from "react-redux";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../../i18n";
import type { CxfImportReport } from "../../../interfaces/passkey.interface";
import vaultReducer from "../../../redux/actions/vault";

// `vi.hoisted` so the factories below can reference the spies: `vi.mock` calls
// are hoisted above the imports, and a plain `const` would still be in its TDZ
// when a transitively imported module (i18n → redux store → services/vault)
// first calls `getInstance()`.
const {
	mockImportCxf,
	mockRefreshEntries,
	mockGetInstance,
	mockDialogOpen,
	mockReadTextFile,
	mockResolveUnlockedVault,
} = vi.hoisted(() => {
	const importCxf = vi.fn();
	const refreshEntries = vi.fn();
	return {
		mockImportCxf: importCxf,
		mockRefreshEntries: refreshEntries,
		mockGetInstance: vi.fn(() => ({ refreshEntries })),
		mockDialogOpen: vi.fn(),
		mockReadTextFile: vi.fn(),
		mockResolveUnlockedVault: vi.fn(),
	};
});

vi.mock("../../../services/vault", () => ({
	// `redux/store.tsx` calls `VaultManager.getInstance().initialize(...)` at
	// import time, so the manager stub has to provide it too.
	VaultManager: {
		getInstance: () => ({
			getInstance: mockGetInstance,
			initialize: vi.fn(),
		}),
	},
}));

vi.mock("../../../services/passkey", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("../../../services/passkey")>();
	return {
		default: { importCxf: mockImportCxf },
		vaultRefFor: actual.vaultRefFor,
	};
});

vi.mock("../../../services/passkeyCeremony", () => ({
	resolveUnlockedVaultForCxf: mockResolveUnlockedVault,
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
	open: mockDialogOpen,
	save: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
	readTextFile: mockReadTextFile,
	writeTextFile: vi.fn(),
}));

import {
	EXTENSIONS_IGNORED_NOTE,
	PasskeyImportModal,
} from "../../../components/Vault/Modals/PasskeyImportModal";
import { VaultModalContext } from "../../../components/Vault/VaultContext";

/** Polls until `assertion` stops throwing (bun+jsdom: no `waitFor`). */
async function pollUntil(
	assertion: () => void,
	{ timeoutMs = 2000, intervalMs = 20 } = {},
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	let lastError: unknown;
	while (Date.now() < deadline) {
		try {
			assertion();
			return;
		} catch (error) {
			lastError = error;
			await new Promise((resolve) => setTimeout(resolve, intervalMs));
		}
	}
	throw lastError;
}

/**
 * A CXF document shaped like the published spec example
 * (`fixtures/cxf/spec-appendix-a.json`): one importable passkey plus a
 * `basic-auth` and a `totp` credential the vault cannot represent. No real
 * secret material — the "key" is the spec's own example value.
 */
const CXF_CONTENT = JSON.stringify({
	version: { major: 1, minor: 0 },
	exporterRpId: "example.com",
	exporterDisplayName: "Example Exporter",
	timestamp: 1705228800,
	accounts: [
		{
			id: "dGVzdC1hY2NvdW50LWlk",
			username: "johndoe",
			email: "johndoe@example.com",
			collections: [],
			items: [
				{
					id: "dGVzdC1pdGVtLWlk",
					title: "WebAuthn.io",
					credentials: [
						{
							type: "passkey",
							credentialId: "Y3JlZGVudGlhbElkRXhhbXBsZQ",
							rpId: "webauthn.io",
							username: "johndoe",
							userDisplayName: "John Doe",
							userHandle: "cnEzaNHWcYK3coWZjvoaV1Hj9gnI12mKe2dL2HZVFlY",
						},
					],
				},
			],
		},
	],
});

const SESSION_PASSWORD = "session-password";

const REPORT: CxfImportReport = {
	imported: 1,
	duplicates: 0,
	skipped: [
		{
			itemTitle: "Example login",
			credentialType: "basic-auth",
			reason: "unsupported credential type: basic-auth",
		},
	],
};

/** A report whose single row is an *imported* passkey with data dropped. */
const LOSSY_REPORT: CxfImportReport = {
	imported: 1,
	duplicates: 0,
	skipped: [
		{
			itemTitle: "WebAuthn.io",
			credentialType: "passkey",
			reason: EXTENSIONS_IGNORED_NOTE,
		},
	],
};

const UNLOCKED_VAULT = {
	id: "vault-1",
	name: "Personal",
	path: "/home/user/personal.monark",
	storageType: "local" as const,
	isLocked: false,
	volatile: { credential: SESSION_PASSWORD, entries: [] },
};

function renderModal() {
	const closePasskeyImport = vi.fn();
	const store = configureStore({
		reducer: { vault: vaultReducer },
		preloadedState: {
			vault: {
				vaults: [UNLOCKED_VAULT],
				currentVaultId: "vault-1",
				loading: false,
				error: null,
				providers: [],
				defaultProvider: null,
				providerStatus: {},
			},
		},
	});

	const contextValue = {
		isPasskeyImportModalOpen: true,
		closePasskeyImport,
	} as unknown as React.ContextType<typeof VaultModalContext>;

	const utils = render(
		<Provider store={store}>
			<I18nextProvider i18n={i18n}>
				<VaultModalContext.Provider value={contextValue}>
					<PasskeyImportModal />
				</VaultModalContext.Provider>
			</I18nextProvider>
		</Provider>,
	);

	return { ...utils, closePasskeyImport };
}

/**
 * The modal lives inside `<dialog>`, which jsdom keeps out of the a11y tree:
 * role queries must pass `hidden: true` to reach its buttons.
 */
const byRole = (name: string) =>
	screen.getByRole("button", { name, hidden: true });

const selectFileButton = () => byRole(i18n.t("home:passkey.import.selectFile"));

/** The ✕ rendered by `UI/Modal.tsx` (its only text content). */
const closeIconButton = () => byRole("✕");

/**
 * Reads a `pub const NAME: &str = "…";` value out of the Rust source.
 *
 * The import report's `reason` string is the only discriminator between a
 * rejected credential and one imported with data dropped, and it is produced by
 * Rust. Comparing the TS constant against itself would be blind to drift, so
 * the pin reads the Rust file.
 */
function rustConstValue(sourcePath: string, name: string): string {
	const source = readFileSync(sourcePath, "utf8");
	const match = source.match(
		new RegExp(`pub const ${name}: &str = "([^"]*)";`),
	);
	if (!match) {
		throw new Error(`${name} not found in ${sourcePath}`);
	}
	return match[1];
}

/** Absolute path of `src-tauri/src/passkey/cxf.rs` from this test file. */
const CXF_RS_PATH = resolve(process.cwd(), "src-tauri/src/passkey/cxf.rs");

describe("PasskeyImportModal", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockDialogOpen.mockResolvedValue("/home/user/passkeys.cxf.json");
		mockReadTextFile.mockResolvedValue(CXF_CONTENT);
		mockImportCxf.mockResolvedValue(REPORT);
		mockRefreshEntries.mockResolvedValue(undefined);
		mockResolveUnlockedVault.mockReturnValue({
			vault: UNLOCKED_VAULT,
			credential: SESSION_PASSWORD,
		});
	});

	afterEach(() => {
		// Restores every spy even when an assertion above threw (NIT-12).
		vi.restoreAllMocks();
	});

	it("pins EXTENSIONS_IGNORED_NOTE against the Rust constant (cross-language)", () => {
		// A drift here would render every lossy row as "N credentials not
		// imported" while the passkey is in the vault.
		expect(rustConstValue(CXF_RS_PATH, "EXTENSIONS_IGNORED_NOTE")).toBe(
			EXTENSIONS_IGNORED_NOTE,
		);
	});

	it("imports the picked file with the session password", async () => {
		const user = userEvent.setup();
		renderModal();

		await user.click(selectFileButton());

		await pollUntil(() => {
			expect(mockImportCxf).toHaveBeenCalledTimes(1);
		});

		// The picker is filtered to CXF documents.
		expect(mockDialogOpen).toHaveBeenCalledWith({
			multiple: false,
			directory: false,
			filters: [{ name: "CXF", extensions: ["json", "cxf"] }],
		});
		// The file is read from the path the user picked…
		expect(mockReadTextFile).toHaveBeenCalledWith(
			"/home/user/passkeys.cxf.json",
		);
		// …and handed to the command verbatim, with the session password (never
		// a password typed in this modal — there is no such input).
		const [vaultRef, password, content] = mockImportCxf.mock.calls[0];
		expect(vaultRef).toEqual({
			kind: "local",
			file_path: "/home/user/personal.monark",
		});
		expect(password).toBe(SESSION_PASSWORD);
		expect(content).toBe(CXF_CONTENT);
	});

	it("has no input for credential material or a password", () => {
		const { container } = renderModal();

		// Only the consent-free file flow: no text/password inputs at all.
		expect(container.querySelectorAll("input")).toHaveLength(0);
		expect(container.querySelectorAll("textarea")).toHaveLength(0);
		expect(container.textContent).not.toContain(SESSION_PASSWORD);
	});

	it("renders the imported/duplicates counts and the skipped reasons", async () => {
		const user = userEvent.setup();
		renderModal();

		await user.click(selectFileButton());

		await pollUntil(() => {
			expect(
				screen.getByText(i18n.t("home:passkey.import.imported")),
			).toBeInTheDocument();
		});

		// Counts reach the user (the plan's requirement).
		expect(screen.getByText("1")).toBeInTheDocument();
		expect(
			screen.getByText(i18n.t("home:passkey.import.duplicates")),
		).toBeInTheDocument();
		// The rejected credential is listed with its type and reason.
		expect(screen.getByText("Example login")).toBeInTheDocument();
		expect(
			screen.getByText(
				i18n.t("home:passkey.import.skipped.row", {
					credentialType: "basic-auth",
					reason: "unsupported credential type: basic-auth",
				}),
			),
		).toBeInTheDocument();
		// The file name is shown so the user knows what was imported.
		expect(
			screen.getByText(
				i18n.t("home:passkey.import.selectedFile", {
					fileName: "passkeys.cxf.json",
				}),
			),
		).toBeInTheDocument();
	});

	it("renders an imported-but-lossy row as a warning, not a failure", async () => {
		mockImportCxf.mockResolvedValue(LOSSY_REPORT);
		const user = userEvent.setup();
		renderModal();

		await user.click(selectFileButton());

		await pollUntil(() => {
			expect(
				screen.getByText(
					i18n.t("home:passkey.import.lossy.title", { count: 1 }),
				),
			).toBeInTheDocument();
		});

		// The row is in the warning list…
		expect(
			screen.getByText(
				i18n.t("home:passkey.import.lossy.row", {
					itemTitle: "WebAuthn.io",
					reason: EXTENSIONS_IGNORED_NOTE,
				}),
			),
		).toBeInTheDocument();
		// …and NOT in the "not imported" list: the passkey is in the vault.
		expect(
			screen.queryByText(
				i18n.t("home:passkey.import.skipped.title", { count: 1 }),
			),
		).toBeNull();
	});

	it("refreshes the entries after a successful import", async () => {
		const user = userEvent.setup();
		renderModal();

		await user.click(selectFileButton());

		await pollUntil(() => {
			expect(mockRefreshEntries).toHaveBeenCalledTimes(1);
		});
		// The refresh happens through the vault instance of the current vault.
		expect(mockGetInstance).toHaveBeenCalledWith("vault-1");
	});

	it("blocks the flow on a locked vault without calling the command", async () => {
		mockResolveUnlockedVault.mockImplementation(() => {
			throw new Error("Vault must be unlocked.");
		});
		const user = userEvent.setup();
		renderModal();

		await user.click(selectFileButton());

		await pollUntil(() => {
			expect(
				screen.getByText(i18n.t("home:passkey.import.errors.locked")),
			).toBeInTheDocument();
		});
		// Nothing was read, imported or refreshed.
		expect(mockReadTextFile).not.toHaveBeenCalled();
		expect(mockImportCxf).not.toHaveBeenCalled();
		expect(mockRefreshEntries).not.toHaveBeenCalled();
	});

	it("does nothing when the file picker is cancelled", async () => {
		mockDialogOpen.mockResolvedValue(null);
		const user = userEvent.setup();
		renderModal();

		await user.click(selectFileButton());

		await pollUntil(() => {
			expect(mockDialogOpen).toHaveBeenCalledTimes(1);
		});
		expect(mockReadTextFile).not.toHaveBeenCalled();
		expect(mockImportCxf).not.toHaveBeenCalled();
	});

	it("shows a backend rejection inline and never logs the file content", async () => {
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);
		const consoleLog = vi
			.spyOn(console, "log")
			.mockImplementation(() => undefined);
		mockImportCxf.mockRejectedValue(
			new Error("Validation Error: Unsupported CXF major version"),
		);
		const user = userEvent.setup();
		renderModal();

		await user.click(selectFileButton());

		await pollUntil(() => {
			expect(
				screen.getByText("Validation Error: Unsupported CXF major version"),
			).toBeInTheDocument();
		});
		// The document (and the password) must never reach a log line.
		const logged = JSON.stringify([
			...consoleError.mock.calls,
			...consoleLog.mock.calls,
		]);
		expect(logged).not.toContain("Y3JlZGVudGlhbElkRXhhbXBsZQ");
		expect(logged).not.toContain(SESSION_PASSWORD);
	});

	it("rejects an unexpected report shape instead of rendering it (negative control)", async () => {
		// The stale pre-T16 shape: `skipped` as a number. Rendering it would
		// show "undefined" rows or throw; the schema must catch it first.
		mockImportCxf.mockResolvedValue({
			imported: 1,
			skipped: 2,
			failed: 0,
			messages: [],
		});
		const user = userEvent.setup();
		renderModal();

		await user.click(selectFileButton());

		await pollUntil(() => {
			expect(
				screen.getByText(i18n.t("home:passkey.import.errors.unexpectedReport")),
			).toBeInTheDocument();
		});
		// No counts rendered, and no refresh on a report we cannot interpret.
		expect(
			screen.queryByText(i18n.t("home:passkey.import.imported")),
		).toBeNull();
		expect(mockRefreshEntries).not.toHaveBeenCalled();
	});

	it("keeps the report visible when the refresh fails", async () => {
		mockRefreshEntries.mockRejectedValue(new Error("read failed"));
		const user = userEvent.setup();
		renderModal();

		await user.click(selectFileButton());

		await pollUntil(() => {
			expect(
				screen.getByText(i18n.t("home:passkey.import.errors.refreshFailed")),
			).toBeInTheDocument();
		});
		// The passkeys ARE in the vault: the counts must still be shown.
		expect(
			screen.getByText(i18n.t("home:passkey.import.imported")),
		).toBeInTheDocument();
	});

	it("closes through the context action", async () => {
		const user = userEvent.setup();
		const { closePasskeyImport } = renderModal();

		await user.click(byRole(i18n.t("home:passkey.import.close")));

		expect(closePasskeyImport).toHaveBeenCalledTimes(1);
	});

	it("does not close while an import is in flight", async () => {
		// Hold the command open so the modal is still `loading` on the ✕ click.
		let releaseImport: (value: CxfImportReport) => void = () => undefined;
		mockImportCxf.mockImplementation(
			() =>
				new Promise<CxfImportReport>((resolve) => {
					releaseImport = resolve;
				}),
		);
		const user = userEvent.setup();
		const { closePasskeyImport } = renderModal();

		await user.click(selectFileButton());
		await pollUntil(() => {
			expect(mockImportCxf).toHaveBeenCalledTimes(1);
		});

		// ✕ stays live in `UI/Modal.tsx` while loading.
		await user.click(closeIconButton());
		expect(closePasskeyImport).not.toHaveBeenCalled();

		releaseImport(REPORT);
		// The report the in-flight import produces still reaches the user.
		await pollUntil(() => {
			expect(
				screen.getByText(i18n.t("home:passkey.import.imported")),
			).toBeInTheDocument();
		});
	});

	it("ignores a second click while the import is running (re-entrancy guard)", async () => {
		let releaseOpen: (value: string) => void = () => undefined;
		mockDialogOpen.mockImplementation(
			() =>
				new Promise<string>((resolve) => {
					releaseOpen = resolve;
				}),
		);
		const user = userEvent.setup();
		renderModal();

		await user.click(selectFileButton());
		await pollUntil(() => {
			expect(mockDialogOpen).toHaveBeenCalledTimes(1);
		});

		// The button is disabled while loading (and its label is the spinner):
		// strip the attribute and click the element itself to reach the handler.
		const button = screen
			.getAllByRole("button", { hidden: true })
			.find((candidate) => candidate.classList.contains("btn-primary"));
		expect(button).toBeDefined();
		(button as HTMLButtonElement).removeAttribute("disabled");
		await user.click(button as HTMLButtonElement);

		expect(mockDialogOpen).toHaveBeenCalledTimes(1);

		releaseOpen("/home/user/passkeys.cxf.json");
		await pollUntil(() => {
			expect(mockImportCxf).toHaveBeenCalledTimes(1);
		});
	});

	it("renders the modal header inside the dialog", () => {
		const { container } = renderModal();
		const dialog = container.querySelector("dialog.modal-open");
		expect(dialog).not.toBeNull();
		expect(
			within(dialog as HTMLElement).getByText(
				i18n.t("home:passkey.import.title"),
			),
		).toBeInTheDocument();
	});
});
