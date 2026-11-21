/**
 * Component tests for the "Export passkeys" toolbar button (T18).
 *
 * The button is the only way into the CXF export flow, and it must only exist
 * when there is something to export:
 *
 * 1. a vault with at least one passkey (at the root **or nested in a group**)
 *    renders the button, and clicking it opens the export modal;
 * 2. a vault with no passkey does not render it;
 * 3. a vault with only data entries and groups does not render it. (This case
 *    passes under either helper — it is a visibility check, not the pin. What
 *    pins the `interfaces/vault.interface.ts` helper is test 1: a passkey
 *    nested inside a group must still be found, which the `utils/vaultSearch.ts`
 *    variant would miss, and the type system, which rejects its
 *    `{entry, path}[]` return shape.)
 *
 * Mocks are registered before the module under test is imported (vitest hoists
 * `vi.mock` above the imports).
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type {
	DataEntry,
	Entry,
	GroupEntry,
	PasskeyEntry,
} from "../../../interfaces/vault.interface";

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

import { VaultModalContext } from "../../../components/Vault/VaultContext";
import VaultToolbar from "../../../components/Vault/VaultToolbar";

const PASSKEY: PasskeyEntry = {
	id: "11111111-1111-1111-1111-111111111111",
	entry_type: "passkey",
	name: "GitHub",
	created_at: "2026-01-02T03:04:05Z",
	updated_at: "2026-01-03T04:05:06Z",
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

const GROUP_WITH_PASSKEY: GroupEntry = {
	id: "33333333-3333-3333-3333-333333333333",
	entry_type: "group",
	name: "Work",
	data_type: "group",
	children: [PASSKEY],
};

/** `t` is a prop here (not the i18n hook): the toolbar takes the raw key back. */
const t = (key: string) => key;

function renderToolbar(entries: Entry[]) {
	const openPasskeyExport = vi.fn();
	const contextValue = {
		openAddEntryModal: vi.fn(),
		openAddGroupModal: vi.fn(),
		openImportCsvModal: vi.fn(),
		openPasskeyExport,
	} as unknown as React.ContextType<typeof VaultModalContext>;

	const utils = render(
		<VaultModalContext.Provider value={contextValue}>
			<VaultToolbar
				currentVault={{
					id: "vault-1",
					volatile: { navigationPath: "/", entries },
				}}
				currentPath={[]}
				handleLockVault={vi.fn()}
				t={t}
				onSearchToggle={vi.fn()}
				onOpenSettings={vi.fn()}
			/>
		</VaultModalContext.Provider>,
	);

	return { ...utils, openPasskeyExport };
}

const exportButton = () =>
	screen.queryByRole("button", { name: "vault.manager.exportPasskeys" });

describe("VaultToolbar export-passkeys button (T18)", () => {
	it("is rendered when the vault holds a passkey", () => {
		renderToolbar([DATA_ENTRY, PASSKEY]);

		expect(exportButton()).not.toBeNull();
	});

	it("is rendered when the only passkey is nested inside a group", () => {
		renderToolbar([DATA_ENTRY, GROUP_WITH_PASSKEY]);

		expect(exportButton()).not.toBeNull();
	});

	it("is not rendered when the vault has no passkey", () => {
		renderToolbar([DATA_ENTRY]);

		expect(exportButton()).toBeNull();
	});

	it("is not rendered for an empty vault", () => {
		renderToolbar([]);

		expect(exportButton()).toBeNull();
	});

	it("opens the export modal on click", async () => {
		const user = userEvent.setup();
		const { openPasskeyExport } = renderToolbar([PASSKEY]);

		const button = exportButton();
		if (!button) throw new Error("export button is not rendered");
		await user.click(button);

		expect(openPasskeyExport).toHaveBeenCalledTimes(1);
	});

	it("keeps the import-CSV button next to it", () => {
		renderToolbar([PASSKEY]);

		expect(
			screen.getByRole("button", { name: "vault.manager.importCsv" }),
		).toBeInTheDocument();
	});
});
