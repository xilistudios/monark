/**
 * Component tests for `EntryDetailsModal` with a passkey selected (T13).
 *
 * The modal used to classify entries with a local
 * `(entry as DataEntry).fields !== undefined` heuristic, which sent a passkey
 * down the generic data-entry path (data type input, timestamps, tags, fields
 * block). These tests pin the corrected behaviour:
 *
 * 1. a passkey renders `PasskeyDetailsSection` (rp / user / credential id) and
 *    **no** input for credential material;
 * 2. the generic data-entry view is not rendered for a passkey (no data-type
 *    input, no fields block);
 * 3. the Edit button routes a passkey to `openEditEntry` (the restricted form);
 * 4. a data entry still renders the generic view unchanged (regression).
 *
 * The modal is driven through a real `VaultModalContext` provider so the
 * routing assertions observe the actual context actions.
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

const { mockDeleteEntry, mockGetInstance } = vi.hoisted(() => {
	const deleteEntry = vi.fn();
	return {
		mockDeleteEntry: deleteEntry,
		mockGetInstance: vi.fn(() => ({ deleteEntry })),
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

vi.mock("../../../utils/clipboard", () => ({
	copySensitive: vi.fn().mockResolvedValue(undefined),
}));

import { EntryDetailsModal } from "../../../components/Vault/Modals/EntryDetailsModal";
import { VaultModalContext } from "../../../components/Vault/VaultContext";

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
		{
			title: "Password",
			property: "password",
			value: "hunter2",
			secret: true,
		},
	],
	tags: ["personal"],
};

function renderModal(entry: Entry) {
	const openEditEntry = vi.fn();
	const openEditGroup = vi.fn();
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
		isDetailsModalOpen: true,
		selectedEntry: entry,
		closeAllModals,
		openEditEntry,
		openEditGroup,
	} as unknown as React.ContextType<typeof VaultModalContext>;

	const utils = render(
		<Provider store={store}>
			<I18nextProvider i18n={i18n}>
				<VaultModalContext.Provider value={contextValue}>
					<EntryDetailsModal />
				</VaultModalContext.Provider>
			</I18nextProvider>
		</Provider>,
	);

	return { ...utils, openEditEntry, openEditGroup, closeAllModals };
}

describe("EntryDetailsModal (passkey)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockDeleteEntry.mockResolvedValue(undefined);
	});

	it("renders the passkey detail section", () => {
		renderModal(PASSKEY);

		expect(screen.getByText("github.com")).toBeInTheDocument();
		expect(screen.getByText("octocat")).toBeInTheDocument();
		expect(screen.getByText("3q2-7wABC")).toBeInTheDocument();
		expect(screen.getByText("PASSKEY")).toBeInTheDocument();
	});

	it("renders no input for credential material and no generic fields block", () => {
		const { container } = renderModal(PASSKEY);

		// A passkey has no `data_type` and no editable fields: the generic
		// data-entry view must not render at all.
		expect(container.querySelectorAll("input")).toHaveLength(0);
		expect(container.querySelectorAll("textarea")).toHaveLength(0);
		expect(screen.queryByText(i18n.t("home:vault.entry.fields"))).toBeNull();
		expect(screen.queryByText(i18n.t("home:vault.entry.dataType"))).toBeNull();
	});

	it("routes the Edit button to openEditEntry (restricted form)", async () => {
		const user = userEvent.setup();
		const { openEditEntry, openEditGroup } = renderModal(PASSKEY);

		// The modal renders inside `<dialog>`, which jsdom does not expose in the
		// accessible tree: query the button with `hidden: true`.
		await user.click(
			screen.getByRole("button", { name: i18n.t("home:edit"), hidden: true }),
		);

		expect(openEditEntry).toHaveBeenCalledWith(PASSKEY);
		expect(openEditGroup).not.toHaveBeenCalled();
	});

	it("still renders the generic data-entry view for a data entry (regression)", () => {
		const { container } = renderModal(DATA_ENTRY);

		// The generic view is intact: data type + timestamps + fields block.
		expect(
			screen.getByText(i18n.t("home:vault.entry.dataType")),
		).toBeInTheDocument();
		expect(
			screen.getByText(i18n.t("home:vault.entry.fields")),
		).toBeInTheDocument();
		expect(screen.getByText("Password")).toBeInTheDocument();
		// The secret value is masked until revealed.
		const inputs = container.querySelectorAll("input");
		expect(Array.from(inputs).some((input) => input.value === "********")).toBe(
			true,
		);
		// No passkey section leaked into a data entry.
		expect(screen.queryByText("PASSKEY")).toBeNull();
	});

	it("routes a data entry Edit to openEditEntry with the data entry", async () => {
		const user = userEvent.setup();
		const { openEditEntry } = renderModal(DATA_ENTRY);

		// The modal renders inside `<dialog>`, which jsdom does not expose in the
		// accessible tree: query the button with `hidden: true`.
		await user.click(
			screen.getByRole("button", { name: i18n.t("home:edit"), hidden: true }),
		);

		expect(openEditEntry).toHaveBeenCalledWith(DATA_ENTRY);
	});
});
