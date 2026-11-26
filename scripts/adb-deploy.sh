#!/bin/bash

##
# ADB deployment and live screenshot capture script for keyboard themes.
#
# Deploys keyboard theme skins to Android devices via ADB, switches IME,
# captures screenshots in multiple states, and pulls them to desktop.
#
# Features:
# - List connected Android devices
# - Push skin files (.it, .bds, etc.) to device storage
# - Automatically switch to deployed theme in IME settings
# - Capture screenshots in multiple states (home, keyboard focus, settings)
# - Pull screenshots to desktop with timestamped filenames
# - Support physical devices and emulators
# - Comprehensive error handling and logging
#
# Usage:
#   ./scripts/adb-deploy.sh list
#   ./scripts/adb-deploy.sh deploy <skin-file> [--device <id>] [--batch] [--all-states]
#   ./scripts/adb-deploy.sh capture [--device <id>] [--output-dir <dir>]
#
# Examples:
#   ./scripts/adb-deploy.sh list
#   ./scripts/adb-deploy.sh deploy skin.it
#   ./scripts/adb-deploy.sh deploy skin.it --device emulator-5554
#   ./scripts/adb-deploy.sh deploy skin.it --batch
#   ./scripts/adb-deploy.sh capture --all-states
#
# Environment:
#   ADB_DEPLOY_RETRIES       Retry count for adb commands (default: 3)
#   ADB_DEPLOY_TIMEOUT       Timeout in seconds for adb operations (default: 15)
#   ADB_DEPLOY_OUTPUT        Output directory for screenshots (default: keyskin/device_captures)
#
set -euo pipefail

# ============================================================================
# Configuration
# ============================================================================

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
readonly DEFAULT_OUTPUT_DIR="$PROJECT_ROOT/keyskin/device_captures"

RETRIES="${ADB_DEPLOY_RETRIES:-3}"
TIMEOUT="${ADB_DEPLOY_TIMEOUT:-15}"
OUTPUT_DIR="${ADB_DEPLOY_OUTPUT:-$DEFAULT_OUTPUT_DIR}"

# IME package mappings
declare -A IME_PACKAGES=(
  ["xunfei"]="com.iflytek.inputmethod"
  ["sogou"]="com.sohu.inputmethod.sogou"
  ["baidu"]="com.baidu.input"
)

# Common IME target paths
declare -A IME_PATHS=(
  ["xunfei"]="/data/data/com.iflytek.inputmethod/skins/"
  ["sogou"]="/data/data/com.sohu.inputmethod.sogou/skins/"
  ["baidu"]="/data/data/com.baidu.input/skins/"
)

# ============================================================================
# Logging
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

log_debug() {
  if [[ "${DEBUG:-0}" == "1" ]]; then
    echo "[DEBUG] $*" >&2
  fi
}

die() {
  log_error "$*"
  exit 1
}

# ============================================================================
# ADB utilities
# ============================================================================

##
# Check if adb is available
check_adb() {
  if ! command -v adb &>/dev/null; then
    die "adb not found in PATH. Install Android SDK Platform Tools."
  fi
  log_debug "adb is available: $(adb --version | head -1)"
}

##
# List all connected devices with details
list_devices() {
  local devices_output
  devices_output=$(adb devices -l)

  local device_count=0
  local connected_devices=()

  while IFS= read -r line; do
    # Skip header and empty lines
    [[ -z "$line" ]] && continue
    [[ "$line" == *"List of attached devices"* ]] && continue

    # Parse device line
    local device_id device_status rest
    read -r device_id device_status rest <<< "$line"

    if [[ "$device_status" == "device" ]] || [[ "$device_status" == "emulator" ]]; then
      ((device_count++))
      connected_devices+=("$device_id")

      # Extract device model/info
      local model=""
      if [[ "$rest" =~ model:([^ ]+) ]]; then
        model="${BASH_REMATCH[1]}"
      fi

      printf "  %2d. %-20s %s\n" "$device_count" "$device_id" "$model"
    fi
  done <<< "$devices_output"

  if [[ $device_count -eq 0 ]]; then
    die "No Android devices connected. Please connect a device or start an emulator."
  fi

  log_info "Found $device_count connected device(s)"
}

