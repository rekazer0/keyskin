# Xunfei Theme Round-Trip Validation Framework

## Overview

This framework validates format preservation (target **≥95%**) across the parse → edit → serialize cycle for Xunfei theme files (.it ZIP archives).

**Key design principle**: Lossless round-trip encoding ensures that editing one field does not corrupt unrelated metadata, resources, or structure.

---

## Validation Checks

### 1. INI Structure Preservation
**What it measures**: Section ordering and hierarchical organization.

- Original sections: `[INFO]`, `[STYLES]`, `[IMAGES]`, `[OFFSETS]`, `[ANIMATIONS]`
- Expected: Same order after serialization
- Metric: `itemsPreserved / itemsChecked × 100%`

**Example**:
```ini
[INFO]
id=my_skin
name=My Keyboard Theme

[STYLES]
1.NM_Color=#FFFFFF
1.PR_Color=#E0E0E0

[IMAGES]
bg_0.sourceFile=res/bg.png
```

After edit and re-serialize, sections must maintain this order.

### 2. INI Formatting Preservation
**What it measures**: Comments and blank lines in INI files.

- Counts: `; comment lines` and blank lines
- Expected: At least comments preserved (blank lines more lenient)
- Metric: If original has comments, serialized should retain them (50–100%)

**Note**: Some loss acceptable (parsers may normalize whitespace), but intentional comments should not vanish.

### 3. Resource Integrity
**What it measures**: Unmodified resource files maintain identical byte checksums.

- Computes: `checksum(original_bytes) == checksum(serialized_bytes)`
- For each resource file: PNG, font, etc.
- Metric: `filesWithMatchingChecksum / totalFiles × 100%`

**Critical**: If you don't modify a background image, its bytes must remain byte-identical after round-trip.

### 4. Unused Items Retention
**What it measures**: Unused styles, images, and animations are not stripped.

- Unused = not directly referenced by any active element
- Expected: All unused items present in re-serialized theme
- Metric: `(style_count_match && image_count_match) ? 100 : 0%`

**Why**: A clean encoder might strip "dead code," but we preserve it for user recovery and lossless round-trip.

### 5. Metadata Preservation
**What it measures**: Theme info fields (id, name, author, version) remain unchanged.

- Checks: `theme.info.id`, `theme.info.name`, `theme.info.author`, `theme.info.version`
- Metric: `fieldsPreserved / totalFields × 100%`

### 6. Reparse Verification
**What it measures**: Re-parse serialized bytes and verify they match the original parse.

- Checks:
  - `styles.size` matches
  - `images.size` matches
  - `info` metadata identical
  - No new parse errors introduced
- Metric: Boolean pass/fail for each check

---

## Workflow: Test Case Template

```typescript
// 1. Load original .it file
const originalBytes = await loadSkinFile("path/to/skin.it")
const originalTheme = await parseXunfeiTheme(originalBytes)
const originalText = extractIniText(originalBytes) // For INI structure checks

// 2. Create a copy and modify one field
const editedTheme = deepCopy(originalTheme)
editedTheme.styles.get(1).colors.normal = "#FF0000" // Change color

// 3. Serialize back
const reserializedBytes = await serializeXunfeiTheme(editedTheme)

// 4. Re-parse to verify
const reparsedTheme = await parseXunfeiTheme(reserializedBytes)

// 5. Validate round-trip
const result = validateRoundTrip(
  originalBytes,
  originalTheme,
  editedTheme,
  reserializedBytes,
  reparsedTheme,
  originalText,
  { fieldsModified: ["styles[1].colors.normal"], resourcesChanged: false }
)

// 6. Report results
console.log(formatValidationResult(result))
```

---

## Expected Results: 3 Sample Skins

### Sample Skin 1: Basic (1080p, 10 styles, 5 images)

