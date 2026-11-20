/**
 * Component tests for the restricted passkey edit form (T13).
 *
 * Pinned here:
 *
 * 1. a passkey renders **exactly four** mutable inputs — name, user name,
 *    display name and the tag entry — and nothing else (no data type, no
 *    fields editor, no credential material);
 * 2. submitting calls `VaultInstance.updateEntryById(id, {name, tags,
 *    user_name, user_display_name})` and **does not** send `updated_at`
 *    (`updateEntry` stamps it for non-group entries);
 * 3. the payload is validated by `passkeyEditSchema` before it is dispatched
 *    (an empty name never reaches the service);
 * 4. a data entry still renders the original form (regression).
 */

import { configureStore } from "@reduxjs/toolkit";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { Provider } from "react-redux";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../../i18n";
import type {
	DataEntry,
	Entry,
	PasskeyEntry,
} from "../../../interfaces/vault.interface";
import vaultReducer from "../../../redux/actions/vault";

const { mockUpdateEntryById, mockGetInstance } = vi.hoisted(() => {
	const updateEntryById = vi.fn();
	return {
		mockUpdateEntryById: updateEntryById,
		mockGetInstance: vi.fn(() => ({ updateEntryById })),
	};
});

vi.mock("../../../services/vault", () => ({
	VaultManager: {
		getInstance: () => ({
			getInstance: mockGetInstance,
			initialize: vi.fn(),
		}),
	},
}));

import { EditEntryModal } from "../../../components/Vault/Modals/EditEntryModal";
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

const PASSKEY: PasskeyEntry = {
	id: "11111111-1111-1111-1111-111111111111",
	entry_type: "passkey",
	name: "GitHub",
	created_at: "2026-01-02T03:04:05Z",
	updated_at: "2026-01-03T04:05:06Z",
	tags: ["work"],
	rp_id: "github.com",
	rp_name: "GitHub",
	credential_id: "3q2-7wABC",
	user_handle: "AQIDBA",
	user_name: "octocat",
	user_display_name: "The Octocat",
	algorithm: -7,
	sign_count: 0,
	discoverable: true,
	transports: ["internal"],
	aaguid: "00000000-0000-0000-0000-000000000000",
};

const DATA_ENTRY: DataEntry = {
	id: "22222222-2222-2222-2222-222222222222",
	entry_type: "entry",
	name: "Mail",
	data_type: "login",
	created_at: "2026-01-02T03:04:05Z",
	updated_at: "2026-01-02T03:04:05Z",
	fields: [
		{ title: "Password", property: "password", value: "hunter2", secret: true },
	],
	tags: ["personal"],
};

function renderModal(entry: Entry) {
	const closeAllModals = vi.fn();
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

	const contextValue = {
		isEditEntryModalOpen: true,
		selectedEntry: entry,
		closeAllModals,
	} as unknown as React.ContextType<typeof VaultModalContext>;

	const utils = render(
		<Provider store={store}>
			<I18nextProvider i18n={i18n}>
				<VaultModalContext.Provider value={contextValue}>
					<EditEntryModal />
				</VaultModalContext.Provider>
			</I18nextProvider>
		</Provider>,
	);

	return { ...utils, closeAllModals };
}

/** The modal lives inside `<dialog>`, which jsdom keeps out of the a11y tree. */
const byRole = (name: string) =>
	screen.getByRole("button", { name, hidden: true });