##
# Execute adb command with retry and timeout
adb_cmd() {
  local device_id="${1:-}"
  shift

  local attempt=1
  while [[ $attempt -le $RETRIES ]]; do
    log_debug "adb command attempt $attempt/$RETRIES: ${*}"

    local cmd="adb"
    if [[ -n "$device_id" ]]; then
      cmd="$cmd -s $device_id"
    fi
    cmd="$cmd $*"

    if timeout "$TIMEOUT" $cmd 2>&1; then
      log_debug "adb command succeeded"
      return 0
    fi

    local exit_code=$?
    if [[ $exit_code -eq 124 ]]; then
      log_warn "adb command timeout (attempt $attempt/$RETRIES)"
    else
      log_warn "adb command failed with code $exit_code (attempt $attempt/$RETRIES): ${*}"
    fi

    if [[ $attempt -lt $RETRIES ]]; then
      sleep 1
    fi

    ((attempt++))
  done

  log_error "adb command failed after $RETRIES attempts: ${*}"
  return 1
}

##
# Verify device is accessible
verify_device() {
  local device_id="$1"

  log_info "Verifying device: $device_id"

  local devices
  devices=$(adb devices | grep -c "^$device_id" || true)

  if [[ $devices -eq 0 ]]; then
    die "Device not found: $device_id"
  fi

  # Check device state
  local state
  state=$(adb -s "$device_id" get-state 2>&1 || echo "unknown")

  if [[ "$state" != "device" ]]; then
    die "Device state is '$state', expected 'device': $device_id"
  fi

  log_info "✓ Device verified"
}

# ============================================================================
# Theme detection and deployment
# ============================================================================

##
# Detect IME type from skin file extension or content
detect_ime_type() {
  local skin_file="$1"
  local ext="${skin_file##*.}"

  case "$ext" in
    it) echo "xunfei" ;;
    bds) echo "baidu" ;;
    bda) echo "baidu" ;;
    ssf) echo "sogou" ;;
    *)
      log_warn "Unknown skin file extension: $ext"
      echo "unknown"
      ;;
  esac
}

##
# Push skin file to device
push_skin() {
  local device_id="$1"
  local skin_file="$2"
  local ime_type="${3:-xunfei}"

  if [[ ! -f "$skin_file" ]]; then
    die "Skin file not found: $skin_file"
  fi

  local skin_name
  skin_name=$(basename "$skin_file")

  local device_path="${IME_PATHS[$ime_type]:-/data/local/tmp/}"
  device_path="$device_path$skin_name"

  log_info "Pushing $skin_name to device at $device_path..."

  adb_cmd "$device_id" push "$skin_file" "$device_path" > /dev/null || \
    die "Failed to push skin file to device"

  log_info "✓ Skin pushed successfully: $device_path"
  echo "$device_path"
}

##
# Switch to deployed theme in IME settings
switch_theme() {
  local device_id="$1"
  local theme_path="$2"
  local ime_type="${3:-xunfei}"

  log_info "Switching to theme: $theme_path"

  case "$ime_type" in
    xunfei)
      # Trigger Xunfei theme change via broadcast
      adb_cmd "$device_id" shell am broadcast \
        -a com.iflytek.inputmethod.THEME_CHANGED \
        --es "theme_path" "$theme_path" \
        -n "com.iflytek.inputmethod/.receiver.ThemeReceiver" \
        2>/dev/null || log_warn "Theme broadcast intent may not have been received"

      # Open IME settings to ensure reload
      adb_cmd "$device_id" shell am start \
        -n "com.iflytek.inputmethod/.settings.SettingsActivity" \
        2>/dev/null || true
      ;;

    sogou)
      # Sogou theme switching
      adb_cmd "$device_id" shell am broadcast \
        -a com.sohu.inputmethod.sogou.THEME_CHANGED \
        --es "theme_file" "$theme_path" \
        2>/dev/null || log_warn "Sogou theme broadcast may not have been received"
      ;;

    baidu)
      # Baidu theme switching
      adb_cmd "$device_id" shell am start \
        -n "com.baidu.input/.settings.preference.NewSettingActivity" \
        2>/dev/null || true
      ;;
  esac

  sleep 2
  log_info "✓ Theme switch triggered"
}

