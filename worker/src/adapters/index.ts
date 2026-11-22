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
import { oracle } from './oracle.js';
import { smartrecruiters } from './smartrecruiters.js';
import { recruitee } from './recruitee.js';
import { jsonld } from './jsonld.js';
// Add new adapters here. Sources that need a key stay switched off until their env variable is set.
export const adapters: Adapter[] = [greenhouse, lever, ashby, workable, oracle, smartrecruiters, recruitee, jsonld, adzuna, jooble, jsearch, techmap, remotive, arbeitnow, jobicy, remoteok];
