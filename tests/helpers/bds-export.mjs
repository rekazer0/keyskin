import { SkinArchive } from '../../src/skin.ts'
import { completeBdsPackage } from '../../src/bds-package.ts'

export async function completeBdsBytes(bytes, compose) {
  const archive = SkinArchive.open(bytes, 'bds')
  await completeBdsPackage(archive, compose)
  return archive.toBytesAsync('bds')
}
