import { SkinArchive } from '../../src/skin.ts'
import { bakeBdsBackgrounds } from '../../src/bds-backgrounds.ts'
import { completeBdsPackage } from '../../src/bds-package.ts'

export function bakeBdsBytes(bytes) {
  const archive = SkinArchive.open(bytes, 'bds')
  bakeBdsBackgrounds(archive)
  return archive.toBytes('bds')
}

export async function completeBdsBytes(bytes, compose) {
  const archive = SkinArchive.open(bytes, 'bds')
  await completeBdsPackage(archive, compose)
  return archive.toBytesAsync('bds')
}
