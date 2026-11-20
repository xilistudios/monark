/**
 * Component tests for `VaultTree` with passkey leaves (T13).
 *
 * The tree's `handleNavigate` used to open the details modal only for data
 * entries (`else if (isDataEntry(entry))`), so clicking a passkey leaf did
 * nothing — the exact gap this task closes. These tests pin:
 *
 * 1. clicking a passkey leaf calls `openEntryDetails` with the passkey;
 * 2. clicking a data entry still does (regression);
 * 3. a passkey leaf renders the key icon;
 * 4. the dropdown Edit action routes a passkey to `openEditEntry`;
 * 5. a group still navigates instead of opening details.
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
	GroupEntry,
	PasskeyEntry,
} from "../../../interfaces/vault.interface";
import vaultReducer from "../../../redux/actions/vault";

vi.mock("../../../services/vault", () => ({
	VaultManager: {
		getInstance: () => ({ initialize: vi.fn(), getInstance: vi.fn() }),
	},
}));

import { VaultModalContext } from "../../../components/Vault/VaultContext";
import VaultTree from "../../../components/Vault/VaultTree";

const PASSKEY: PasskeyEntry = {
	id: "11111111-1111-1111-1111-111111111111",
	entry_type: "passkey",
	name: "GitHub",
	created_at: "2026-01-02T03:04:05Z",
	updated_at: "2026-01-02T03:04:05Z",
	tags: [],
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
	fields: [],
	tags: [],
};

const GROUP: GroupEntry = {
	id: "33333333-3333-3333-3333-333333333333",
	entry_type: "group",
	name: "Work",
	data_type: "",
	children: [],
};

function renderTree(entries: Entry[]) {
	const openEntryDetails = vi.fn();
	const openEditEntry = vi.fn();
	const openEditGroup = vi.fn();
	const onNavigate = vi.fn();

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
		openEntryDetails,
		openEditEntry,
		openEditGroup,
	} as unknown as React.ContextType<typeof VaultModalContext>;

	render(
		<Provider store={store}>
			<I18nextProvider i18n={i18n}>
				<VaultModalContext.Provider value={contextValue}>
					<VaultTree
						vaultId="vault-1"
						entries={entries}
						basePath={[]}
						onNavigate={onNavigate}
					/>
				</VaultModalContext.Provider>
			</I18nextProvider>
		</Provider>,
	);

	return { openEntryDetails, openEditEntry, openEditGroup, onNavigate };
}

describe("VaultTree (passkey leaves)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("opens the details view when a passkey leaf is clicked", async () => {
		const user = userEvent.setup();
		const { openEntryDetails } = renderTree([PASSKEY]);

		await user.click(screen.getByText("GitHub"));

		expect(openEntryDetails).toHaveBeenCalledWith(PASSKEY);
	});

	it("still opens the details view for a data entry (regression)", async () => {
		const user = userEvent.setup();
		const { openEntryDetails } = renderTree([DATA_ENTRY]);

		await user.click(screen.getByText("Mail"));

		expect(openEntryDetails).toHaveBeenCalledWith(DATA_ENTRY);
	});

	it("renders a key icon for a passkey leaf", () => {
		renderTree([PASSKEY]);
		expect(screen.getByTestId("passkey-tree-icon")).toBeInTheDocument();
	});

	it("routes the dropdown Edit action of a passkey to openEditEntry", async () => {
		const user = userEvent.setup();
		const { openEditEntry, openEditGroup } = renderTree([PASSKEY]);

		// The dropdown trigger is the last button in the row.
		const buttons = screen.getAllByRole("button");
		await user.click(buttons[buttons.length - 1]);
		await user.click(screen.getByText(i18n.t("home:vault.tree.edit")));

		expect(openEditEntry).toHaveBeenCalledWith(PASSKEY);
		expect(openEditGroup).not.toHaveBeenCalled();
	});

	it("navigates into a group instead of opening details", async () => {
		const user = userEvent.setup();
		const { onNavigate, openEntryDetails } = renderTree([GROUP]);

		await user.click(screen.getByText("Work"));

		expect(onNavigate).toHaveBeenCalledWith("vault-1", [GROUP.id]);
		expect(openEntryDetails).not.toHaveBeenCalled();
	});
});
