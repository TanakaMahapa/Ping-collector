import type { Adapter } from '../models/types.js';
import { greenhouse } from './greenhouse.js';
import { lever } from './lever.js';
import { ashby } from './ashby.js';
import { workable } from './workable.js';
import { adzuna } from './adzuna.js';
import { jooble } from './jooble.js';
import { jsearch, techmap } from './rapidapi.js';
import { remotive } from './remotive.js';
import { arbeitnow } from './arbeitnow.js';
import { jobicy } from './jobicy.js';
import { remoteok } from './remoteok.js';
// Add new adapters here. Sources that need a key stay switched off until their env variable is set.
export const adapters: Adapter[] = [greenhouse, lever, ashby, workable, adzuna, jooble, jsearch, techmap, remotive, arbeitnow, jobicy, remoteok];
