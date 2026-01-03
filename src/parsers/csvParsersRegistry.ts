import type { ICsvParser } from "../interfaces/csv.interface";
import { ButtercupParser } from "./ButtercupParser";

export const csvParsers: ICsvParser[] = [new ButtercupParser()];
