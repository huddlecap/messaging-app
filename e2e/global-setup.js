const {
  cleanupE2eUsers,
  poolHost,
  TEST_HOST,
  DEV_HOST,
} = require('./helpers/cleanup')

// Runs before any spec. Removes rows left behind by a previous crashed run so
// repeated runs never collide.
//
// The pool is deliberately NOT closed here: globalSetup and globalTeardown share
// this module instance, so ending it in setup breaks teardown. Playwright tears
// the process down after teardown finishes.
module.exports = async () => {
  console.log(
    `[e2e] globalSetup: test host ${TEST_HOST} (dev host ${DEV_HOST}) — pool will use ${poolHost()}`,
  )

  const { deleted } = await cleanupE2eUsers()
  console.log(
    `[e2e] globalSetup: removed ${deleted.users} users, ${deleted.sessions} sessions, ${deleted.messages} messages`,
  )
}