/** 文件菜单已经展开时，选择格式并确认导出。 */
export async function exportSkin(page, target) {
  await page.locator('#mobile-export-open').click()
  await target.check()
  await page.locator('#mobile-export-dialog button[value="export"]').click()
}