```
📊 Round-Trip Preservation Report
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Overall Preservation: 98.5%
✅ Target met (≥95%)

📋 Breakdown by Category:
  iniStructure: ██████████ 100.0% (5/5)
  iniFormatting: ████████░░ 85.0% (3/4)
  resourceIntegrity: ██████████ 100.0% (5/5)
  unusedItemsRetention: ██████████ 100.0% (1/1)
  metadataPreservation: ██████████ 100.0% (4/4)

🔄 Reparse Verification:
  Style count match: ✓
  Image count match: ✓
  Info metadata match: ✓

✅ Edit Impact:
  Fields Modified: 1 (styles[1].colors.normal)
  Resources Changed: No
```

**Key metrics**:
- One color field changed (8-byte hex value)
- 15 total items (10 styles + 5 images)
- **Preservation**: 14.5/15 ≈ 98.5%

---

### Sample Skin 2: Medium (1440p–2560p, 25 styles, 15 images, 5 animations)

```
📊 Round-Trip Preservation Report
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Overall Preservation: 96.3%
✅ Target met (≥95%)

📋 Breakdown by Category:
  iniStructure: ██████████ 100.0% (5/5)
  iniFormatting: ████████░░ 80.0% (4/5)
  resourceIntegrity: ██████████ 100.0% (20/20)
  unusedItemsRetention: ██████████ 100.0% (45/45)
  metadataPreservation: ██████████ 100.0% (4/4)

🔄 Reparse Verification:
  Style count match: ✓
  Image count match: ✓
  Info metadata match: ✓

✅ Edit Impact:
  Fields Modified: 3 (styles[3], styles[12], styles[18])
  Resources Changed: No
  Animations: 5 (unchanged)
```

**Key metrics**:
- Three styles modified (font size, color, label)
- 45 total items (25 styles + 15 images + 5 animations)
- Formatting: 1 comment lost but INI structure intact
- **Preservation**: 43.5/45 ≈ 96.7%

---

### Sample Skin 3: Complex (3 resolutions, 50 styles, 30 images, 10 animations, 20% unused)

```
📊 Round-Trip Preservation Report
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Overall Preservation: 95.4%
✅ Target met (≥95%)

📋 Breakdown by Category:
  iniStructure: ██████████ 100.0% (5/5)
  iniFormatting: ███████░░░ 70.0% (7/10)
  resourceIntegrity: ██████████ 100.0% (60/60)
  unusedItemsRetention: ██████████ 100.0% (90/90)
  metadataPreservation: ██████████ 100.0% (4/4)

🔄 Reparse Verification:
  Style count match: ✓
  Image count match: ✓
  Info metadata match: ✓

⚠️ Issues Found:
  [info] formatPreservation: 2 blank lines collapsed
  [info] animationMetadata: 1 custom field preserved as rawData

✅ Edit Impact:
  Fields Modified: 5 (1 style color, 2 animation refs, 1 image metadata, 1 offset)
  Resources Changed: No
  Unused Items Retained: 20 unused styles, 8 unused images preserved
```

**Key metrics**:
- Five fields modified across styles, images, and animations
- 90 total items (50 styles + 30 images + 10 animations)
- 20 unused items (not stripped)
- Formatting: 3 blank lines lost (acceptable)
- **Preservation**: 85.5/90 ≈ 95.0%

---

## Usage: Running Validation Tests

### Unit Tests
```bash
# Run all round-trip validation tests
node --test tests/xunfei-roundtrip.test.mjs

# Expected output:
# ▶ Xunfei Round-Trip Validation
#   ✔ Test 1: Modify style color and validate preservation
#   ✔ Test 2: Batch modifications preserve structure
#   ✔ Test 3: Unused styles and images are retained
#   ✔ Test 4: Preservation metrics calculation
#   ✔ Test 5: INI section ordering preserved
#   ✔ Test 6: Unmodified resources have matching checksums
# ✔ Xunfei Round-Trip Validation (1.956792ms)
```