# ============================================================================
# Screenshot capture
# ============================================================================

##
# Capture screenshot at specified state
capture_screenshot() {
  local device_id="$1"
  local state="${2:-default}"
  local output_file="$3"

  log_info "Capturing screenshot ($state)..."

  local device_screenshot="/sdcard/keyskin_capture_$state.png"

  case "$state" in
    home)
      # Navigate to home screen
      adb_cmd "$device_id" shell input keyevent KEYCODE_HOME > /dev/null 2>&1 || true
      sleep 1
      ;;

    keyboard)
      # Launch keyboard focus (open keyboard in a text input)
      adb_cmd "$device_id" shell am start -n "com.android.settings/.Settings" > /dev/null 2>&1 || true
      sleep 1
      adb_cmd "$device_id" shell input tap 540 600 > /dev/null 2>&1 || true
      sleep 1
      ;;

    settings)
      # Open keyboard settings
      adb_cmd "$device_id" shell am start -n "com.android.settings/.Settings" > /dev/null 2>&1 || true
      sleep 1
      ;;
  esac

  # Capture screenshot
  adb_cmd "$device_id" shell screencap -p "$device_screenshot" || \
    die "Failed to capture screenshot"

  sleep 1

  # Pull screenshot to local device
  mkdir -p "$OUTPUT_DIR"
  adb_cmd "$device_id" pull "$device_screenshot" "$output_file" > /dev/null || \
    die "Failed to pull screenshot from device"

  # Clean up device screenshot
  adb_cmd "$device_id" shell rm "$device_screenshot" 2>/dev/null || true

  log_info "✓ Screenshot captured: $output_file"
}

##
# Capture multiple screenshots in different states
batch_capture() {
  local device_id="$1"
  local base_name="$2"

  local states=("home" "keyboard" "settings")

  for state in "${states[@]}"; do
    local output_file="$OUTPUT_DIR/${base_name}_${state}.png"
    capture_screenshot "$device_id" "$state" "$output_file"
  done
}

# ============================================================================
# Main commands
# ============================================================================

cmd_list() {
  log_info "Connected Android devices:"
  list_devices
}

