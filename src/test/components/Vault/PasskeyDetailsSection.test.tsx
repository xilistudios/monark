/**
 * Component tests for `PasskeyDetailsSection` (T13).
 *
 * What is pinned here:
 *
 * 1. the read-only detail view renders every member of the sanitized
 *    `PasskeyView` (rp name + id, user name, display name, credential id,
 *    algorithm label, sign count, discoverable badge, transports, timestamps,
 *    tags);
 * 2. **no input element exists for credential material** — the section must
 *    never expose an editor for the credential id, user handle or aaguid, and
 *    the sanitized view carries no private key at all;
 * 3. the copy button goes through `copySensitive` (never
 *    `navigator.clipboard`) with the credential id;
 * 4. the delete flow asks for confirmation, then calls
 *    `VaultInstance.deleteEntry` with the entry path (whose passkey branch is
 *    the only path that reaches `passkey_delete` — see
 *    `src/test/services/vault.test.ts` for the branch itself).
 *
 * Mocks are registered before the module under test is imported (vitest hoists
 * `vi.mock` above the imports). `waitFor` from Testing Library is unreliable
 * under bun+jsdom, so the async assertions poll with their own helper.
 */

import { configureStore } from "@reduxjs/toolkit";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { Provider } from "react-redux";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../../i18n";
import type { PasskeyEntry } from "../../../interfaces/vault.interface";
import vaultReducer from "../../../redux/actions/vault";

// `vi.hoisted` so the factories below can reference the spies: `vi.mock` calls
// are hoisted above the imports, and a plain `const` would still be in its TDZ
// when a transitively imported module (i18n → redux store → services/vault)
// first calls `getInstance()`.
const { mockDeleteEntry, mockGetInstance, mockCopySensitive } = vi.hoisted(
	() => {
		const deleteEntry = vi.fn();
		return {
			mockDeleteEntry: deleteEntry,
			mockGetInstance: vi.fn(() => ({ deleteEntry })),
			mockCopySensitive: vi.fn(),
		};
	},
);

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

vi.mock("../../../utils/clipboard", () => ({
	copySensitive: (value: string) => mockCopySensitive(value),
}));

import { PasskeyDetailsSection } from "../../../components/Vault/PasskeyDetailsSection";

/**
 * Returns the confirm dialog node.
 *
 * jsdom does not implement `<dialog>`, so the element (and everything inside
 * it) is not part of the accessible tree: role queries must pass
 * `hidden: true` to reach the confirm buttons.
 */
function confirmDialog(): HTMLElement {
	const dialog = document.querySelector("dialog.modal-open");
	if (!(dialog instanceof HTMLElement)) {
		throw new Error("confirm dialog is not open");
	}
	return dialog;
}

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

const PASSKEY: PasskeyEntry = {
	id: "11111111-1111-1111-1111-111111111111",
	entry_type: "passkey",
	name: "GitHub",
	created_at: "2026-01-02T03:04:05Z",
	updated_at: "2026-01-03T04:05:06Z",
	tags: ["work", "dev"],
	rp_id: "github.com",
	rp_name: "GitHub",
	credential_id: "3q2-7wABC",
	user_handle: "AQIDBA",
	user_name: "octocat",
	user_display_name: "The Octocat",
	algorithm: -7,
	sign_count: 0,
	discoverable: true,
	transports: ["internal", "hybrid"],
	aaguid: "00000000-0000-0000-0000-000000000000",
};

function renderSection(entry: PasskeyEntry = PASSKEY, onDeleted?: () => void) {
	const store = configureStore({
		reducer: { vault: vaultReducer },
		preloadedState: {
			vault: {
				vaults: [],
				currentVaultId: "vault-1",
				loading: false,
				error: null,
				providers: [],
				defaultProvider: null,
				providerStatus: {},
			},
		},
	});
	const utils = render(
		<Provider store={store}>
			<I18nextProvider i18n={i18n}>
				<PasskeyDetailsSection entry={entry} onDeleted={onDeleted} />
			</I18nextProvider>
		</Provider>,
	);
	return { store, ...utils };
}

