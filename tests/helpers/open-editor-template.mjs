export async function dismissStartupDisclaimer(page) {
  const dialog = page.getByRole('dialog', { name: '免责声明' })
  if (!await dialog.isVisible()) return
  await dialog.getByRole('button', { name: '我知道了' }).click()
  await dialog.waitFor({ state: 'detached' })
}

// Drive the real single-click template entry on each layout.
export async function openEditorTemplate(page, template = 'default-android', { preview = false } = {}) {
  await page.waitForSelector('.template-card', { state: 'attached' })
  if (await page.locator('#mobile-welcome-new').isVisible()) {
    await page.locator('#mobile-welcome-new').click()
    await page.locator(`#new-project-dialog [data-template="${template}"]`).click()
  } else {
    await page.locator(`#new-project-form [data-template="${template}"]`).click()
  }
  await page.waitForSelector('.canvas-wrap:not(.empty)')
  await page.waitForFunction(() => !document.querySelector('#open').disabled && (!document.querySelector('#file-operation-dialog').open || !document.querySelector('#file-operation-close').disabled))
  const close = page.locator('#file-operation-dialog[open] #file-operation-close')
  if (await close.isVisible()) await close.click()
  const edit = page.locator('.mobile-preview-return')
  if (!preview && await edit.isVisible()) await edit.click()
}
