const crypto = require('crypto')

// Username must fit validateRegister: 3-50 chars. Password 8-72.
const PREFIX = 'e2e_'

/**
 * Returns a unique user for an e2e test run.
 * `e2e_` prefix so global-teardown can target exactly these rows and nothing
 * that Jest created (Jest uses its own `test_*` prefix).
 */
function createUniqueUser() {
  const stamp = Date.now().toString(36)
  const suffix = crypto.randomBytes(4).toString('hex')
  const username = `${PREFIX}${stamp}_${suffix}`

  if (username.length > 50) {
    throw new Error(`Generated username exceeds 50 chars: ${username.length}`)
  }

  // Fixed-but-unique password: 8-72 bytes, ASCII only.
  const password = `Pw_${suffix}_${stamp}`

  if (password.length < 8 || password.length > 72) {
    throw new Error(`Generated password out of range: ${password.length}`)
  }

  return { username, password }
}

module.exports = { createUniqueUser, PREFIX }