const path = require('path')
const fs = require('fs')

const repoRoot = path.resolve(__dirname, '..', '..')
const backendDir = path.join(repoRoot, 'backend')
const BACKEND_ENV = path.join(backendDir, '.env')
const BACKEND_ENV_TEST = path.join(backendDir, '.env.test')

// backend/src/db/db.js runs dotenv.config() at module load and only ONCE per
// process. Which file it loads depends on NODE_ENV at that moment:
//   NODE_ENV === 'test' -> .env.test   (test DB)
//   anything else       -> .env        (DEV DB)
//
// Playwright can invoke this file via `npm test` (cross-env sets NODE_ENV) or
// bare `npx playwright test` (NODE_ENV unset). Under the latter, db.js would
// silently load the DEV database. Force NODE_ENV before the require so the
// branch is always deterministic.
process.env.NODE_ENV = 'test'

// db.js also resolves ".env.test" against process.cwd(), and Playwright runs
// from e2e/, so the require must happen with cwd set to backend/.
const previousCwd = process.cwd()
process.chdir(backendDir)
const pool = require(path.join(backendDir, 'src', 'db', 'db.js'))
process.chdir(previousCwd)

// `_` is a LIKE wildcard, so the prefix is escaped to match a literal
// underscore. Without this, `e2e_%` would also match `eXeA_...`.
const PREFIX_PATTERN = 'e2e\\_%'

function parseEnvFile(file) {
  const out = {}
  for (const rawLine of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}

function hostOf(connectionString) {
  if (typeof connectionString !== 'string' || !connectionString) return null
  try {
    return new URL(connectionString).hostname
  } catch {
    return null
  }
}

function envHost(file) {
  if (!fs.existsSync(file)) return null
  return hostOf(parseEnvFile(file).DATABASE_URL)
}

const TEST_HOST = envHost(BACKEND_ENV_TEST)
const DEV_HOST = envHost(BACKEND_ENV)

/**
 * Safety gate. Deliberately does NOT trust NODE_ENV — that variable is what
 * caused the original bug, and it is settable by anything. Instead it compares
 * the host the pool will ACTUALLY use against both env files on disk.
 *
 * Refuses unless:
 *   1. .env.test exists and parses to a host
 *   2. the pool's host equals the .env.test host
 *   3. the pool's host differs from the .env (dev) host
 *   4. .env and .env.test are not accidentally the same host
 *
 * Checks 3 and 4 are skipped when CI === "true": a CI runner has no dev
 * database, and may inject the same DATABASE_URL into both files, which would
 * otherwise refuse a run that is provably pointing at the test host. Check 2
 * still applies in every case.
 *
 * Only hostnames appear in thrown messages — never a full connection string.
 */
function assertSafeToClean() {
  const poolHost = hostOf(pool.options && pool.options.connectionString)
  const isCi = process.env.CI === 'true'

  if (!TEST_HOST) {
    throw new Error(
      `Refusing to clean: could not read a host from ${BACKEND_ENV_TEST}`,
    )
  }

  if (!poolHost) {
    throw new Error('Refusing to clean: pool has no usable connection string')
  }

  if (poolHost !== TEST_HOST) {
    throw new Error(
      `Refusing to clean: pool host "${poolHost}" is not the test host "${TEST_HOST}"`,
    )
  }

  if (!isCi && DEV_HOST && poolHost === DEV_HOST) {
    throw new Error(
      `Refusing to clean: pool host "${poolHost}" is the DEV database`,
    )
  }

  if (!isCi && DEV_HOST && TEST_HOST === DEV_HOST) {
    throw new Error(
      'Refusing to clean: .env.test and .env point at the same host',
    )
  }

  return { poolHost, testHost: TEST_HOST, devHost: DEV_HOST }
}

/**
 * Deletes e2e users and their data in FK-safe order: messages, then sessions,
 * then users. Scoped strictly to the `e2e_` prefix.
 */
async function cleanupE2eUsers() {
  assertSafeToClean()

  const users = await pool.query('SELECT id FROM users WHERE username LIKE $1', [
    PREFIX_PATTERN,
  ])
  const ids = users.rows.map((r) => r.id)

  if (ids.length === 0) {
    return { deleted: { messages: 0, sessions: 0, users: 0 } }
  }

  const messages = await pool.query(
    'DELETE FROM messages WHERE sender_id = ANY($1::int[]) OR receiver_id = ANY($1::int[])',
    [ids],
  )
  const sessions = await pool.query(
    'DELETE FROM sessions WHERE user_id = ANY($1::int[])',
    [ids],
  )
  const removed = await pool.query(
    'DELETE FROM users WHERE id = ANY($1::int[])',
    [ids],
  )

  return {
    deleted: {
      messages: messages.rowCount,
      sessions: sessions.rowCount,
      users: removed.rowCount,
    },
  }
}

/** Read-only count of e2e_ users in the test DB. Used for verification. */
async function countE2eUsers() {
  assertSafeToClean()
  const result = await pool.query(
    'SELECT count(*)::int AS n FROM users WHERE username LIKE $1',
    [PREFIX_PATTERN],
  )
  return result.rows[0].n
}

/** Hostname the pool actually uses. For logging. Never a full URL. */
function poolHost() {
  return hostOf(pool.options && pool.options.connectionString)
}

function closePool() {
  return pool.end()
}

module.exports = {
  cleanupE2eUsers,
  countE2eUsers,
  assertSafeToClean,
  poolHost,
  hostOf,
  envHost,
  parseEnvFile,
  closePool,
  BACKEND_ENV,
  BACKEND_ENV_TEST,
  TEST_HOST,
  DEV_HOST,
  PREFIX_PATTERN,
}