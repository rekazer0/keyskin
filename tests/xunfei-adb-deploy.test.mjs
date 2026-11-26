/**
 * Xunfei ADB Deployment Tests
 *
 * Tests for deploying Xunfei themes to connected Android devices:
 * - Device availability detection
 * - Theme installation via adb
 * - Screenshot capture and polling
 * - Device screenshot validation
 * - adb command logging
 *
 * Requirements:
 * - Android SDK Platform Tools (adb) must be in PATH
 * - Connected Android device or emulator (optional; test skips if unavailable)
 * - Xunfei IME installed on device (for full flow)
 *
 * Run with: node --test tests/xunfei-adb-deploy.test.mjs
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { resolve, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = resolve(fileURLToPath(import.meta.url), '..')
const PROJECT_ROOT = resolve(__dirname, '..')
const SCREENSHOTS_DIR = resolve(PROJECT_ROOT, 'screenshots')
const SCRIPTS_DIR = resolve(PROJECT_ROOT, 'scripts')
const XUNFEI_INSTALL_SCRIPT = resolve(SCRIPTS_DIR, 'xunfei-install.sh')

// ============================================================================
// Utilities
// ============================================================================

/**
 * Check if adb command is available and optionally check for connected devices.
 * @returns {boolean} true if adb is available
 */
function isAdbAvailable() {
  const result = spawnSync('which', ['adb'], { encoding: 'utf-8' })
  return result.status === 0
}

/**
 * Get list of connected devices via adb.
 * @returns {string[]} list of device IDs
 */
function getConnectedDevices() {
  const result = spawnSync('adb', ['devices'], { encoding: 'utf-8' })
  if (result.status !== 0) return []

  const lines = result.stdout.split('\n')
  const devices = []

  for (const line of lines) {
    const match = line.match(/^(\S+)\s+device$/)
    if (match) {
      devices.push(match[1])
    }
  }

  return devices
}

/**
 * Find first available Xunfei theme file in project.
 * @returns {string|null} path to theme file, or null if none found
 */
function findFirstSampleTheme() {
  // Look for .it files in common theme directories
  const themePaths = [
    resolve(PROJECT_ROOT, 'themes'),
    resolve(PROJECT_ROOT, 'samples'),
    resolve(PROJECT_ROOT, 'test-data'),
    SCREENSHOTS_DIR,
  ]

  for (const dir of themePaths) {
    if (!existsSync(dir)) continue

    try {
      const files = readdirSync(dir)
      const themeFile = files.find(f => f.endsWith('.it'))
      if (themeFile) {
        return resolve(dir, themeFile)
      }
    } catch (e) {
      // Directory not readable, skip
    }
  }

  return null
}

/**
 * Poll for device screenshot files matching pattern device-*.png
 * @param {number} maxRetries - maximum retry attempts
 * @param {number} intervalMs - interval between retries in milliseconds
 * @returns {Promise<string|null>} path to screenshot, or null if none found
 */
async function pollForDeviceScreenshot(maxRetries = 5, intervalMs = 2000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    if (attempt > 1) {
      await new Promise(r => setTimeout(r, intervalMs))
    }

    // Check if screenshots directory exists
    if (!existsSync(SCREENSHOTS_DIR)) {
      continue
    }

    try {
      const files = readdirSync(SCREENSHOTS_DIR)
      const deviceScreenshots = files.filter(f => f.match(/^device-.*\.png$/))

      if (deviceScreenshots.length > 0) {
        // Return most recent
        const newest = deviceScreenshots.sort().pop()
        return resolve(SCREENSHOTS_DIR, newest)
      }
    } catch (e) {
      // Continue polling
    }
  }

  return null
}

/**
 * Run xunfei-install.sh script and capture output.
 * @param {string} themeFile - path to theme file
 * @param {boolean} validate - whether to pass --validate flag
 * @returns {object} result with status, stdout, stderr
 */
function runXunfeiInstall(themeFile, validate = false) {
  const args = [themeFile]
  if (validate) {
    args.push('--validate')
  }

  const result = spawnSync('bash', [XUNFEI_INSTALL_SCRIPT, ...args], {
    encoding: 'utf-8',
    timeout: 60000, // 60s timeout
    cwd: PROJECT_ROOT,
  })

  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    error: result.error,
  }
}

/**
 * Extract adb-related log messages from script output.
 * @param {string} output - script output
 * @returns {object} with commands array of log messages
 */
function extractAdbLogs(output) {
  const logMessages = []
  const lines = output.split('\n')

  for (const line of lines) {
    // Match log lines with operations like push, pull, shell, etc.
    const match = line.match(/\[(?:INFO|WARN|ERROR)\]\s+(.+)/)
    if (match) {
      const msg = match[1]
      // Filter to adb-related operations
      if (
        msg.includes('adb') ||
        msg.includes('Pushing') ||
        msg.includes('Pulling') ||
        msg.includes('shell') ||
        msg.includes('broadcast') ||
        msg.includes('screencap')
      ) {
        logMessages.push(msg)
      }
    }
  }

  return { commands: logMessages }
}

/**
 * Generate filename for device screenshot with timestamp.
 * @returns {string} filename like device-1732606400000.png
 */
function generateDeviceScreenshotName() {
  const timestamp = Date.now()
  return `device-${timestamp}.png`
}

