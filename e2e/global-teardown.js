const {
  cleanupE2eUsers,
  countE2eUsers,
  poolHost,
  TEST_HOST,
  DEV_HOST,
} = require('./helpers/cleanup')

// Runs after the last spec. Aborts without deleting anything unless the safety
// gate in cleanup.js passes: the pool's actual host must equal the .env.test
// host and must differ from the .env (dev) host.
module.exports = async () => {
  console.log(
    `[e2e] globalTeardown: test host ${TEST_HOST} (dev host ${DEV_HOST}) — pool uses ${poolHost()}`,
  )

  const before = await countE2eUsers()
  const { deleted } = await cleanupE2eUsers()
  const after = await countE2eUsers()

  console.log(`[e2e] globalTeardown: test DB e2e_ rows BEFORE=${before} AFTER=${after}`)
  console.log(
    `[e2e] globalTeardown: removed ${deleted.users} users, ${deleted.sessions} sessions, ${deleted.messages} messages`,
  )
}