describe("EditEntryModal (passkey)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockUpdateEntryById.mockResolvedValue(undefined);
	});

	it("shows exactly the four mutable fields", () => {
		const { container } = renderModal(PASSKEY);

		const labels = Array.from(container.querySelectorAll("label")).map(
			(label) => label.textContent?.trim(),
		);
		expect(labels).toEqual([
			`${i18n.t("home:passkey.edit.name")} *`,
			`${i18n.t("home:passkey.edit.userName")} *`,
			i18n.t("home:passkey.edit.userDisplayName"),
			i18n.t("home:passkey.edit.tags"),
		]);

		// Four inputs: name, user name, display name, tag entry.
		expect(container.querySelectorAll("input")).toHaveLength(4);
		// No fields editor, no data-type input, no credential material.
		expect(container.querySelectorAll("textarea")).toHaveLength(0);
		expect(container.querySelectorAll("select")).toHaveLength(0);
		expect(container.textContent).not.toContain(PASSKEY.credential_id);
		expect(container.textContent).not.toContain(PASSKEY.user_handle);
	});

	it("prefills the mutable fields from the entry", () => {
		renderModal(PASSKEY);

		expect(screen.getByLabelText(/Name/)).toHaveValue("GitHub");
		expect(screen.getByLabelText(/User name/)).toHaveValue("octocat");
		expect(screen.getByLabelText(/Display name/)).toHaveValue("The Octocat");
		expect(screen.getByText("work")).toBeInTheDocument();
	});

	it("submits via updateEntryById without sending updated_at", async () => {
		// `delay: null` keeps user-event's keystroke latency out of the 5 s
		// default test timeout (jsdom + bun is slow per keystroke).
		const user = userEvent.setup({ delay: null });
		const { closeAllModals } = renderModal(PASSKEY);

		const nameInput = screen.getByLabelText(/Name/);
		await user.clear(nameInput);
		await user.type(nameInput, "GitHub work");

		const userNameInput = screen.getByLabelText(/User name/);
		await user.clear(userNameInput);
		await user.type(userNameInput, "octocat-2");

		await user.click(byRole(i18n.t("home:passkey.edit.save")));

		await pollUntil(() => {
			expect(mockUpdateEntryById).toHaveBeenCalledTimes(1);
			expect(closeAllModals).toHaveBeenCalled();
		});

		const [entryId, updates] = mockUpdateEntryById.mock.calls[0];
		expect(entryId).toBe(PASSKEY.id);
		expect(updates).toEqual({
			name: "GitHub work",
			tags: ["work"],
			user_name: "octocat-2",
			user_display_name: "The Octocat",
		});
		// `updateEntry` stamps it; sending our own would be a second source of truth.
		expect(updates).not.toHaveProperty("updated_at");
		// The immutable core is never part of the update payload.
		expect(updates).not.toHaveProperty("rp_id");
		expect(updates).not.toHaveProperty("credential_id");
		expect(updates).not.toHaveProperty("user_handle");
		expect(updates).not.toHaveProperty("algorithm");
	});

	it("adds and removes tags", async () => {
		const user = userEvent.setup();
		renderModal(PASSKEY);

		const tagInput = screen.getByLabelText(i18n.t("home:passkey.edit.tags"));
		await user.type(tagInput, "new-tag");
		await user.click(byRole(i18n.t("home:passkey.edit.addTag")));
		expect(screen.getByText("new-tag")).toBeInTheDocument();

		await user.click(
			screen.getByRole("button", {
				name: i18n.t("home:passkey.edit.removeTag", { tag: "work" }),
				hidden: true,
			}),
		);
		expect(screen.queryByText("work")).toBeNull();

		await user.click(byRole(i18n.t("home:passkey.edit.save")));

		await pollUntil(() => {
			expect(mockUpdateEntryById).toHaveBeenCalledWith(
				PASSKEY.id,
				expect.objectContaining({ tags: ["new-tag"] }),
			);
		});
	});

	it("rejects an empty name via passkeyEditSchema (negative control)", async () => {
		const user = userEvent.setup();
		renderModal(PASSKEY);

		const nameInput = screen.getByLabelText(/Name/);
		await user.clear(nameInput);
		await user.click(byRole(i18n.t("home:passkey.edit.save")));

		await pollUntil(() => {
			expect(screen.getByText("Name is required")).toBeInTheDocument();
		});
		// The invalid payload never reaches the service.
		expect(mockUpdateEntryById).not.toHaveBeenCalled();
	});

	it("surfaces a save failure and keeps the modal open", async () => {
		const user = userEvent.setup();
		const { closeAllModals } = renderModal(PASSKEY);
		mockUpdateEntryById.mockRejectedValue(new Error("write failed"));

		await user.click(byRole(i18n.t("home:passkey.edit.save")));

		await pollUntil(() => {
			expect(screen.getByText("write failed")).toBeInTheDocument();
		});
		expect(closeAllModals).not.toHaveBeenCalled();
	});

	it("still renders the original data-entry form (regression)", () => {
		const { container } = renderModal(DATA_ENTRY);

		expect(
			screen.getByText(i18n.t("home:editEntry.title")),
		).toBeInTheDocument();
		expect(
			screen.getByLabelText(new RegExp(i18n.t("home:editEntry.dataType"))),
		).toBeInTheDocument();
		expect(
			screen.getByText(i18n.t("home:editEntry.fields")),
		).toBeInTheDocument();
		// The data-entry form has the fields editor (title/type/value inputs).
		expect(container.querySelectorAll("select").length).toBeGreaterThan(0);
		// No passkey form leaked in.
		expect(screen.queryByText(i18n.t("home:passkey.edit.title"))).toBeNull();
	});
});
