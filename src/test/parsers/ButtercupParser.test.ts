// Unit tests for ButtercupParser's hierarchy logic

import type { ParsedEntry } from "../../interfaces/parsers.interface";
import { ButtercupParser } from "../../parsers/ButtercupParser";

describe("ButtercupParser hierarchy", () => {
	const parser = new ButtercupParser();

	it("builds and flattens a simple group/entry hierarchy", () => {
		const entries: ParsedEntry[] = [
			{
				type: "group",
				name: "Root Group",
				groupId: "g1",
				groupParent: undefined,
				fields: [],
				id: "g1",
			},
			{
				type: "entry",
				name: "Entry 1",
				groupId: "g1",
				groupParent: undefined,
				fields: [
					{ title: "User", property: "user", value: "alice", secret: false },
				],
				id: "e1",
			},
			{
				type: "group",
				name: "Child Group",
				groupId: "g2",
				groupParent: "g1",
				fields: [],
				id: "g2",
			},
			{
				type: "entry",
				name: "Entry 2",
				groupId: "g2",
				groupParent: undefined,
				fields: [
					{ title: "Pass", property: "pass", value: "secret", secret: true },
				],
				id: "e2",
			},
		];

		const path: string[] = [];
		const { groups, entries: flatEntries } = parser.processHierarchy(
			entries,
			path,
		);

		// There should be 2 groups and 2 entries in the flattened output
		expect(groups.length).toBe(2);
		expect(flatEntries.length).toBe(2);

		// Root group should have path []
		expect(groups.find((g) => g.entry.name === "Root Group")?.path).toEqual([]);

		// Child group should have path ['g1']
		expect(groups.find((g) => g.entry.name === "Child Group")?.path).toEqual([
			"g1",
		]);

		// Entry 1 should have path ['g1']
		expect(flatEntries.find((e) => e.entry.name === "Entry 1")?.path).toEqual([
			"g1",
		]);

		// Entry 2 should have path ['g1', 'g2']
		expect(flatEntries.find((e) => e.entry.name === "Entry 2")?.path).toEqual([
			"g1",
			"g2",
		]);
	});

	it("handles entries without groups as root entries", () => {
		const entries: ParsedEntry[] = [
			{
				type: "entry",
				name: "Orphan Entry",
				groupId: undefined,
				groupParent: undefined,
				fields: [],
				id: "e3",
			},
		];
		const { groups, entries: flatEntries } = parser.processHierarchy(
			entries,
			[],
		);
		expect(groups.length).toBe(0);
		expect(flatEntries.length).toBe(1);
		expect(flatEntries[0].path).toEqual([]);
		expect(flatEntries[0].entry.name).toBe("Orphan Entry");
	});
});