describe("PasskeyDetailsSection", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockDeleteEntry.mockResolvedValue(undefined);
		mockCopySensitive.mockResolvedValue(undefined);
	});

	it("renders the relying party name and id", () => {
		renderSection();
		expect(screen.getByText("GitHub")).toBeInTheDocument();
		expect(screen.getByText("github.com")).toBeInTheDocument();
	});

	it("renders the user name and display name", () => {
		renderSection();
		expect(screen.getByText("octocat")).toBeInTheDocument();
		expect(screen.getByText("The Octocat")).toBeInTheDocument();
	});

	it("renders the credential id in a monospace element", () => {
		renderSection();
		const credentialId = screen.getByText("3q2-7wABC");
		expect(credentialId.tagName.toLowerCase()).toBe("code");
		expect(credentialId).toHaveClass("font-mono");
	});

	it("renders algorithm, sign count, discoverable state and transports", () => {
		renderSection();
		expect(screen.getByText("ES256 (P-256)")).toBeInTheDocument();
		expect(screen.getByText("0")).toBeInTheDocument(); // sign_count
		expect(screen.getByText("Yes")).toBeInTheDocument(); // discoverable
		expect(screen.getByText("internal")).toBeInTheDocument();
		expect(screen.getByText("hybrid")).toBeInTheDocument();
	});

	it("renders the tags", () => {
		renderSection();
		expect(screen.getByText("work")).toBeInTheDocument();
		expect(screen.getByText("dev")).toBeInTheDocument();
	});

	it("exposes NO input element for credential material", () => {
		const { container } = renderSection();

		// The only interactive control is the credential-id copy button; every
		// member of the sanitized view is static text.
		expect(container.querySelectorAll("input")).toHaveLength(0);
		expect(container.querySelectorAll("textarea")).toHaveLength(0);
		expect(container.querySelectorAll("select")).toHaveLength(0);

		// Negative control: the assertion above is meaningful only because the
		// rendered text really does contain the credential material a naive
		// editor would bind to an input.
		expect(container.textContent).toContain(PASSKEY.credential_id);
	});

	it("never renders the user handle or the aaguid", () => {
		// Neither is useful to a human and both are credential material: they
		// stay out of the DOM entirely.
		const { container } = renderSection();
		expect(container.textContent).not.toContain(PASSKEY.user_handle);
		expect(container.textContent).not.toContain(PASSKEY.aaguid);
	});

	it("copies the credential id through copySensitive", async () => {
		const user = userEvent.setup();
		renderSection();

		await user.click(screen.getByRole("button", { name: i18n.t("home:copy") }));

		await pollUntil(() => {
			expect(mockCopySensitive).toHaveBeenCalledWith(PASSKEY.credential_id);
			expect(screen.getByText("Credential ID copied")).toBeInTheDocument();
		});
	});

	it("shows an error when the copy fails, without logging the value", async () => {
		const user = userEvent.setup();
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);
		mockCopySensitive.mockRejectedValue(new Error("clipboard unavailable"));

		renderSection();
		await user.click(screen.getByRole("button", { name: i18n.t("home:copy") }));

		await pollUntil(() => {
			expect(
				screen.getByText("Could not copy the credential ID"),
			).toBeInTheDocument();
		});
		// The credential id must never reach a log line.
		for (const call of consoleError.mock.calls) {
			expect(JSON.stringify(call)).not.toContain(PASSKEY.credential_id);
		}
		consoleError.mockRestore();
	});

	it("deletes through VaultInstance.deleteEntry after confirmation", async () => {
		const user = userEvent.setup();
		const onDeleted = vi.fn();
		renderSection(PASSKEY, onDeleted);

		// Nothing is deleted before the confirm step.
		await user.click(
			screen.getByRole("button", {
				name: i18n.t("home:passkey.details.delete"),
			}),
		);
		expect(mockDeleteEntry).not.toHaveBeenCalled();

		// Confirmation dialog names the passkey.
		expect(
			screen.getByText(/Delete the passkey for “GitHub”/),
		).toBeInTheDocument();

		await user.click(
			within(confirmDialog()).getByRole("button", {
				name: i18n.t("home:passkey.details.deleteConfirmAction"),
				hidden: true,
			}),
		);

		await pollUntil(() => {
			expect(mockDeleteEntry).toHaveBeenCalledWith([PASSKEY.id]);
			expect(onDeleted).toHaveBeenCalled();
		});
	});

	it("keeps the entry when the delete fails and surfaces the error", async () => {
		const user = userEvent.setup();
		const onDeleted = vi.fn();
		mockDeleteEntry.mockRejectedValue(new Error("passkey_delete failed"));

		renderSection(PASSKEY, onDeleted);

		await user.click(
			screen.getByRole("button", {
				name: i18n.t("home:passkey.details.delete"),
			}),
		);
		await user.click(
			within(confirmDialog()).getByRole("button", {
				name: i18n.t("home:passkey.details.deleteConfirmAction"),
				hidden: true,
			}),
		);

		await pollUntil(() => {
			expect(screen.getByText("passkey_delete failed")).toBeInTheDocument();
		});
		expect(onDeleted).not.toHaveBeenCalled();
	});

	it("cancelling the confirmation does not delete", async () => {
		const user = userEvent.setup();
		renderSection();

		await user.click(
			screen.getByRole("button", {
				name: i18n.t("home:passkey.details.delete"),
			}),
		);
		await user.click(
			within(confirmDialog()).getByRole("button", {
				name: i18n.t("home:passkey.details.deleteCancel"),
				hidden: true,
			}),
		);

		expect(mockDeleteEntry).not.toHaveBeenCalled();
	});
});