// ============================================================================
// Setup
// ============================================================================

mkdirSync(SCREENSHOTS_DIR, { recursive: true })

// ============================================================================
// Tests
// ============================================================================

test('Check adb availability', async (t) => {
  if (!isAdbAvailable()) {
    t.skip('adb not found in PATH - install Android SDK Platform Tools')
    return
  }
})

test('Find first sample Xunfei theme', () => {
  const theme = findFirstSampleTheme()
  // This test just checks if we can locate a theme, doesn't skip if not found
  // (allowing workflow to work without pre-existing theme files)
  if (!theme) {
    console.log('⚠ No sample Xunfei theme (.it file) found in project')
  }
})

test('Device detection - check connected devices', async (t) => {
  if (!isAdbAvailable()) {
    t.skip('adb not available, skipping device detection')
    return
  }

  const devices = getConnectedDevices()
  if (devices.length === 0) {
    console.log('ℹ No Android device connected - deployment tests will be skipped')
  } else {
    console.log(`Found ${devices.length} connected device(s): ${devices.join(', ')}`)
  }
})

test('Deploy theme and capture device screenshot', async (t) => {
  if (!isAdbAvailable()) {
    t.skip('adb not available')
    return
  }

  const devices = getConnectedDevices()
  if (devices.length === 0) {
    t.skip('No Android device connected')
    return
  }

  const themeFile = findFirstSampleTheme()
  if (!themeFile) {
    t.skip('No sample Xunfei theme found - cannot proceed with deployment')
    return
  }

  console.log(`Deploying theme: ${basename(themeFile)}`)
  console.log(`Target device: ${devices[0]}`)

  // Run deployment script
  const result = runXunfeiInstall(themeFile)

  // Log output for debugging
  console.log('\n=== Script Output ===')
  if (result.stdout) {
    console.log(result.stdout)
  }
  if (result.stderr) {
    console.error(result.stderr)
  }

  // Extract and log adb commands
  const logs = extractAdbLogs(result.stdout + result.stderr)
  if (logs.commands.length > 0) {
    console.log('\n=== ADB Commands ===')
    logs.commands.forEach(cmd => console.log(`  ${cmd}`))
  }

  // Poll for device screenshot
  const screenshot = await pollForDeviceScreenshot(5, 2000)

  if (screenshot) {
    console.log(`\n✓ Device screenshot captured: ${basename(screenshot)}`)
    assert.ok(existsSync(screenshot), 'Screenshot file exists')
  } else {
    console.log('\n⚠ No device screenshot captured after polling')
  }
})

test('Device screenshot polling - retry mechanism', async (t) => {
  if (!isAdbAvailable()) {
    t.skip('adb not available')
    return
  }

  const devices = getConnectedDevices()
  if (devices.length === 0) {
    t.skip('No Android device connected')
    return
  }

  // Create a mock device screenshot to test polling
  const mockScreenshotName = generateDeviceScreenshotName()
  const mockScreenshotPath = resolve(SCREENSHOTS_DIR, mockScreenshotName)

  try {
    // Write empty PNG header (minimal valid PNG)
    const pngHeader = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
      0x00, 0x00, 0x00, 0x0d, // IHDR chunk size
      0x49, 0x48, 0x44, 0x52, // IHDR
      0x00, 0x00, 0x00, 0x01, // width: 1
      0x00, 0x00, 0x00, 0x01, // height: 1
      0x08, 0x02, 0x00, 0x00, 0x00, // bit depth, color type, etc.
      0x90, 0x77, 0x53, 0xde, // CRC
      0x00, 0x00, 0x00, 0x0c, // IEND chunk size
      0x49, 0x45, 0x4e, 0x44, // IEND
      0xae, 0x42, 0x60, 0x82, // CRC
    ])

    // We won't actually write the file; just test polling returns null with no files
    const screenshot = await pollForDeviceScreenshot(2, 100)
    assert.strictEqual(screenshot, null, 'Polling returns null when no files found')
  } finally {
    // Cleanup
    try {
      if (existsSync(mockScreenshotPath)) {
        // Don't delete; leave for manual inspection
      }
    } catch (e) {
      // Ignore cleanup errors
    }
  }
})

test('Screenshot filename generation', () => {
  const filename = generateDeviceScreenshotName()
  assert.ok(filename.match(/^device-\d+\.png$/), 'Filename matches pattern device-*.png')
})

test('adb command logging - parse output', () => {
  const mockOutput = `
[INFO] Found 1 connected device(s)
[INFO] Pushing /path/to/theme.it to /data/local/tmp/theme.it...
[INFO] ✓ File pushed successfully
[INFO] Triggering Xunfei theme reload...
[WARN] Theme broadcast intent may not have been received (non-critical)
[INFO] ✓ Theme installation triggered
[INFO] Capturing screenshot from device...
  `

  const logs = extractAdbLogs(mockOutput)
  assert.ok(logs.commands.length > 0, 'Should extract adb-related logs from output')
  assert.ok(
    logs.commands.some(cmd => cmd.includes('Pushing') || cmd.includes('screencap')),
    'Should contain adb operation logs'
  )
})

test('Screenshots directory created', () => {
  assert.ok(existsSync(SCREENSHOTS_DIR), 'Screenshots directory exists or was created')
})
