/**
 * Xunfei ADB Setup Module
 *
 * Detects device connection, verifies IME installation, and prepares environment
 * for theme deployment and validation.
 */

import { execSync, spawn } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'

export interface DeviceInfo {
  serial: string
  name: string
  model: string
  androidVersion: string
  resolution: { width: number; height: number }
  imePackage: string
  imeVersion: string
  screenDensity: number
  connected: boolean
  timestamp: number
}

/**
 * Check if ADB is available in PATH
 */
export function checkAdbAvailable(): boolean {
  try {
    execSync('adb version', { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

/**
 * Get list of connected devices
 */
export function getConnectedDevices(): string[] {
  try {
    const output = execSync('adb devices -l', { encoding: 'utf-8' })
    const lines = output.split('\n').filter(l => l.trim() && !l.includes('List'))
    return lines
      .filter(l => l.includes('device') && !l.includes('offline'))
      .map(l => l.split(/\s+/)[0])
  } catch {
    return []
  }
}

/**
 * Run ADB command on device
 */
function adbCommand(cmd: string, serial?: string): string {
  const prefix = serial ? `adb -s ${serial}` : 'adb'
  return execSync(`${prefix} ${cmd}`, { encoding: 'utf-8' })
}

/**
 * Get device property
 */
function getDeviceProp(prop: string, serial?: string): string {
  return adbCommand(`shell getprop ${prop}`, serial).trim()
}

/**
 * Check if package is installed
 */
function isPackageInstalled(pkg: string, serial?: string): boolean {
  try {
    const output = adbCommand(`shell pm list packages | grep ${pkg}`, serial)
    return output.includes(pkg)
  } catch {
    return false
  }
}

/**
 * Get package version
 */
function getPackageVersion(pkg: string, serial?: string): string {
  try {
    const output = adbCommand(`shell dumpsys package ${pkg} | grep versionName`, serial)
    const match = output.match(/versionName=(.+?)[\s\n]/)
    return match ? match[1] : 'unknown'
  } catch {
    return 'unknown'
  }
}

/**
 * Get screen resolution
 */
function getScreenResolution(serial?: string): { width: number; height: number } {
  try {
    const output = adbCommand('shell wm size', serial)
    const match = output.match(/(\d+)x(\d+)/)
    if (match) {
      return { width: parseInt(match[1]), height: parseInt(match[2]) }
    }
  } catch {}
  return { width: 1080, height: 1920 } // fallback
}

/**
 * Get screen density (DPI)
 */
function getScreenDensity(serial?: string): number {
  try {
    const output = adbCommand('shell wm density', serial)
    const match = output.match(/(\d+)/)
    return match ? parseInt(match[1]) : 420
  } catch {
    return 420 // fallback
  }
}

/**
 * Setup device and gather info
 */
export async function setupDevice(serial?: string): Promise<DeviceInfo> {
  if (!checkAdbAvailable()) {
    throw new Error('ADB not found in PATH')
  }

  const devices = getConnectedDevices()
  if (!devices.length) {
    throw new Error('No devices connected')
  }

  const targetSerial = serial || devices[0]
  if (!devices.includes(targetSerial)) {
    throw new Error(`Device ${targetSerial} not found`)
  }

  // Check IME installation
  const imePackage = 'com.iflytek.inputmethod'
  if (!isPackageInstalled(imePackage, targetSerial)) {
    throw new Error(`Xunfei IME (${imePackage}) not installed on device`)
  }

  // Gather device info
  const info: DeviceInfo = {
    serial: targetSerial,
    name: getDeviceProp('ro.product.model', targetSerial),
    model: getDeviceProp('ro.product.device', targetSerial),
    androidVersion: getDeviceProp('ro.build.version.release', targetSerial),
    resolution: getScreenResolution(targetSerial),
    imePackage,
    imeVersion: getPackageVersion(imePackage, targetSerial),
    screenDensity: getScreenDensity(targetSerial),
    connected: true,
    timestamp: Date.now(),
  }

  // Create screenshot directory
  const screenshotDir = path.join(process.cwd(), 'screenshots')
  if (!fs.existsSync(screenshotDir)) {
    fs.mkdirSync(screenshotDir, { recursive: true })
  }

  console.log('Device setup successful:', info)
  return info
}

/**
 * Verify device is still connected
 */
export function verifyDeviceConnection(serial: string): boolean {
  const devices = getConnectedDevices()
  return devices.includes(serial)
}

/**
 * Wait for device to be ready (IME idle)
 */
export function waitForDeviceReady(serial: string, timeout = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    const interval = setInterval(() => {
      try {
        if (verifyDeviceConnection(serial)) {
          const timeElapsed = Date.now() - start
          if (timeElapsed > timeout) {
            clearInterval(interval)
            resolve()
          }
        }
      } catch (e) {
        clearInterval(interval)
        reject(e)
      }
    }, 100)
  })
}
