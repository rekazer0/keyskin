#!/bin/bash

##
# Xunfei .it theme deployment and validation script.
#
# Pushes a Xunfei IME theme to a connected Android device, triggers reload,
# captures screenshots, and optionally validates against canvas preview.
#
# Usage:
#   ./scripts/xunfei-install.sh <theme-path> [--validate]
#
# Examples:
#   ./scripts/xunfei-install.sh skin.it
#   ./scripts/xunfei-install.sh skin.it --validate
#
# Environment:
#   XUNFEI_INSTALL_RETRIES      Retry count for adb commands (default: 3)
#   XUNFEI_INSTALL_TIMEOUT      Timeout in seconds for screencap (default: 10)
#   XUNFEI_PACKAGE_NAME         Xunfei IME package name (default: com.iflytek.inputmethod)
#
set -euo pipefail

# ============================================================================
# Configuration
# ============================================================================

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
readonly SCREENSHOTS_DIR="$PROJECT_ROOT/screenshots"
readonly TEMP_DEVICE_PATH="/data/local/tmp"

RETRIES="${XUNFEI_INSTALL_RETRIES:-3}"
TIMEOUT="${XUNFEI_INSTALL_TIMEOUT:-10}"
PACKAGE_NAME="${XUNFEI_PACKAGE_NAME:-com.iflytek.inputmethod}"
VALIDATE_MODE=0

# ============================================================================
# Error handling and logging
# ============================================================================

log_info() {
  echo "[INFO] $*" >&2
}

log_warn() {
  echo "[WARN] $*" >&2
}

log_error() {
  echo "[ERROR] $*" >&2
}

die() {
  log_error "$*"
  exit 1
}

# ============================================================================
# ADB utilities
# ============================================================================

##
# Check if adb is available and device is connected.
check_adb_availability() {
  if ! command -v adb &>/dev/null; then
    die "adb not found in PATH. Install Android SDK Platform Tools."
  fi

  local devices
  devices=$(adb devices 2>&1 | grep -E '^\s+device$' | wc -l)

  if [[ $devices -eq 0 ]]; then
    die "No Android device connected. Please connect a device or start an emulator."
  fi

  log_info "Found $devices connected device(s)"
}

##
# Execute an adb command with timeout and retry logic.
#
# Args:
#   $@: adb command and arguments
#
# Returns:
#   Exit code of the adb command (0 on success)
adb_retry() {
  local attempt=1
  local max_attempts=$RETRIES

  while [[ $attempt -le $max_attempts ]]; do
    if timeout "$TIMEOUT" adb "$@" 2>&1; then
      return 0
    fi

    local exit_code=$?
    if [[ $exit_code -eq 124 ]]; then
      log_warn "adb command timeout (attempt $attempt/$max_attempts)"
    else
      log_warn "adb command failed with code $exit_code (attempt $attempt/$max_attempts)"
    fi

    if [[ $attempt -lt $max_attempts ]]; then
      sleep 1
    fi

    ((attempt++))
  done

  return 1
}

##
# Push a file to the device.
#
# Args:
#   $1: Local file path
#   $2: Remote destination path
push_to_device() {
  local local_file="$1"
  local remote_path="$2"

  if [[ ! -f "$local_file" ]]; then
    die "Local file not found: $local_file"
  fi

  log_info "Pushing $local_file to $remote_path..."
  adb_retry push "$local_file" "$remote_path" >/dev/null || \
    die "Failed to push file to device after $RETRIES attempts"

  log_info "✓ File pushed successfully"
}

##
# Pull a file from the device.
#
# Args:
#   $1: Remote file path
#   $2: Local destination path
pull_from_device() {
  local remote_path="$1"
  local local_path="$2"

  log_info "Pulling $remote_path from device..."
  adb_retry pull "$remote_path" "$local_path" >/dev/null || \
    die "Failed to pull file from device after $RETRIES attempts"

  log_info "✓ File pulled successfully"
}

##
# Execute a shell command on the device.
#
# Args:
#   $@: Command and arguments
shell_on_device() {
  adb_retry shell "$@"
}

# ============================================================================
# Theme installation
# ============================================================================

##
# Install theme to device.
#
# Args:
#   $1: Local theme file path
install_theme() {
  local theme_file="$1"
  local theme_name
  theme_name=$(basename "$theme_file")
  local device_theme_path="$TEMP_DEVICE_PATH/$theme_name"

  log_info "Installing Xunfei theme: $theme_name"

  # Push theme to device
  push_to_device "$theme_file" "$device_theme_path"

  # Trigger theme reload via intent
  log_info "Triggering Xunfei theme reload..."
  shell_on_device \
    am broadcast \
    -a com.iflytek.inputmethod.THEME_CHANGED \
    --es "theme_path" "$device_theme_path" \
    -n "$PACKAGE_NAME/.receiver.ThemeReceiver" >/dev/null 2>&1 || \
    log_warn "Theme broadcast intent may not have been received (non-critical)"

  # Alternative: try starting the IME settings activity to trigger reload
  shell_on_device \
    am start \
    -n "$PACKAGE_NAME/.settings.SettingsActivity" >/dev/null 2>&1 || \
    true

  sleep 2
  log_info "✓ Theme installation triggered"
}

# ============================================================================
# Screenshot capture
# ============================================================================

