/**
 * 端到端脚本里自动确认 ask() 对话框（替代原来的 page.on("dialog", accept)）：
 * 自动确认 ask() 对话框和文件操作窗口中的降级确认，不点击其他文件操作按钮。
 */
export function acceptAskDialogs(page) {
  return page.addInitScript(() => {
    new MutationObserver(() => {
      document.querySelector('dialog[open]:not([id]) button:is([value="continue"], [value="close"])')?.click()
      Array.from(document.querySelectorAll('#file-operation-dialog[open] button')).find(button => button.textContent === '继续导出')?.click()
    }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ["open"] })
  })
}
