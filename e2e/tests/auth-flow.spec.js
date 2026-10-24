const { test, expect } = require('@playwright/test')
const { createUniqueUser } = require('../helpers/users')
const { registerAndLogin, logoutViaRoute } = require('../helpers/ui')

// One-user flow: register -> login -> assert signed in -> logout via the route
// -> assert the auth screen returns and the session is genuinely gone.
//
// Cleanup of the generated user is handled by global-teardown.
test('registers, logs in, and logs out via the logout route', async ({ page, request }) => {
  // UserPicker only renders its heading when another account exists, so seed
  // one via the API first. Same e2e_ prefix, so the global cleanup removes it.
  // Register creates no session, so it cannot affect the flow below.
  const other = createUniqueUser()
  const seeded = await request.post('/api/auth/register', { data: other })
  expect(seeded.status()).toBe(201)

  const user = createUniqueUser()

  await registerAndLogin(page, user)

  // Signed-in shell is up: heading plus the user picker fetching its list.
  await expect(page.getByRole('heading', { name: `Signed in as ${user.username}` })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'Who do you want to chat with?' }),
  ).toBeVisible()

  // The session cookie really works. Note: the `request` fixture is a separate
  // cookie jar from the browser context, so it would see an anonymous session.
  // Use the page's own context to assert against the real session cookie.
  const me = await page.context().request.get('/api/auth/me')
  expect(me.status()).toBe(200)
  expect((await me.json()).user.username).toBe(user.username)

  const logoutResponse = await logoutViaRoute(page)
  expect(logoutResponse.status()).toBe(200)

  // Auth screen is back...
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible()
  await expect(page.getByRole('heading', { name: `Signed in as ${user.username}` })).toHaveCount(0)

  // ...and the server agrees the session no longer exists.
  const afterLogout = await page.context().request.get('/api/auth/me')
  expect(afterLogout.status()).toBe(401)
})