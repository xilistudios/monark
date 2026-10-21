/**
 * Cross-language failure-contract consumer (issue #28, T13).
 *
 * Every pinned `case` of the shared fixture (`fixtures/auth-failure-contract.json`,
 * rendered by the Rust `AuthFailureClass` templates — see
 * `src-tauri/src/commands/errors.rs`' `include_str!` consumer) is pushed through
 * the frontend's two entry points:
 *
 * 1. `classifyCloudFailure` (raw backend message) must derive the fixture's
 *    `frontend.failureClass`; and
 * 2. the REAL wrapper path (`mocked invoke` → `CloudStorageCommands.handleError`,
 *    same route as `wrappedRefreshError` in `AddVaultForm.test.tsx`) must derive
 *    the fixture's `frontend.errorType` from the wrapped `CloudStorageError`
 *    and the same `failureClass` from the wrapper object.
 *
 * The fixture JSON is loaded through `src/test/helpers/authFailureContract.ts`,
 * which validates its schema at module load (`validateContract`); the message
 * bytes are never re-typed here. If either side of the contract drifts (Rust
 * template wording, context strings, or the frontend ladder), the row that pins
 * the drifted case fails.
 */

import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CloudStorageCommands } from "../../services/cloudStorage";
import { classifyCloudFailure } from "../../services/cloudStorageErrors";
import {
	type ContractCase,
	contractCases,
} from "../helpers/authFailureContract";

// Mock the Tauri invoke function (same pattern as cloudStorage.test.ts /
// AddVaultForm.test.tsx): a rejection with `new Error(case.message)` is wrapped
// by the REAL `CloudStorageCommands.handleError`.
vi.mock("@tauri-apps/api/core", () => ({
	invoke: vi.fn(),
}));

const mockInvoke = vi.mocked(invoke);

/**
 * Pushes the case's exact rendered message through the REAL wrapper path
 * (`refreshProviderAuth` + a mocked `invoke` rejecting with a raw
 * `Error(message)`, like the backend IPC handler would) and returns the
 * `CloudStorageError` the wrapper throws.
 */
const wrapThroughRealWrapper = async (
	message: string,
): Promise<{ type?: unknown; message?: unknown }> => {
	mockInvoke.mockRejectedValueOnce(new Error(message));
	try {
		await CloudStorageCommands.refreshProviderAuth("google-drive");
	} catch (error) {
		return error as { type?: unknown; message?: unknown };
	}
	throw new Error("refreshProviderAuth was expected to reject");
};

const CASES: readonly ContractCase[] = contractCases();

describe("auth failure contract (fixture consumer)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe.each(
		CASES.map((contractCase) => [contractCase.id, contractCase] as const),
	)("case %s", (_id, contractCase) => {
		it("classifyCloudFailure derives the fixture failureClass from the raw message", () => {
			expect(classifyCloudFailure(contractCase.message)).toBe(
				contractCase.frontend.failureClass,
			);
		});

		it("the real wrapper derives the fixture errorType and failureClass", async () => {
			const wrapped = await wrapThroughRealWrapper(contractCase.message);

			expect(wrapped.message).toBe(contractCase.message);
			expect(wrapped.type).toBe(contractCase.frontend.errorType);
			expect(classifyCloudFailure(wrapped)).toBe(
				contractCase.frontend.failureClass,
			);
		});
	});
});
