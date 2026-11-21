/**
 * Component tests for `PasskeyExportModal` (T18).
 *
 * What is pinned here — this is the consent gate of the whole export flow:
 *
 * 1. the warning is visible and the Export button is **disabled** until the
 *    acknowledgement checkbox is ticked;
 * 2. `PasskeyCommands.exportCxf(..., true)` is called **only** after consent
 *    (negative control: while unchecked the command is not called at all);
 * 3. a cancelled save dialog writes nothing and — because the dialog runs
 *    before the command — does not even produce the plaintext document;
 * 4. a locked vault blocks the flow with a message and never calls the command;
 * 5. the exported document is written to the path the user chose, and neither
 *    the document nor the session password reaches a log line — asserted on the
 *    **success** path, where the document actually exists (the rejection path
 *    never produces one, so a console assertion there cannot catch a leak);
 * 6. the success message carries the reminder to delete the file;
 * 7. the handler-level consent guard (not just the `disabled` attribute) and
 *    the mid-flight close guard are both pinned by their own tests.
 *
 * Mocks are registered before the module under test is imported (vitest hoists
 * `vi.mock` above the imports). `waitFor` from Testing Library is unreliable
 * under bun+jsdom, so the async assertions poll with their own helper.
 */

import { configureStore } from "@reduxjs/toolkit";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { Provider } from "react-redux";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../../i18n";
import vaultReducer from "../../../redux/actions/vault";

const {
	mockExportCxf,
	mockDialogSave,
	mockWriteTextFile,
	mockResolveUnlockedVault,
} = vi.hoisted(() => ({
	mockExportCxf: vi.fn(),
	mockDialogSave: vi.fn(),
	mockWriteTextFile: vi.fn(),
	mockResolveUnlockedVault: vi.fn(),
}));

vi.mock("../../../services/vault", () => ({
	// `redux/store.tsx` calls `VaultManager.getInstance().initialize(...)` at
	// import time, so the manager stub has to provide it too.
	VaultManager: {
		getInstance: () => ({
			getInstance: vi.fn(),
			initialize: vi.fn(),
		}),
	},
}));

vi.mock("../../../services/passkey", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("../../../services/passkey")>();
	return {
		default: { exportCxf: mockExportCxf },
		vaultRefFor: actual.vaultRefFor,
	};
});

vi.mock("../../../services/passkeyCeremony", () => ({
	resolveUnlockedVaultForCxf: mockResolveUnlockedVault,
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
	open: vi.fn(),
	save: mockDialogSave,
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
	readTextFile: vi.fn(),
	writeTextFile: mockWriteTextFile,
}));

import {
	DEFAULT_EXPORT_FILE_NAME,
	PasskeyExportModal,
} from "../../../components/Vault/Modals/PasskeyExportModal";
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

const SESSION_PASSWORD = "session-password";

