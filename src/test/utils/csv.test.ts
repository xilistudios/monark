// Unit tests for csv utilities

import { describe, expect, it } from "vitest";
import { parseCSV, parseCSVLine } from "../../utils/csv";

// Tests for parseCSVLine
describe("parseCSVLine", () => {
	it("parses simple comma-separated values", () => {
		expect(parseCSVLine("a,b,c")).toEqual(["a", "b", "c"]);
	});

	it("handles quoted values with commas", () => {
		expect(parseCSVLine('"a,b",c')).toEqual(["a,b", "c"]);
	});

	it("handles escaped quotes", () => {
		expect(parseCSVLine('"a""b",c')).toEqual(['a"b', "c"]);
	});

	it("trims whitespace around values", () => {
		expect(parseCSVLine(" a , b , c ")).toEqual(["a", "b", "c"]);
	});
});

// Tests for parseCSV
describe("parseCSV", () => {
	it("parses CSV text into objects", () => {
		const csv = "name,age\nAlice,30\nBob,25";
		expect(parseCSV(csv)).toEqual([
			{ name: "Alice", age: "30" },
			{ name: "Bob", age: "25" },
		]);
	});

	it("returns empty array for input with less than 2 lines", () => {
		expect(parseCSV("header1,header2")).toEqual([]);
	});

	it("handles quoted multiline fields", () => {
		const csv = 'name,desc\n"John","Line1\nLine2"\n"Jane","Hello"';
		expect(parseCSV(csv)).toEqual([
			{ name: "John", desc: "Line1\nLine2" },
			{ name: "Jane", desc: "Hello" },
		]);
	});
});
