export function shouldClearMixedInput(
  key: string,
  placeholder: string,
  disabled: boolean,
): boolean {
  return !disabled && placeholder === "混合" && (key === "Delete" || key === "Backspace")
}
