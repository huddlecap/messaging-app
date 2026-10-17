const { test, expect } = require('@playwright/test')
const { createUniqueUser } = require('../helpers/users')

// API only. This spec deliberately does not touch the database — the user it
// creates is removed by global-teardown, which owns all DB access.
test('registers a uniquely generated e2e user via the API', async ({ request }) => {
  const { username, password } = createUniqueUser()

  const response = await request.post('/api/auth/register', {
    data: { username, password },
  })

  expect(response.status()).toBe(201)

  const body = await response.json()
  expect(body.username).toBe(username)
  expect(body).toHaveProperty('id')

  // Username only — never the password.
  console.log(`[e2e] created user ${username}`)
})