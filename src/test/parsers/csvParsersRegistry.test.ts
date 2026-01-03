// test/parsers/csvParsersRegistry.test.ts
import { describe, expect, it } from "vitest";
import { csvParsers } from "../../parsers/csvParsersRegistry";
import { parseCSV } from "../../utils/csv";

describe("CSV Parsers Registry", () => {
	it("registers exactly one parser (Buttercup)", () => {
		expect(csvParsers).toHaveLength(1);
		expect(csvParsers[0].getName()).toBe("Buttercup");
	});

	it("correctly detects Buttercup format", () => {
		const buttercupCSV = `!type,title,username,password
entry,Example Site,user123,secret123`;
		const rows = parseCSV(buttercupCSV);
		expect(csvParsers[0].detect(rows)).toBe(true);
	});

	it("returns no parser for invalid format", () => {
		const invalidCSV = `column1,column2
value1,value2`;
		const rows = parseCSV(invalidCSV);
		const selectedParser = csvParsers.find((parser) => parser.detect(rows));
		expect(selectedParser).toBeUndefined();
	});
});
