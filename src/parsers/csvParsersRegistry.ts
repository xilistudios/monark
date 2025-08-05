import { ButtercupParser } from './ButtercupParser';
import type { ICsvParser } from '../interfaces/csv.interface';

export const csvParsers: ICsvParser[] = [new ButtercupParser()];
