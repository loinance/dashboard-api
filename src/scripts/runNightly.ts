import { closeDb } from '../db/index.js'
import { runNightlyJobs } from '../jobs/nightly.js'

/** `npm run job:nightly` — for driving retention from cron instead of in-process. */
runNightlyJobs()
  .then(() => closeDb())
  .then(() => process.exit(0))
  .catch(async () => {
    await closeDb().catch(() => {})
    process.exit(1)
  })
