// Drive the real single-click template entry on each layout.
export async function openEditorTemplate(page, template = 'default-android') {
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
}
