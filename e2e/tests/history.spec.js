const { test, expect } = require('@playwright/test')
const { createUniqueUser } = require('../helpers/users')
const {
  registerAndLogin,
  loginOnly,
  logoutViaRoute,
  waitForSocketConnected,
  openConversation,
  sendMessage,
  expectMessage,
  expectMessageOnce,
  messageLocator,
} = require('../helpers/ui')

// History survives a logout: B signs out, signs back in from a clean context,
// and must see both earlier messages in order, exactly once each. Then a new
// message from A must still arrive live, proving the socket works after re-login.
//
// Cleanup of the generated users is handled by global-teardown.

/** Builds an isolated context + page and signs the user in. */
async function signInAs(browser, user) {
  const context = await browser.newContext()
  const page = await context.newPage()
  await registerAndLogin(page, user)
  return { context, page }
}

test('history persists across logout and fresh login', async ({ browser }) => {
  // Three sequential sign-in/session cycles plus live round trips run close to
  // the default 30s budget; give this spec headroom on slower machines.
  test.setTimeout(60_000)

  const userA = createUniqueUser()
  const userB = createUniqueUser()

  // Unique per run so assertions can never match a previous run's message.
  const stamp = Date.now().toString(36)
  const msg1 = `msg1_${stamp}`
  const msg2 = `msg2_${stamp}`
  const msg3 = `msg3_${stamp}`

  const A = await signInAs(browser, userA)
  const B = await signInAs(browser, userB)

  // A signed in before B existed, so A's UserPicker cached an empty list.
  await A.page.reload()
  await waitForSocketConnected(A.page)

  await openConversation(A.page, userB.username)
  await openConversation(B.page, userA.username)

  // --- step 1: exchange two messages live ---
  await sendMessage(A.page, msg1)
  await expectMessageOnce(B.page, msg1)
  await expectMessageOnce(A.page, msg1)

  await sendMessage(B.page, msg2)
  await expectMessageOnce(A.page, msg2)
  await expectMessageOnce(B.page, msg2)

  // --- step 2: B logs out, then signs back in from a clean context ---
  const logoutResponse = await logoutViaRoute(B.page)
  expect(logoutResponse.status()).toBe(200)
  await expect(B.page.getByRole('heading', { name: 'Log in' })).toBeVisible()

  // The logged-out context is closed and replaced, mirroring a real restart.
  await B.context.close()

  // B2 must LOG IN, not register — the account already exists.
  const B2ctx = await browser.newContext()
  const B2page = await B2ctx.newPage()
  await loginOnly(B2page, userB)

  // New account was registered before A, so B2's picker may not list A yet.
  await B2page.reload()
  await waitForSocketConnected(B2page)

  await openConversation(B2page, userA.username)

  // Both earlier messages are present, in order, exactly once each.
  await expectMessageOnce(B2page, msg1)
  await expectMessageOnce(B2page, msg2)

  const rows = B2page.locator('.messages .message')
  await expect(rows).toHaveCount(2)

  // Ordering: message 1 sits above message 2 in the rendered history.
  const first = messageLocator(B2page, msg1)
  const second = messageLocator(B2page, msg2)
  expect(
    await first.evaluate((el, other) =>
      el.compareDocumentPosition(other) & Node.DOCUMENT_POSITION_FOLLOWING ? true : false,
      await second.elementHandle(),
    ),
  ).toBe(true)

  // --- step 3: A (still signed in) sends again; B must receive it live ---
  await sendMessage(A.page, msg3)
  await expectMessage(B2page, msg3)
  await expectMessageOnce(B2page, msg3)
  await expect(B2page.locator('.messages .message')).toHaveCount(3)

  await B2ctx.close()
  await A.context.close()
})