##
# Capture and pull screenshot from device.
#
# Returns:
#   Path to the captured screenshot
capture_screenshot() {
  local device_screenshot_path="/sdcard/Pictures/xunfei_theme_preview.png"
  local timestamp
  timestamp=$(date +%s%N)
  local local_screenshot="$SCREENSHOTS_DIR/xunfei_theme_$timestamp.png"

  # Create screenshots directory if needed
  mkdir -p "$SCREENSHOTS_DIR"

  log_info "Capturing screenshot from device..."
  shell_on_device screencap -p "$device_screenshot_path" || \
    die "Failed to capture screenshot"

  sleep 1

  # Pull screenshot to local directory
  pull_from_device "$device_screenshot_path" "$local_screenshot"

  # Clean up device screenshot
  shell_on_device rm "$device_screenshot_path" 2>/dev/null || true

  echo "$local_screenshot"
}

# ============================================================================
# Validation
# ============================================================================

##
# Validate screenshot against canvas preview using xunfei-diff module.
#
# Args:
#   $1: Screenshot path
#   $2: Theme file path
#
# Note:
#   Runs a Node.js validation script that loads the theme, renders canvas preview,
#   and compares with captured device screenshot using SSIM and pixel-level diff.
validate_screenshot() {
  local screenshot="$1"
  local theme_file="$2"

  if [[ ! -f "$screenshot" ]]; then
    die "Screenshot file not found: $screenshot"
  fi

  log_info "Validating screenshot against canvas preview..."

  # Create temporary validation script
  local validate_script
  validate_script=$(mktemp)
  trap "rm -f '$validate_script'" RETURN

  cat > "$validate_script" << 'VALIDATE_SCRIPT'
import { readFileSync } from 'node:fs'
import { createCanvas } from 'canvas'
import { compareScreenshots } from '../src/xunfei/xunfei-diff.ts'
import { XunfeiTheme } from '../src/xunfei-theme.ts'
import { XunfeiCanvasPreview } from '../src/xunfei/xunfei-preview.ts'

const [screenshotPath, themeFile] = process.argv.slice(2)

try {
  // Load theme and render preview
  const themeBytes = new Uint8Array(readFileSync(themeFile))
  const theme = await XunfeiTheme.parse(themeBytes)
  const preview = new XunfeiCanvasPreview(theme)

  // Render to canvas
  const canvas = createCanvas(preview.width, preview.height)
  const ctx = canvas.getContext('2d')
  await preview.render(ctx)

  // Load device screenshot
  const img = await new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = reject
    image.src = screenshotPath
  })

  // Compare images
  const imgData = ctx.createImageData(preview.width, preview.height)
  const deviceCtx = createCanvas(img.width, img.height).getContext('2d')
  deviceCtx.drawImage(img, 0, 0)
  const deviceData = deviceCtx.getImageData(0, 0, img.width, img.height)

  const diff = compareScreenshots(imgData, deviceData)

  if (diff.similarity < 85) {
    console.error(`[WARN] Screenshot differs from preview: ${(100 - diff.similarity).toFixed(1)}% difference`)
    process.exit(1)
  } else {
    console.log(`[OK] Screenshot matches preview: ${diff.similarity.toFixed(1)}% similarity`)
  }
} catch (error) {
  console.error('[ERROR] Validation failed:', error.message)
  process.exit(1)
}
VALIDATE_SCRIPT

  # Run validation script from project root
  cd "$PROJECT_ROOT" || die "Cannot change to project directory"
  node --experimental-modules --input-type=module \
    --eval "$(cat "$validate_script")" \
    "$screenshot" "$theme_file" || \
    die "Screenshot validation failed"
}

# ============================================================================
# Main
# ============================================================================

main() {
  if [[ $# -lt 1 ]]; then
    cat >&2 << 'USAGE'
Usage: xunfei-install.sh <theme-path> [--validate]

Deploy a Xunfei .it theme to a connected Android device.

Arguments:
  <theme-path>    Path to the Xunfei theme file (.it)
  --validate      After capture, validate screenshot against canvas preview

Environment Variables:
  XUNFEI_INSTALL_RETRIES      Retry attempts for adb commands (default: 3)
  XUNFEI_INSTALL_TIMEOUT      Timeout per adb command in seconds (default: 10)
  XUNFEI_PACKAGE_NAME         Xunfei IME package name (default: com.iflytek.inputmethod)

Examples:
  ./scripts/xunfei-install.sh skin.it
  ./scripts/xunfei-install.sh skin.it --validate
  XUNFEI_INSTALL_RETRIES=5 ./scripts/xunfei-install.sh skin.it

USAGE
    exit 1
  fi

  local theme_file="$1"

  # Parse optional arguments
  while [[ $# -gt 1 ]]; do
    case "$2" in
      --validate)
        VALIDATE_MODE=1
        ;;
      *)
        die "Unknown option: $2"
        ;;
    esac
    shift
  done

  # Resolve theme file to absolute path
  if [[ ! "$theme_file" = /* ]]; then
    theme_file="$PWD/$theme_file"
  fi

  if [[ ! -f "$theme_file" ]]; then
    die "Theme file not found: $theme_file"
  fi

  log_info "Xunfei theme deployment script"
  log_info "Theme: $theme_file"

  # Pre-flight checks
  check_adb_availability

  # Install theme
  install_theme "$theme_file"

  # Capture screenshot
  local screenshot
  screenshot=$(capture_screenshot)
  log_info "Screenshot saved to: $screenshot"

  # Export screenshot path for downstream tools
  export DEVICE_SCREENSHOT="$screenshot"
  log_info "DEVICE_SCREENSHOT=$DEVICE_SCREENSHOT"

  # Validate if requested
  if [[ $VALIDATE_MODE -eq 1 ]]; then
    validate_screenshot "$screenshot" "$theme_file"
  fi

  log_info "✓ Deployment complete"
}

main "$@"
