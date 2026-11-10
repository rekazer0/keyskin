import assert from 'node:assert/strict'

/** Exercise the inspector's add / replace flow through the real style picker. */
export async function pickStyleReference(page, row, id) {
  const before = await page.evaluate(async () => (await import('/src/app/state.ts')).appState.undoStack.length)
  await row.locator('.ui-style-ref-append').click()
  const picker = page.frameLocator('#picker-frame')
  await picker.locator(`#style-library-grid .ui-style-card[data-style-id="${id}"]`).click()
  assert.equal(await page.evaluate(async () => (await import('/src/app/state.ts')).appState.undoStack.length), before, 'choosing a card waits for confirmation')
  await picker.locator('#style-library-apply').click()
  await page.locator('#picker-dialog').waitFor({ state: 'hidden' })
}
