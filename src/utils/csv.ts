// General CSV parsing utilities

export function parseCSVLine(line: string): string[] {
	const result: string[] = [];
	let current = "";
	let inQuotes = false;
	let i = 0;

	while (i < line.length) {
		const char = line[i];

		if (char === '"') {
			if (inQuotes && line[i + 1] === '"') {
				current += '"';
				i += 2;
			} else {
				inQuotes = !inQuotes;
				i++;
			}
		} else if (char === "," && !inQuotes) {
			result.push(current.trim());
			current = "";
			i++;
		} else {
			current += char;
			i++;
		}
	}

	result.push(current.trim());
	return result;
}

export function parseCSV(text: string): Record<string, string>[] {
	const lines = text.split("\n");
	if (lines.length < 2) return [];

	const headers = parseCSVLine(lines[0]).map((h) => h.trim());
	const rows: Record<string, string>[] = [];

	let i = 1;
	while (i < lines.length) {
		let currentLine = lines[i];
		let lineIndex = i;

		let openQuotes = 0;
		for (let j = 0; j < currentLine.length; j++) {
			if (currentLine[j] === '"') {
				if (j + 1 < currentLine.length && currentLine[j + 1] === '"') {
					j++;
				} else {
					openQuotes = openQuotes === 0 ? 1 : 0;
				}
			}
		}

		while (openQuotes > 0 && lineIndex + 1 < lines.length) {
			lineIndex++;
			currentLine += "\n" + lines[lineIndex];

			const newLinePart = lines[lineIndex];
			for (let j = 0; j < newLinePart.length; j++) {
				if (newLinePart[j] === '"') {
					if (j + 1 < newLinePart.length && newLinePart[j + 1] === '"') {
						j++;
					} else {
						openQuotes = openQuotes === 0 ? 1 : 0;
					}
				}
			}
		}

		if (!currentLine.trim()) {
			i = lineIndex + 1;
			continue;
		}

		const values = parseCSVLine(currentLine);
		const row: Record<string, string> = {};

		headers.forEach((header, index) => {
			let value = values[index] || "";
			if (value.startsWith('"') && value.endsWith('"')) {
				value = value.slice(1, -1).replace(/""/g, '"');
			}
			row[header] = value;
		});

		rows.push(row);
		i = lineIndex + 1;
	}

	return rows;
}
