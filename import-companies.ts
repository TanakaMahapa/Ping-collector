// Local/CI usage: node dist/scripts/import-companies.js ../data/companies.csv
import { readFileSync } from 'node:fs';
import { importCompanies } from '../controllers/importController.js';
const r = await importCompanies(readFileSync(process.argv[2] ?? '../data/companies.csv', 'utf8'));
process.exit(r.fatal || r.dbErrors ? 1 : 0);
