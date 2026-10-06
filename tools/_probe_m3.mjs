import { SchemeTonalSpot, MaterialDynamicColors as M, Hct, argbFromHex, hexFromArgb } from './vendor/material-color-utilities.esm.js'
const s = new SchemeTonalSpot(Hct.fromInt(argbFromHex('#FB7299')), false, 0)
const out = {}
for (const k of ['primary','onPrimary','primaryContainer','onPrimaryContainer','secondary','tertiary','error','surface','onSurface','surfaceVariant','onSurfaceVariant','outline','outlineVariant','surfaceContainerLowest','surfaceContainerLow','surfaceContainer','surfaceContainerHigh','surfaceContainerHighest','surfaceDim','surfaceBright','inverseSurface','inverseOnSurface','inversePrimary']) {
  const dc = M[k]
  if (!dc) { out[k] = 'MISSING'; continue }
  try { out[k] = hexFromArgb(dc.getArgb(s)) } catch (e) { out[k] = 'ERR:' + e.message }
}
console.log(JSON.stringify(out, null, 1))
const base = new SchemeTonalSpot(Hct.fromInt(argbFromHex('#6750A4')), false, 0)
console.log('BASELINE light primary=' + hexFromArgb(M.primary.getArgb(base)) + ' surface=' + hexFromArgb(M.surface.getArgb(base)) + ' onSurface=' + hexFromArgb(M.onSurface.getArgb(base)))
const bd = new SchemeTonalSpot(Hct.fromInt(argbFromHex('#6750A4')), true, 0)
console.log('BASELINE dark primary=' + hexFromArgb(M.primary.getArgb(bd)) + ' surface=' + hexFromArgb(M.surface.getArgb(bd)) + ' onSurface=' + hexFromArgb(M.onSurface.getArgb(bd)))
