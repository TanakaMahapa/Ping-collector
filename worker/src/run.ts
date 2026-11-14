// Entry point for GitHub Actions / local runs: `node dist/run.js`. (Azure uses src/functions/poll.ts instead.)
import { runPoll } from './controllers/pollController.js';
import { logFatal } from './views/console.js';
runPoll().then(() => process.exit(0)).catch(e => { logFatal(e); process.exit(1); });
