/** 分享页面中选择格式并执行导出。 */
export async function exportSkin(page, target) {
  await page.locator('#mobile-export-open').evaluate(button => button.click())
  await target.check()
  await page.locator('#share-export').click()
}
