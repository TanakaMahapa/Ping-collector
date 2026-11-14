import type { Adapter } from '../models/types.js';
import { greenhouse } from './greenhouse.js';
import { lever } from './lever.js';
import { adzuna } from './adzuna.js';
import { remotive } from './remotive.js';
import { arbeitnow } from './arbeitnow.js';
// Add new adapters here. Optional JSearch would be registered behind process.env.ENABLE_JSEARCH.
export const adapters: Adapter[] = [greenhouse, lever, adzuna, remotive, arbeitnow];
