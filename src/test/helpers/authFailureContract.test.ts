import { describe, expect, it } from "vitest";
import {
	CONTEXTS,
	renderContractMessage,
	TEMPLATES,
} from "./authFailureContract";

describe("renderContractMessage", () => {
	it("interpolates a cause containing String.replace pattern bytes verbatim", () => {
		// `$&`, `$'`, `` $` ``, `$1` and `$$` are `String.replace` replacement
		// patterns; a plain-string replacement would corrupt this cause (the
		// reason `renderContractMessage` uses replacement functions).
		const tricky = "cost: $& $' $` $1 $$ end";
		// Independent oracle: split/join performs no pattern substitution.
		const expected = TEMPLATES.Other.split("{context}")
			.join(CONTEXTS.codeExchange)
			.split("{cause}")
			.join(tricky);
		expect(renderContractMessage("Other", "codeExchange", tricky)).toBe(
			expected,
		);
		expect(expected).toContain(tricky);
	});
});
