const { test, expect } = require('@playwright/test')

test('shows the login/register screen when signed out', async ({ page }) => {
  await page.goto('/')

  // AuthScreen.jsx renders this heading when mode is 'login' (the default).
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible()
  await expect(page.getByLabel('Username')).toBeVisible()
  await expect(page.getByLabel('Password')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Need an account? Register' })).toBeVisible()
})