const { test, expect } = require('@playwright/test')
const { createUniqueUser } = require('../helpers/users')
const {
  registerAndLogin,
  waitForSocketConnected,
  openConversation,
  sendMessage,
  expectMessageOnce,
} = require('../helpers/ui')

// Two users, two isolated browser contexts (separate cookie jars), chatting live
// over the WebSocket. Neither side reloads: delivery is asserted purely from the
// pushed frame, which is the whole point of the real-time path.
//
// Cleanup of both generated users is handled by global-teardown.

/** Builds a context + page pair for one user and registers/logs them in. */
async function signInAs(browser, user) {
  const context = await browser.newContext()
  const page = await context.newPage()
  await registerAndLogin(page, user)
  return { context, page }
}

test('two users exchange messages live in both directions', async ({ browser }) => {
  const userA = createUniqueUser()
  const userB = createUniqueUser()

  // Unique per run so an assertion can never match a previous run's message.
  const aToB = `a2b_${Date.now().toString(36)}`
  const bToA = `b2a_${Date.now().toString(36)}`

  const A = await signInAs(browser, userA)
  const B = await signInAs(browser, userB)

  try {
    // A signed in before B existed, so A's UserPicker cached a list with
    // nobody in it. Reload A so it refetches and includes B.
    await A.page.reload()
    await waitForSocketConnected(A.page)

    // Both open each other's conversation.
    await openConversation(A.page, userB.username)
    await openConversation(B.page, userA.username)

    // A sends; B must receive it live, with no reload.
    await sendMessage(A.page, aToB)
    await expectMessageOnce(B.page, aToB)
    await expectMessageOnce(A.page, aToB)

    // B replies; A must receive it live, with no reload.
    await sendMessage(B.page, bToA)
    await expectMessageOnce(A.page, bToA)
    await expectMessageOnce(B.page, bToA)

    // No duplicates after both messages have settled on both sides.
    await expect(A.page.locator('.messages .message')).toHaveCount(2)
    await expect(B.page.locator('.messages .message')).toHaveCount(2)
  } finally {
    await A.context.close()
    await B.context.close()
  }
})