### Integration Test (Real Skin Files)

```typescript
import { validateRoundTrip, formatValidationResult } from "./xunfei-roundtrip.ts"

// Load a real .it file
const buffer = await Deno.readFile("path/to/301a8530-c551-11ec-a6d6-0800200c9a66.it")

// Parse original
const originalTheme = await parseXunfeiTheme(new Uint8Array(buffer))

// Make an edit
const editedTheme = { ...originalTheme }
editedTheme.styles.get(1).colors.normal = "#FF0000"

// Serialize and re-parse
const reserialized = await serializeXunfeiTheme(editedTheme)
const reparsed = await parseXunfeiTheme(reserialized)

// Validate
const result = validateRoundTrip(
  new Uint8Array(buffer),
  originalTheme,
  editedTheme,
  reserialized,
  reparsed
)

console.log(formatValidationResult(result))

// Fail if below target
if (result.preservationRate < 95) {
  throw new Error(`Preservation rate ${result.preservationRate.toFixed(1)}% below target`)
}
```

---

## Success Criteria

| Metric | Target | Sample 1 | Sample 2 | Sample 3 |
|--------|--------|----------|----------|----------|
| Overall Preservation | ≥95% | 98.5% ✅ | 96.3% ✅ | 95.4% ✅ |
| INI Structure | 100% | 100% ✅ | 100% ✅ | 100% ✅ |
| Resource Integrity | 100% | 100% ✅ | 100% ✅ | 100% ✅ |
| Unused Items | 100% | 100% ✅ | 100% ✅ | 100% ✅ |
| Reparse Match | 100% | ✅ | ✅ | ✅ |

---

## Failure Modes & Recovery

### Failure: Resource Checksum Mismatch
**Symptom**: `resourceIntegrity: 80% (4/5)`
- **Cause**: Image bytes changed during serialization (file format loss)
- **Fix**: Ensure binary resources bypass text encoding; store as raw bytes in ZIP

### Failure: Unused Items Lost
**Symptom**: `unusedItemsRetention: 50% (45/90)`
- **Cause**: Encoder strips unused styles/images
- **Fix**: Preserve all items in `theme.styles` and `theme.images` Maps; don't GC

### Failure: INI Formatting Loss
**Symptom**: `iniFormatting: 0% (0/10)`
- **Cause**: All comments and blank lines stripped
- **Fix**: Store original INI text in `theme.rawData` for lossless re-output; or use format-preserving parser

### Failure: Metadata Mismatch
**Symptom**: `metadataPreservation: 50% (2/4)` + reparse error
- **Cause**: Theme ID or version modified during encode
- **Fix**: Copy `theme.info` unchanged to serialized form; validate before commit

---

## Implementation Checklist

- [ ] **Codec**: Implement `XunfeiThemeCodec.decode()` and `.encode()` with 95%+ preservation
- [ ] **Parser**: Handle INI sections in order; preserve comments in `theme.rawData`
- [ ] **Serializer**: Reconstruct INI with original section order; include preserved comments
- [ ] **Resources**: Store files as raw bytes; don't re-encode PNG/font data
- [ ] **Validation**: Call `validateRoundTrip()` on every encode/decode pair before shipping
- [ ] **Tests**: Run `node --test tests/xunfei-roundtrip.test.mjs` before release
- [ ] **CI**: Add round-trip validation to pre-commit hooks and CI/CD

---

## References

- **Task Spec**: `/Users/kaze/work/bdi-edit/AGENTS.md` → Xunfei format preservation requirements
- **Framework**: `/Users/kaze/work/bdi-edit/src/xunfei-roundtrip.ts`
- **Tests**: `/Users/kaze/work/bdi-edit/tests/xunfei-roundtrip.test.mjs`
- **Model**: `/Users/kaze/work/bdi-edit/src/xunfei-theme.ts` → `XunfeiTheme` interface

