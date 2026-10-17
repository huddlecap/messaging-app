/**
 * Small UI helpers for e2e specs.
 *
 * Selectors are role/label/placeholder based. The app exposes no data-testid
 * attributes and we must not add any (frontend/ is read-only for these tests),
 * so these lean on the accessible names already present in the JSX.
 *
 * Register does NOT create a session (backend only sets session_id on login),
 * so registerAndLogin performs both calls through the UI.
 */

/** Switches the auth form from login mode to register mode. */
async function switchToRegister(page) {
  await page.getByRole('button', { name: 'Need an account? Register' }).click()
  await expectVisible(page.getByRole('heading', { name: 'Register' }))
}

/** Fills the auth form without submitting. */
async function fillCredentials(page, user) {
  await page.getByLabel('Username').fill(user.username)
  await page.getByLabel('Password').fill(user.password)
}

/** Submits the auth form (submit button is "Log in" or "Register"). */
async function submitAuthForm(page) {
  await page.locator('form button[type="submit"]').click()
}

/** Waits for an element to be visible without a fixed sleep. */
async function expectVisible(locator) {
  const { expect } = require('@playwright/test')
  await expect(locator).toBeVisible()
}

/**
 * Registers a brand new account through the UI, then logs in with the same
 * credentials. Returns once the signed-in shell is visible.
 */
async function registerAndLogin(page, user) {
  await page.goto('/')
  await expectVisible(page.getByRole('heading', { name: 'Log in' }))

  await switchToRegister(page)
  await fillCredentials(page, user)
  await submitAuthForm(page)

  // Register flips the form back to login mode with this notice.
  await expectVisible(page.getByText('Account created — log in'))
  await expectVisible(page.getByRole('heading', { name: 'Log in' }))

  // The username is prefilled; only the password needs re-entering.
  await page.getByLabel('Password').fill(user.password)
  await submitAuthForm(page)

  await expectVisible(page.getByRole('heading', { name: `Signed in as ${user.username}` }))

  // The signed-in shell renders before the WebSocket finishes opening, so
  // waiting only on the heading can let a send race the connect. The status line
  // (App.jsx) reads 'Connected' once the socket is open.
  await waitForSocketConnected(page)

  return user
}

/**
 * Waits until the signed-in view reports an open socket. Fails loudly with the
 * actual status text if the socket settles on anything else, so a connect
 * failure is distinguishable from a slow connect.
 */
async function waitForSocketConnected(page) {
  const { expect } = require('@playwright/test')

  // main.app renders several direct-child paragraphs (socket status, and the
  // logout error banner), and UserPicker/Conversation render their own
  // `.status` elements. Anchor on the one that actually carries a connection
  // state rather than on class alone.
  const status = page.locator('main.app > p.status', { hasText: /Connected|Connecting|Reconnecting|Disconnected|checking|Not connected/i })
  await expect(status).toHaveText('Connected', { timeout: 15_000 })
  return status
}

/**
 * Calls the logout route directly (POST /api/auth/logout) and then reloads so
 * the app re-runs its session check and renders the auth screen.
 *
 * Uses page.context().request rather than the `request` fixture: that fixture is
 * a separate cookie jar and would not carry the browser's session cookie.
 */
async function logoutViaRoute(page) {
  const response = await page.context().request.post('/api/auth/logout')
  await page.reload()
  await expectVisible(page.getByRole('heading', { name: 'Log in' }))
  return response
}

/**
 * Opens the conversation with another user by clicking their name in the user
 * picker. Waits on the conversation heading, which only renders once a user has
 * been selected.
 */
async function openConversation(page, otherUsername) {
  const { expect } = require('@playwright/test')

  await expect(page.getByRole('heading', { name: 'Who do you want to chat with?' })).toBeVisible()
  await page.getByRole('button', { name: otherUsername, exact: true }).click()
  await expect(page.getByRole('heading', { name: `Chat with ${otherUsername}` })).toBeVisible()
}

/**
 * Types and sends a message. The composer input has no label, so it is targeted
 * by its placeholder (Composer.jsx renders `Message <name>…` once a user is
 * selected).
 */
async function sendMessage(page, text) {
  const { expect } = require('@playwright/test')

  const input = page.getByPlaceholder(/^Message /)
  await expect(input).toBeEnabled()
  await input.fill(text)

  const send = page.getByRole('button', { name: 'Send' })
  await expect(send).toBeEnabled()
  await send.click()
}

/**
 * Asserts a message is visible in the conversation. Returns the locator so
 * callers can additionally assert an exact occurrence count.
 */
function messageLocator(page, text) {
  return page.locator('.messages .message', { hasText: text })
}

/** Waits for a message to appear. */
async function expectMessage(page, text) {
  const { expect } = require('@playwright/test')
  await expect(messageLocator(page, text)).toBeVisible()
}

/**
 * Asserts a message appears exactly once — guards against the dedup Set
 * regressing and a message rendering twice.
 */
async function expectMessageOnce(page, text) {
  const { expect } = require('@playwright/test')
  await expect(messageLocator(page, text)).toHaveCount(1)
}

module.exports = {
  registerAndLogin,
  logoutViaRoute,
  switchToRegister,
  fillCredentials,
  submitAuthForm,
  expectVisible,
  waitForSocketConnected,
  openConversation,
  sendMessage,
  expectMessage,
  expectMessageOnce,
  messageLocator,
}