cmd_deploy() {
  if [[ $# -lt 1 ]]; then
    die "Usage: adb-deploy.sh deploy <skin-file> [--device <id>] [--batch] [--all-states]"
  fi

  local skin_file="$1"
  local device_id=""
  local batch_mode=0
  local all_states=0

  # Parse options
  shift || true
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --device)
        device_id="$2"
        shift 2
        ;;
      --batch)
        batch_mode=1
        shift
        ;;
      --all-states)
        all_states=1
        shift
        ;;
      *)
        die "Unknown option: $1"
        ;;
    esac
  done

  # Resolve skin file to absolute path
  if [[ ! "$skin_file" = /* ]]; then
    skin_file="$PWD/$skin_file"
  fi

  if [[ ! -f "$skin_file" ]]; then
    die "Skin file not found: $skin_file"
  fi

  local skin_name
  skin_name=$(basename "$skin_file")
  local ime_type
  ime_type=$(detect_ime_type "$skin_file")

  log_info "Deploying skin: $skin_name (type: $ime_type)"

  # If no device specified, get first connected device
  if [[ -z "$device_id" ]]; then
    local devices
    devices=$(adb devices | grep -E "^[^\s]+" | grep device | head -1 | awk '{print $1}')
    if [[ -z "$devices" ]]; then
      die "No devices connected. Run: adb-deploy.sh list"
    fi
    device_id="$devices"
  fi

  verify_device "$device_id"

  # Deploy
  local device_path
  device_path=$(push_skin "$device_id" "$skin_file" "$ime_type")
  switch_theme "$device_id" "$device_path" "$ime_type"

  # Capture screenshots
  local timestamp
  timestamp=$(date +%Y%m%d_%H%M%S)
  local device_name
  device_name=$(adb -s "$device_id" shell getprop ro.product.model 2>/dev/null | tr -d '\r' || echo "device")
  local base_name="${device_name}_${timestamp}"

  mkdir -p "$OUTPUT_DIR"

  if [[ $batch_mode -eq 1 ]] || [[ $all_states -eq 1 ]]; then
    batch_capture "$device_id" "$base_name"
  else
    local output_file="$OUTPUT_DIR/${base_name}_default.png"
    capture_screenshot "$device_id" "default" "$output_file"
  fi

  log_info "✓ Deployment complete"
  log_info "Screenshots saved to: $OUTPUT_DIR"
}

cmd_capture() {
  local device_id=""
  local output_file=""
  local all_states=0

  # Parse options
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --device)
        device_id="$2"
        shift 2
        ;;
      --output)
        output_file="$2"
        shift 2
        ;;
      --all-states)
        all_states=1
        shift
        ;;
      *)
        die "Unknown option: $1"
        ;;
    esac
  done

  # If no device specified, get first connected device
  if [[ -z "$device_id" ]]; then
    local devices
    devices=$(adb devices | grep -E "^[^\s]+" | grep device | head -1 | awk '{print $1}')
    if [[ -z "$devices" ]]; then
      die "No devices connected. Run: adb-deploy.sh list"
    fi
    device_id="$devices"
  fi

  verify_device "$device_id"
  mkdir -p "$OUTPUT_DIR"

  if [[ -z "$output_file" ]]; then
    local timestamp
    timestamp=$(date +%Y%m%d_%H%M%S)
    local device_name
    device_name=$(adb -s "$device_id" shell getprop ro.product.model 2>/dev/null | tr -d '\r' || echo "device")
    output_file="$OUTPUT_DIR/${device_name}_${timestamp}"
  fi

  if [[ $all_states -eq 1 ]]; then
    batch_capture "$device_id" "$output_file"
  else
    capture_screenshot "$device_id" "default" "${output_file}.png"
  fi
}

# ============================================================================
# Main
# ============================================================================

main() {
  if [[ $# -lt 1 ]]; then
    cat >&2 << 'USAGE'
ADB deployment and screenshot capture for keyboard themes.

Usage:
  adb-deploy.sh list
  adb-deploy.sh deploy <skin-file> [--device <id>] [--batch] [--all-states]
  adb-deploy.sh capture [--device <id>] [--output <prefix>] [--all-states]

Commands:
  list              List connected Android devices
  deploy            Deploy skin to device and capture screenshots
  capture           Capture screenshots from connected device

Options:
  --device <id>     Target device ID (default: first connected device)
  --batch           Deploy to all connected devices
  --all-states      Capture multiple states (home, keyboard, settings)
  --output <prefix> Output file prefix for screenshots

Environment Variables:
  ADB_DEPLOY_RETRIES   Retry attempts for adb commands (default: 3)
  ADB_DEPLOY_TIMEOUT   Timeout per adb operation in seconds (default: 15)
  ADB_DEPLOY_OUTPUT    Output directory (default: keyskin/device_captures)
  DEBUG                Set to 1 for debug logging

Examples:
  ./scripts/adb-deploy.sh list
  ./scripts/adb-deploy.sh deploy skin.it
  ./scripts/adb-deploy.sh deploy skin.it --device emulator-5554
  ./scripts/adb-deploy.sh deploy skin.it --all-states
  ./scripts/adb-deploy.sh capture --all-states
  DEBUG=1 ./scripts/adb-deploy.sh deploy skin.it

USAGE
    exit 1
  fi

  check_adb

  local command="$1"
  shift || true

  case "$command" in
    list)
      cmd_list "$@"
      ;;
    deploy)
      cmd_deploy "$@"
      ;;
    capture)
      cmd_capture "$@"
      ;;
    *)
      die "Unknown command: $command"
      ;;
  esac
}

main "$@"