/** A CXF document as `export_cxf` returns it (spec example shape). */
const EXPORTED_DOCUMENT = JSON.stringify({
	version: { major: 1, minor: 0 },
	exporterRpId: "monark.app",
	exporterDisplayName: "Monark",
	timestamp: 1705228800,
	accounts: [
		{
			id: "dGVzdC1hY2NvdW50LWlk",
			username: "johndoe",
			email: "",
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

const UNLOCKED_VAULT = {
	id: "vault-1",
	name: "Personal",
	path: "/home/user/personal.monark",
	storageType: "local" as const,
	isLocked: false,
	volatile: { credential: SESSION_PASSWORD, entries: [] },
};

function renderModal() {
	const closePasskeyExport = vi.fn();
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
		isPasskeyExportModalOpen: true,
		closePasskeyExport,
	} as unknown as React.ContextType<typeof VaultModalContext>;

	const utils = render(
		<Provider store={store}>
			<I18nextProvider i18n={i18n}>
				<VaultModalContext.Provider value={contextValue}>
					<PasskeyExportModal />
				</VaultModalContext.Provider>
			</I18nextProvider>
		</Provider>,
	);

	return { ...utils, closePasskeyExport };
}

/**
 * The modal lives inside `<dialog>`, which jsdom keeps out of the a11y tree:
 * role queries must pass `hidden: true` to reach its buttons.
 */
const byRole = (name: string) =>
	screen.getByRole("button", { name, hidden: true });

const exportButton = () => byRole(i18n.t("home:passkey.export.export"));
const consentCheckbox = () =>
	screen.getByRole("checkbox", { hidden: true }) as HTMLInputElement;

/** The ✕ rendered by `UI/Modal.tsx` (its only text content). */
const closeIconButton = () => byRole("✕");

/**
 * Spies on both console channels and returns a reader for everything written
 * through them. The spies are restored in `afterEach`, so a failing assertion
 * cannot leave `console` stubbed for the rest of the file.
 */
function spyOnConsole(): () => string {
	const consoleError = vi
		.spyOn(console, "error")
		.mockImplementation(() => undefined);
	const consoleLog = vi
		.spyOn(console, "log")
		.mockImplementation(() => undefined);
	return () =>
		JSON.stringify([...consoleError.mock.calls, ...consoleLog.mock.calls]);
}

describe("PasskeyExportModal", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockDialogSave.mockResolvedValue("/home/user/monark-passkeys.cxf.json");
		mockExportCxf.mockResolvedValue(EXPORTED_DOCUMENT);
		mockWriteTextFile.mockResolvedValue(undefined);
		mockResolveUnlockedVault.mockReturnValue({
			vault: UNLOCKED_VAULT,
			credential: SESSION_PASSWORD,
		});
	});

	afterEach(() => {
		// Restores every spy even when an assertion above threw (NIT-12).
		vi.restoreAllMocks();
	});

	it("shows the plaintext warning and starts with the consent unchecked", () => {
		renderModal();

		expect(
			screen.getByText(i18n.t("home:passkey.export.warning")),
		).toBeInTheDocument();
		expect(consentCheckbox().checked).toBe(false);
		expect(exportButton()).toBeDisabled();
	});

	it("keeps Export disabled until the checkbox is ticked", async () => {
		const user = userEvent.setup();
		renderModal();

		expect(exportButton()).toBeDisabled();

		await user.click(consentCheckbox());

		expect(consentCheckbox().checked).toBe(true);
		expect(exportButton()).not.toBeDisabled();
	});

	it("does not export while consent is unchecked (negative control)", async () => {
		const user = userEvent.setup();
		renderModal();

		// Clicking the disabled button must not reach the command…
		await user.click(exportButton());

		expect(mockExportCxf).not.toHaveBeenCalled();
		expect(mockDialogSave).not.toHaveBeenCalled();
		expect(mockWriteTextFile).not.toHaveBeenCalled();
	});

	it("exports with consent=true and writes the chosen file", async () => {
		// The document DOES exist on this path, so this is the only place where
		// a "the plaintext was logged" regression can actually be observed.
		const consoleCalls = spyOnConsole();
		const user = userEvent.setup();
		renderModal();

		await user.click(consentCheckbox());
		await user.click(exportButton());

		await pollUntil(() => {
			expect(mockWriteTextFile).toHaveBeenCalledTimes(1);
		});

		// The consent flag is `true` — the backend refuses anything else.
		expect(mockExportCxf).toHaveBeenCalledWith(
			{ kind: "local", file_path: "/home/user/personal.monark" },
			SESSION_PASSWORD,
			true,
		);
		// Default file name offered by the save dialog.
		expect(mockDialogSave).toHaveBeenCalledWith(
			expect.objectContaining({ defaultPath: DEFAULT_EXPORT_FILE_NAME }),
		);
		// The document goes to the path the user picked, byte for byte.
		expect(mockWriteTextFile).toHaveBeenCalledWith(
			"/home/user/monark-passkeys.cxf.json",
			EXPORTED_DOCUMENT,
		);
		// …and it never reaches a log line: neither the credential id inside the
		// document nor the session password may appear in any console call.
		const logged = consoleCalls();
		expect(logged).not.toContain("Y3JlZGVudGlhbElkRXhhbXBsZQ");
		expect(logged).not.toContain(SESSION_PASSWORD);
	});

	it("writes nothing when the save dialog is cancelled", async () => {
		mockDialogSave.mockResolvedValue(null);
		const user = userEvent.setup();
		renderModal();

		await user.click(consentCheckbox());
		await user.click(exportButton());

		await pollUntil(() => {
			expect(mockDialogSave).toHaveBeenCalledTimes(1);
		});
		// The destination is chosen BEFORE the document is produced: a cancelled
		// dialog means no plaintext ever exists.
		expect(mockExportCxf).not.toHaveBeenCalled();
		expect(mockWriteTextFile).not.toHaveBeenCalled();
	});

	it("shows the delete reminder after a successful export", async () => {
		const user = userEvent.setup();
		renderModal();

		await user.click(consentCheckbox());
		await user.click(exportButton());

		await pollUntil(() => {
			expect(
				screen.getByText(i18n.t("home:passkey.export.deleteReminder")),
			).toBeInTheDocument();
		});
		expect(
			screen.getByText(
				i18n.t("home:passkey.export.success", {
					fileName: "/home/user/monark-passkeys.cxf.json",
				}),
			),
		).toBeInTheDocument();
	});

	it("blocks the flow on a locked vault without calling the command", async () => {
		mockResolveUnlockedVault.mockImplementation(() => {
			throw new Error("Vault must be unlocked.");
		});
		const user = userEvent.setup();
		renderModal();

		await user.click(consentCheckbox());
		await user.click(exportButton());

		await pollUntil(() => {
			expect(
				screen.getByText(i18n.t("home:passkey.export.errors.locked")),
			).toBeInTheDocument();
		});
		expect(mockDialogSave).not.toHaveBeenCalled();
		expect(mockExportCxf).not.toHaveBeenCalled();
		expect(mockWriteTextFile).not.toHaveBeenCalled();
	});

	it("shows a backend rejection inline and never logs the document", async () => {
		const consoleCalls = spyOnConsole();
		mockExportCxf.mockRejectedValue(
			new Error("Validation Error: Export requires explicit user consent"),
		);
		const user = userEvent.setup();
		renderModal();

		await user.click(consentCheckbox());
		await user.click(exportButton());

		await pollUntil(() => {
			expect(
				screen.getByText(
					"Validation Error: Export requires explicit user consent",
				),
			).toBeInTheDocument();
		});
		expect(mockWriteTextFile).not.toHaveBeenCalled();
		const logged = consoleCalls();
		expect(logged).not.toContain("Y3JlZGVudGlhbElkRXhhbXBsZQ");
		expect(logged).not.toContain(SESSION_PASSWORD);
	});

	it("refuses to export when the handler is reached without consent (guard NC)", async () => {
		// The markup layer (`disabled`) is pinned by the two tests above. This
		// one pins the *handler* guard: the attribute is stripped so the click
		// really reaches `handleExport`, and only the `if (!consent) return`
		// can keep the command from running.
		const user = userEvent.setup();
		renderModal();

		const button = exportButton();
		button.removeAttribute("disabled");
		expect(button).not.toBeDisabled();

		await user.click(button);

		expect(mockExportCxf).not.toHaveBeenCalled();
		expect(mockDialogSave).not.toHaveBeenCalled();
		expect(mockWriteTextFile).not.toHaveBeenCalled();
	});

	it("does not close while an export is in flight (keeps the delete reminder)", async () => {
		// Hold the write open so the modal is still `loading` when ✕ is clicked.
		let releaseWrite: () => void = () => undefined;
		mockWriteTextFile.mockImplementation(
			() =>
				new Promise<void>((resolve) => {
					releaseWrite = resolve;
				}),
		);
		const user = userEvent.setup();
		const { closePasskeyExport } = renderModal();

		await user.click(consentCheckbox());
		await user.click(exportButton());
		await pollUntil(() => {
			expect(mockWriteTextFile).toHaveBeenCalledTimes(1);
		});

		// ✕ (and the backdrop) stay live in `UI/Modal.tsx` while loading.
		await user.click(closeIconButton());

		// The close was refused, so the state the write is about to fill survives.
		expect(closePasskeyExport).not.toHaveBeenCalled();

		releaseWrite();
		await pollUntil(() => {
			expect(
				screen.getByText(i18n.t("home:passkey.export.deleteReminder")),
			).toBeInTheDocument();
		});
		expect(
			screen.getByText(
				i18n.t("home:passkey.export.success", {
					fileName: "/home/user/monark-passkeys.cxf.json",
				}),
			),
		).toBeInTheDocument();
	});

	it("requires a fresh consent for a second export", async () => {
		const user = userEvent.setup();
		renderModal();

		await user.click(consentCheckbox());
		await user.click(exportButton());
		await pollUntil(() => {
			expect(mockWriteTextFile).toHaveBeenCalledTimes(1);
		});

		// The acknowledgement covered the first export only.
		await pollUntil(() => {
			expect(consentCheckbox().checked).toBe(false);
		});
		expect(exportButton()).toBeDisabled();
	});

	it("ignores a second click while the export is running (re-entrancy guard)", async () => {
		let releaseSave: (value: string) => void = () => undefined;
		mockDialogSave.mockImplementation(
			() =>
				new Promise<string>((resolve) => {
					releaseSave = resolve;
				}),
		);
		const user = userEvent.setup();
		renderModal();

		await user.click(consentCheckbox());
		await user.click(exportButton());
		await pollUntil(() => {
			expect(mockDialogSave).toHaveBeenCalledTimes(1);
		});

		// Second click in the same flight: the button is disabled (and its label
		// is the spinner), so strip the attribute and click the element itself
		// to reach the handler and prove the busy guard holds.
		const button = screen
			.getAllByRole("button", { hidden: true })
			.find((candidate) => candidate.classList.contains("btn-primary"));
		expect(button).toBeDefined();
		(button as HTMLButtonElement).removeAttribute("disabled");
		await user.click(button as HTMLButtonElement);

		expect(mockDialogSave).toHaveBeenCalledTimes(1);

		releaseSave("/home/user/monark-passkeys.cxf.json");
		await pollUntil(() => {
			expect(mockWriteTextFile).toHaveBeenCalledTimes(1);
		});
		expect(mockExportCxf).toHaveBeenCalledTimes(1);
	});

	it("has no input for credential material", () => {
		const { container } = renderModal();

		// The only input is the consent checkbox; there is no password field and
		// no field bound to key material.
		const inputs = Array.from(container.querySelectorAll("input"));
		expect(inputs).toHaveLength(1);
		expect(inputs[0].getAttribute("type")).toBe("checkbox");
		expect(container.textContent).not.toContain(SESSION_PASSWORD);
	});

	it("closes through the context action", async () => {
		const user = userEvent.setup();
		const { closePasskeyExport } = renderModal();

		await user.click(byRole(i18n.t("home:passkey.export.close")));

		expect(closePasskeyExport).toHaveBeenCalledTimes(1);
	});
});
