// Print Ready — print production helpers for Sketch.
//
// Based on “Sketch for Print Design” by Sketch Tricks:
// https://medium.com/sketch-tricks/sketch-for-print-design-fd165b92cb3a
//
// Everything here hangs off one fact from that article: the Sketch canvas is
// 72 px per inch, so 1 px = 1 pt and a frame exported to PDF at 1× lands at
// exactly the right physical size on paper.

const sketch = require('sketch')
const UI = require('sketch/ui')
const Settings = require('sketch/settings')

// MARK: - Constants

const PT_PER_INCH = 72
const PT_PER_MM = 72 / 25.4

const GUIDES_LAYER_NAME = 'Print Guides'
const GUIDES_KEY = 'printReady.isGuides'
const SPEC_KEY = 'printReady.spec'
const PREFS_KEY = 'printReady.prefs'

const BLEED_COLOR = '#B0B0B0FF'
const TRIM_COLOR = '#FF00A8FF'
const SAFE_COLOR = '#0AA0FFFF'

// Tolerance, in points, for “is this edge on the line”. A third of a point is
// well below anything a press can hold.
const EPS = 0.34

// Preflight thresholds
const PPI_TARGET = 300
const PPI_FLOOR = 150
const HAIRLINE_MIN = 0.25 // pt — thinner than this can drop out on press
const MIN_FONT_SIZE = 5 // pt
const DELTA_E_LIMIT = 6 // perceptible shift once converted to CMYK
const TOTAL_INK_LIMIT = 320 // % — typical sheet-fed limit

// MARK: - Units

function toPt(value, unit) {
  return unit === 'mm' ? value * PT_PER_MM : value * PT_PER_INCH
}

function fromPt(pt, unit) {
  return unit === 'mm' ? pt / PT_PER_MM : pt / PT_PER_INCH
}

function round(value, decimals) {
  const factor = Math.pow(10, decimals === undefined ? 2 : decimals)
  return Math.round(value * factor) / factor
}

function formatSize(widthPt, heightPt, unit) {
  const decimals = unit === 'mm' ? 1 : 3
  return `${round(fromPt(widthPt, unit), decimals)} × ${round(
    fromPt(heightPt, unit),
    decimals
  )} ${unit}`
}

// MARK: - Paper presets
// Imperial sizes are stored in inches, ISO sizes in millimetres, so the numbers
// in the menu are the ones a printer would ask for.

const PRESETS = [
  { id: 'letter', group: 'us', name: 'US Letter', unit: 'in', w: 8.5, h: 11 },
  { id: 'legal', group: 'us', name: 'US Legal', unit: 'in', w: 8.5, h: 14 },
  { id: 'tabloid', group: 'us', name: 'US Tabloid', unit: 'in', w: 11, h: 17 },
  { id: 'a3', group: 'iso', name: 'A3', unit: 'mm', w: 297, h: 420 },
  { id: 'a4', group: 'iso', name: 'A4', unit: 'mm', w: 210, h: 297 },
  { id: 'a5', group: 'iso', name: 'A5', unit: 'mm', w: 148, h: 210 },
  { id: 'a6', group: 'iso', name: 'A6', unit: 'mm', w: 105, h: 148 },
  { id: 'dl', group: 'iso', name: 'DL Flyer', unit: 'mm', w: 99, h: 210 },
  { id: 'card-us', group: 'card', name: 'Business Card (US)', unit: 'in', w: 3.5, h: 2 },
  { id: 'card-eu', group: 'card', name: 'Business Card (EU)', unit: 'mm', w: 85, h: 55 },
  { id: 'postcard-a6', group: 'card', name: 'Postcard (A6)', unit: 'mm', w: 148, h: 105 },
  { id: 'postcard-us', group: 'card', name: 'Postcard (4 × 6)', unit: 'in', w: 6, h: 4 },
  { id: 'photo-5x7', group: 'card', name: 'Photo (5 × 7)', unit: 'in', w: 5, h: 7 },
  { id: 'square-5', group: 'card', name: 'Square (5 × 5)', unit: 'in', w: 5, h: 5 },
  { id: 'poster-a2', group: 'poster', name: 'Poster A2', unit: 'mm', w: 420, h: 594 },
  { id: 'poster-a1', group: 'poster', name: 'Poster A1', unit: 'mm', w: 594, h: 841 },
  { id: 'poster-18x24', group: 'poster', name: 'Poster (18 × 24)', unit: 'in', w: 18, h: 24 },
  { id: 'poster-24x36', group: 'poster', name: 'Poster (24 × 36)', unit: 'in', w: 24, h: 36 },
  { id: 'custom', group: 'custom', name: 'Custom size…', unit: 'in', w: 0, h: 0 },
]

function presetTitle(preset) {
  if (preset.id === 'custom') {
    return preset.name
  }
  const decimals = preset.unit === 'mm' ? 0 : 2
  return `${preset.name} — ${round(preset.w, decimals)} × ${round(
    preset.h,
    decimals
  )} ${preset.unit}`
}

function presetForTitle(title) {
  return PRESETS.filter((preset) => presetTitle(preset) === title)[0]
}

// Default bleed and safe margin, in the preset's own unit. 1/8 in and 3 mm are
// what most printers ask for.
function defaultBleed(unit) {
  return unit === 'mm' ? 3 : 0.125
}

function defaultMargin(unit) {
  return unit === 'mm' ? 5 : 0.125
}

// MARK: - Preferences

function prefs() {
  const stored = Settings.settingForKey(PREFS_KEY)
  return stored || {}
}

function savePrefs(values) {
  Settings.setSettingForKey(PREFS_KEY, Object.assign(prefs(), values))
}

// MARK: - AppKit form helpers
// The plugin builds its dialogs as NSAlert accessory views, so there is no
// build step and no web view to keep in sync.

const ROW_HEIGHT = 24
const ROW_GAP = 10
const LABEL_WIDTH = 130

function makeLabel(text, rect, isSecondary) {
  const label = NSTextField.alloc().initWithFrame(rect)
  label.setStringValue(String(text))
  label.setBezeled(false)
  label.setDrawsBackground(false)
  label.setEditable(false)
  label.setSelectable(false)
  label.setFont(NSFont.systemFontOfSize(12))
  if (isSecondary) {
    label.setTextColor(NSColor.secondaryLabelColor())
  }
  return label
}

function makeField(value, rect) {
  const field = NSTextField.alloc().initWithFrame(rect)
  field.setStringValue(String(value))
  field.setFont(NSFont.systemFontOfSize(12))
  return field
}

function makeCheckbox(title, rect, isChecked) {
  const checkbox = NSButton.alloc().initWithFrame(rect)
  checkbox.setButtonType(3) // NSSwitchButton
  checkbox.setTitle(String(title))
  checkbox.setFont(NSFont.systemFontOfSize(12))
  checkbox.setState(isChecked ? 1 : 0)
  return checkbox
}

function makePopUp(titles, rect, selectedTitle) {
  const popUp = NSPopUpButton.alloc().initWithFrame_pullsDown(rect, false)
  titles.forEach((title) => {
    if (title === '-') {
      popUp.menu().addItem(NSMenuItem.separatorItem())
    } else {
      popUp.addItemWithTitle(String(title))
    }
  })
  if (selectedTitle && popUp.itemWithTitle(selectedTitle)) {
    popUp.selectItemWithTitle(selectedTitle)
  }
  return popUp
}

// Rows are `{ label, control, controlWidth, suffix }`. A row with a control but
// no label (an empty string) lines up with the fields above it.
function buildForm(width, rows) {
  const height = rows.length * ROW_HEIGHT + (rows.length - 1) * ROW_GAP
  const view = NSView.alloc().initWithFrame(NSMakeRect(0, 0, width, height))

  rows.forEach((row, index) => {
    const y = height - (index + 1) * ROW_HEIGHT - index * ROW_GAP

    if (row.label) {
      view.addSubview(
        makeLabel(row.label, NSMakeRect(0, y + 4, LABEL_WIDTH - 8, 18))
      )
    }

    const x = row.label === undefined ? 0 : LABEL_WIDTH
    const controlWidth = row.controlWidth || width - x
    row.control.setFrame(NSMakeRect(x, y, controlWidth, ROW_HEIGHT - 2))
    view.addSubview(row.control)

    if (row.suffix) {
      view.addSubview(
        makeLabel(
          row.suffix,
          NSMakeRect(x + controlWidth + 6, y + 4, width - x - controlWidth - 6, 18),
          true
        )
      )
    }
  })

  return view
}

function runAlert(title, message, accessory, buttons) {
  const alert = NSAlert.alloc().init()
  alert.setMessageText(title)
  if (message) {
    alert.setInformativeText(message)
  }
  buttons.forEach((buttonTitle) => alert.addButtonWithTitle(buttonTitle))
  if (accessory) {
    alert.setAccessoryView(accessory)
    alert.window().setInitialFirstResponder(accessory)
  }
  // 1000 is NSAlertFirstButtonReturn, so this returns a 0-based button index.
  return Number(alert.runModal()) - 1000
}

function makeScrollingText(text, width, height) {
  const scrollView = NSScrollView.alloc().initWithFrame(
    NSMakeRect(0, 0, width, height)
  )
  scrollView.setHasVerticalScroller(true)
  scrollView.setBorderType(2) // NSBezelBorder

  const textView = NSTextView.alloc().initWithFrame(
    NSMakeRect(0, 0, width, height)
  )
  textView.setEditable(false)
  textView.setFont(NSFont.userFixedPitchFontOfSize(11))
  textView.setString(String(text))
  scrollView.setDocumentView(textView)

  return scrollView
}

function parseNumber(field, fallback) {
  const value = parseFloat(String(field.stringValue()).replace(',', '.'))
  return isNaN(value) || value < 0 ? fallback : value
}

// The inch mark, built from its character code on purpose. CocoaScript
// preprocesses this file before JavaScriptCore parses it and looks for string
// literals without understanding regex context, so a bare double quote inside a
// regex opens a string that never closes and the whole plugin silently fails to
// load. Keep this file free of double-quote characters.
const INCH_MARK = String.fromCharCode(34)

// Measurements carry their own unit — “3 mm”, “0.125 in”, “9 pt”. A bare number
// falls back to the unit passed in. This is deliberate: an NSAlert can't tell
// its fields that a unit popup changed, so reading the unit from elsewhere in
// the dialog is how you end up 25× out.
function readMeasure(field, fallbackValue, fallbackUnit) {
  const raw = String(field.stringValue()).trim().toLowerCase().replace(',', '.')

  // Split the leading number from whatever unit follows it, without a regex.
  let index = 0
  while (index < raw.length) {
    const character = raw.charAt(index)
    if ((character < '0' || character > '9') && character !== '.') {
      break
    }
    index += 1
  }

  const value = parseFloat(raw.substring(0, index))
  if (isNaN(value) || value < 0) {
    return { pt: toPt(fallbackValue, fallbackUnit), unit: fallbackUnit }
  }

  const suffix = raw.substring(index).split(' ').join('').split('\t').join('')

  if (suffix === 'mm') {
    return { pt: value * PT_PER_MM, unit: 'mm' }
  }
  if (suffix === 'cm') {
    return { pt: value * PT_PER_MM * 10, unit: 'mm' }
  }
  if (suffix === 'pt') {
    return { pt: value, unit: 'in' }
  }
  if (
    suffix === 'in' ||
    suffix === 'inch' ||
    suffix === 'inches' ||
    suffix === INCH_MARK
  ) {
    return { pt: value * PT_PER_INCH, unit: 'in' }
  }
  if (suffix === '') {
    return { pt: toPt(value, fallbackUnit), unit: fallbackUnit }
  }
  // An unrecognised unit is a typo, not a licence to guess.
  return { pt: toPt(fallbackValue, fallbackUnit), unit: fallbackUnit }
}

function measureLabel(value, unit) {
  return `${value} ${unit}`
}

// MARK: - Document helpers

function currentDocument() {
  const document = sketch.getSelectedDocument()
  if (!document) {
    UI.message('Open a document first.')
  }
  return document
}

// The frames to work on: the selected ones, or every canvas frame on the page.
function targetFrames(document) {
  const selected = document.selectedLayers.layers.filter(isFrameLike)
  if (selected.length) {
    return selected
  }
  return document.selectedPage.layers.filter(isFrameLike)
}

function isFrameLike(layer) {
  return layer.type === 'Artboard' || layer.type === 'Group'
    ? Boolean(layer.isFrame || layer.isGraphicFrame)
    : false
}

function isGuidesLayer(layer) {
  return (
    Settings.layerSettingForKey(layer, GUIDES_KEY) === true ||
    layer.name === GUIDES_LAYER_NAME
  )
}

function guidesLayer(frame) {
  return frame.layers.filter(isGuidesLayer)[0]
}

// A measurement out of the document, in points. Everything stored on a layer is
// whatever was in the file, so it arrives as data and not as a number: a string
// survives arithmetic by coercion right up until it meets `+`, where `100 + '3'`
// is '1003' rather than 103, and that lands in a TrimBox as a cut line metres off.
// Anything that isn't a finite, non-negative number is not a measurement.
function storedPt(value) {
  const number = Number(value)
  return isFinite(number) && number > 0 ? number : 0
}

// The bleed/margin a frame was set up with, falling back to 1/8 in of each. The
// stored value is validated here, once, so nothing downstream has to wonder.
function specForFrame(frame) {
  const stored = Settings.layerSettingForKey(frame, SPEC_KEY)
  if (stored) {
    return {
      unit: stored.unit === 'mm' ? 'mm' : 'in',
      bleedPt: storedPt(stored.bleedPt),
      marginPt: storedPt(stored.marginPt),
      presetId: stored.presetId,
    }
  }
  return { unit: 'in', bleedPt: 0, marginPt: toPt(0.125, 'in') }
}

function boxesForFrame(frame, spec) {
  const size = frame.frame
  const bleed = spec.bleedPt || 0
  const inset = bleed + (spec.marginPt || 0)
  return {
    width: size.width,
    height: size.height,
    trim: {
      left: bleed,
      top: bleed,
      right: size.width - bleed,
      bottom: size.height - bleed,
    },
    safe: {
      left: inset,
      top: inset,
      right: size.width - inset,
      bottom: size.height - inset,
    },
  }
}

function eachDescendant(layer, callback) {
  const children = layer.layers
  if (!children) {
    return
  }
  children.forEach((child) => {
    if (isGuidesLayer(child)) {
      return
    }
    callback(child)
    eachDescendant(child, callback)
  })
}

function rectInFrame(layer, frame) {
  try {
    return layer.frame.changeBasis({ from: layer.parent, to: frame })
  } catch (error) {
    return layer.frame
  }
}

function layerPath(layer, frame) {
  const names = [layer.name]
  let parent = layer.parent
  while (parent && parent.id !== frame.id && parent.type !== 'Page') {
    names.unshift(parent.name)
    parent = parent.parent
  }
  return names.join(' / ')
}

// MARK: - Print guides

function removePrintGuides(frame) {
  frame.layers.filter(isGuidesLayer).forEach((layer) => layer.remove())
}

function guideRect(name, x, y, width, height, color, dashPattern, position) {
  return new sketch.ShapePath({
    name: name,
    frame: new sketch.Rectangle(x, y, width, height),
    style: {
      fills: [],
      borders: [
        { color: color, thickness: 1, position: position || 'Center' },
      ],
      borderOptions: { dashPattern: dashPattern },
    },
  })
}

// A locked group holding the bleed edge, the trim line and the safe area, so
// the three lines a printer cares about are visible while designing. `Export
// for Print` hides this group automatically.
function addPrintGuides(frame, bleedPt, marginPt) {
  removePrintGuides(frame)

  const size = frame.frame
  // The bleed edge sits on the frame boundary, so its border has to be drawn
  // inside it. A centred one hangs half a point out into the canvas, and an
  // export is sized to everything it renders, so that half point would grow the
  // exported page beyond the frame.
  const shapes = [
    guideRect(
      'Bleed edge',
      0,
      0,
      size.width,
      size.height,
      BLEED_COLOR,
      [2, 2],
      'Inside'
    ),
  ]

  if (bleedPt > 0) {
    shapes.push(
      guideRect(
        'Trim',
        bleedPt,
        bleedPt,
        size.width - 2 * bleedPt,
        size.height - 2 * bleedPt,
        TRIM_COLOR,
        [6, 4]
      )
    )
  }

  const inset = bleedPt + marginPt
  if (marginPt > 0 && size.width - 2 * inset > 0 && size.height - 2 * inset > 0) {
    shapes.push(
      guideRect(
        'Safe area',
        inset,
        inset,
        size.width - 2 * inset,
        size.height - 2 * inset,
        SAFE_COLOR,
        [3, 3]
      )
    )
  }

  const group = new sketch.Group({
    parent: frame,
    name: GUIDES_LAYER_NAME,
    layers: shapes,
  })
  // A group built from a layers array keeps its default 100 × 100 bounds until
  // it's told to fit its contents.
  group.adjustToFit()
  group.locked = true
  Settings.setLayerSettingForKey(group, GUIDES_KEY, true)

  return group
}

// MARK: - Colour

function hexToRgb(hex) {
  const value = String(hex).replace('#', '')
  return {
    r: parseInt(value.substr(0, 2), 16) / 255,
    g: parseInt(value.substr(2, 2), 16) / 255,
    b: parseInt(value.substr(4, 2), 16) / 255,
    a: value.length >= 8 ? parseInt(value.substr(6, 2), 16) / 255 : 1,
  }
}

function channelHex(value) {
  const byte = Math.max(0, Math.min(255, Math.round(value * 255)))
  const text = byte.toString(16).toUpperCase()
  return text.length === 1 ? `0${text}` : text
}

function normalizeHex(hex) {
  return `#${String(hex).replace('#', '').substr(0, 6).toUpperCase()}`
}

function srgbToLab(rgb) {
  const linear = [rgb.r, rgb.g, rgb.b].map((channel) =>
    channel <= 0.04045
      ? channel / 12.92
      : Math.pow((channel + 0.055) / 1.055, 2.4)
  )

  // sRGB → XYZ (D65), then XYZ → Lab
  const x =
    (linear[0] * 0.4124 + linear[1] * 0.3576 + linear[2] * 0.1805) / 0.95047
  const y = linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722
  const z =
    (linear[0] * 0.0193 + linear[1] * 0.1192 + linear[2] * 0.9505) / 1.08883

  const f = (t) => (t > 0.008856 ? Math.pow(t, 1 / 3) : 7.787 * t + 16 / 116)
  return {
    l: 116 * f(y) - 16,
    a: 500 * (f(x) - f(y)),
    b: 200 * (f(y) - f(z)),
  }
}

function deltaE(first, second) {
  return Math.sqrt(
    Math.pow(first.l - second.l, 2) +
      Math.pow(first.a - second.a, 2) +
      Math.pow(first.b - second.b, 2)
  )
}

// MARK: - CMYK profiles
// The profiles that matter for print aren't ours to ship. Coated FOGRA39 and
// U.S. Web Coated (SWOP) are licensed to the applications that install them, and
// those are exactly the two a printer names. They're usually on the machine
// already though — Adobe and Affinity each carry a dozen, Ghostscript brings its
// own — so the plugin goes looking instead of keeping copies. ECI's profiles
// (eci.org) are the ones anyone may redistribute, and Choose… covers whatever a
// printer emails you.

const PROFILE_KEY = 'profilePath'
const CHOOSE_TITLE = 'Choose a profile file…'

function profileFolders() {
  // The home folder is expanded with NSString rather than NSHomeDirectory().
  // Clicking Profile… used to take Sketch down with it — EXC_BAD_ACCESS inside
  // CocoaScript's C-function invoke, releasing a garbage pointer — and that call
  // was the only C function on the path. Its BridgeSupport declaration is
  // identical to NSTemporaryDirectory(), which this file uses without trouble, so
  // the reason isn't obvious; a plain method call sidesteps the question.
  const home = String(
    NSString.stringWithString('~').stringByExpandingTildeInPath()
  )
  const folders = [
    '/System/Library/ColorSync/Profiles',
    '/Library/ColorSync/Profiles',
    `${home}/Library/ColorSync/Profiles`,
    '/Library/Application Support/Adobe/Color/Profiles',
    '/Library/Application Support/Adobe/Color/Profiles/Recommended',
    '/opt/homebrew/share/ghostscript/iccprofiles',
    '/usr/local/share/ghostscript/iccprofiles',
  ]

  // Affinity keeps a full set of press profiles inside each of its apps.
  const applications = NSFileManager.defaultManager().contentsOfDirectoryAtPath_error(
    '/Applications',
    null
  )
  const count = applications ? Number(applications.count()) : 0
  for (let index = 0; index < count; index += 1) {
    const name = String(applications.objectAtIndex(index))
    if (name.indexOf('Affinity') === 0) {
      folders.push(`/Applications/${name}/Contents/Resources`)
    }
  }
  return folders
}

// A profile names its colour space in its header, at bytes 16 to 19 — 'CMYK' for
// the ones worth listing, next to 'RGB ' and 'GRAY'. Reading twenty bytes answers
// that without asking AppKit to build a colour space for every profile installed,
// which is what the first version did: it took Sketch down on the first CMYK
// profile it reached, EXC_BAD_ACCESS releasing a garbage pointer under the call
// that read the profile's name. Nothing below loads a profile until one is picked.
function isCmykProfileFile(path) {
  const handle = NSFileHandle.fileHandleForReadingAtPath(path)
  if (!handle) {
    return false
  }
  let header = null
  try {
    header = handle.readDataOfLength(20)
  } catch (error) {
    return false
  } finally {
    handle.closeFile()
  }
  if (!header || Number(header.length()) < 20) {
    return false
  }
  const bytes = bytesFromData(header)
  return (
    String.fromCharCode(bytes[16], bytes[17], bytes[18], bytes[19]) === 'CMYK'
  )
}

// `CoatedFOGRA39.icc` reads better as `Coated FOGRA39`, and the file name is what
// a printer names anyway.
function profileLabel(name) {
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.substring(0, dot) : name
  const isUpper = (character) => character >= 'A' && character <= 'Z'
  const isLower = (character) => character >= 'a' && character <= 'z'
  const isDigit = (character) => character >= '0' && character <= '9'

  let spaced = ''
  for (let index = 0; index < stem.length; index += 1) {
    const character = stem.charAt(index)
    const previous = index > 0 ? stem.charAt(index - 1) : ''
    const next = index + 1 < stem.length ? stem.charAt(index + 1) : ''
    // `CoatedFOGRA39` → `Coated FOGRA39`, `USWebCoated` → `US Web Coated`. A run
    // of capitals stays together until a lower-case letter ends it, so FOGRA and
    // SWOP survive intact.
    const boundary =
      isUpper(character) &&
      (isLower(previous) ||
        isDigit(previous) ||
        (isUpper(previous) && isLower(next)))
    spaced += boundary ? ` ${character}` : character
  }
  return spaced.split('_').join(' ')
}

// The one place a colour space is built, for the profile actually in use. Built
// spaces are kept for the life of the command, so picking a profile twice hands
// back the same one instead of allocating a second and abandoning the first.
// Abandoning them is what makes this dangerous: switching profile and then
// switching back left an allocated colour space referenced by nothing, and the
// collection that eventually reclaimed it took Sketch down. Reuse means there is
// nothing to reclaim.
// Null prototype, like every lookup table here. The key is a file path, and on a
// plain object `__proto__` is not a key at all — the write is ignored and the read
// hands back Object.prototype, which is truthy. Nothing here is worth attacking,
// but a table whose keys come from outside should not answer for entries it was
// never given.
const spaceCache = Object.create(null)

function colorSpaceForProfile(path) {
  const key = String(path)
  if (spaceCache[key]) {
    return spaceCache[key]
  }
  try {
    const data = NSData.dataWithContentsOfFile(path)
    if (!data) {
      return null
    }
    const space = NSColorSpace.alloc().initWithICCProfileData(data)
    if (!space || Number(space.numberOfColorComponents()) !== 4) {
      return null
    }
    spaceCache[key] = space
    return space
  } catch (error) {
    return null
  }
}

function endsWith(text, suffix) {
  return text.length >= suffix.length &&
    text.lastIndexOf(suffix) === text.length - suffix.length
}

// Reading every profile in every folder isn't free, so the answer is kept for
// the life of the command.
let discoveredProfiles = null

function cmykProfiles() {
  if (discoveredProfiles) {
    return discoveredProfiles
  }

  const fileManager = NSFileManager.defaultManager()
  const seen = Object.create(null)
  const profiles = []

  try {
    collectProfiles(fileManager, seen, profiles)
  } catch (error) {
    // Finding none is survivable: the generic profile and Choose… still work.
    UI.message(`Couldn't read the installed profiles: ${error.message}`)
  }

  profiles.sort((first, second) => (first.name < second.name ? -1 : 1))
  discoveredProfiles = profiles
  return profiles
}

function collectProfiles(fileManager, seen, profiles) {
  profileFolders().forEach((folder) => {
    const names = fileManager.contentsOfDirectoryAtPath_error(folder, null)
    const count = names ? Number(names.count()) : 0
    for (let index = 0; index < count; index += 1) {
      const name = String(names.objectAtIndex(index))
      const lower = name.toLowerCase()
      if (!endsWith(lower, '.icc') && !endsWith(lower, '.icm')) {
        continue
      }
      const label = profileLabel(name)
      if (seen[label]) {
        continue
      }
      const path = `${folder}/${name}`
      if (!isCmykProfileFile(path)) {
        continue
      }
      seen[label] = true
      profiles.push({ name: label, path: path })
    }
  })
}

function genericProfile() {
  return {
    name: 'Generic CMYK',
    path: null,
    space: NSColorSpace.genericCMYKColorSpace(),
  }
}

// The profile in force, falling back to the system's generic one if what was
// chosen has since been moved or uninstalled.
function chosenProfile() {
  const saved = prefs()[PROFILE_KEY]
  if (saved) {
    const space = colorSpaceForProfile(saved)
    if (space) {
      return { name: profileLabel(fileName(saved)), path: saved, space: space }
    }
  }
  return genericProfile()
}

function chooseProfileFile() {
  const panel = NSOpenPanel.openPanel()
  panel.setCanChooseDirectories(false)
  panel.setCanChooseFiles(true)
  panel.setAllowsMultipleSelection(false)
  panel.setAllowedFileTypes(['icc', 'icm'])
  panel.setPrompt('Use Profile')
  panel.setMessage('Pick the ICC profile your printer asked for.')
  if (Number(panel.runModal()) !== 1) {
    return null
  }
  const path = String(panel.URL().path())
  const space = colorSpaceForProfile(path)
  if (!space) {
    UI.message('That file is not a CMYK profile.')
    return null
  }
  return { name: profileLabel(fileName(path)), path: path, space: space }
}

function askForProfile(current) {
  const generic = genericProfile()
  const profiles = cmykProfiles().filter(
    (profile) => profile.name !== generic.name
  )
  const titles = [generic.name]
  profiles.forEach((profile) => titles.push(profile.name))
  titles.push('-')
  titles.push(CHOOSE_TITLE)

  const popUp = makePopUp(titles, NSMakeRect(0, 0, 320, 22), current.name)
  const form = buildForm(440, [
    { label: 'CMYK profile', control: popUp, controlWidth: 300 },
  ])

  const clicked = runAlert(
    'Proof Against a Profile',
    'The gamut and ink figures describe whichever profile you pick, so use the one your printer names. Profiles installed by Adobe, Affinity and Ghostscript are listed next to the system ones; free ISO profiles are at eci.org.',
    form,
    ['Use Profile', 'Cancel']
  )
  if (clicked !== 0) {
    return null
  }

  const title = String(popUp.titleOfSelectedItem())
  if (title === CHOOSE_TITLE) {
    return chooseProfileFile()
  }
  if (title === generic.name) {
    return generic
  }
  const picked = profiles.filter((profile) => profile.name === title)[0]
  if (!picked) {
    return null
  }
  const space = colorSpaceForProfile(picked.path)
  return space ? { name: picked.name, path: picked.path, space: space } : null
}

// Round-trips a colour through the chosen CMYK profile: the CMYK values are what
// the colour becomes on press, the printed RGB is how that reads back on screen,
// and the ΔE says how far it moved getting there. Sketch itself always exports
// RGB.
function cmykInfo(hex, profile) {
  try {
    const rgb = hexToRgb(hex)
    const source = NSColor.colorWithSRGBRed_green_blue_alpha(
      rgb.r,
      rgb.g,
      rgb.b,
      1
    )
    const space = profile && profile.space ? profile.space : NSColorSpace.genericCMYKColorSpace()
    const cmyk = source.colorUsingColorSpace(space)
    if (!cmyk) {
      return null
    }

    const components = {
      c: Number(cmyk.cyanComponent()),
      m: Number(cmyk.magentaComponent()),
      y: Number(cmyk.yellowComponent()),
      k: Number(cmyk.blackComponent()),
    }

    const back = cmyk.colorUsingColorSpace(NSColorSpace.sRGBColorSpace())
    const printed = back
      ? {
          r: Number(back.redComponent()),
          g: Number(back.greenComponent()),
          b: Number(back.blueComponent()),
        }
      : rgb

    return {
      c: Math.round(components.c * 100),
      m: Math.round(components.m * 100),
      y: Math.round(components.y * 100),
      k: Math.round(components.k * 100),
      ink: Math.round(
        (components.c + components.m + components.y + components.k) * 100
      ),
      deltaE: deltaE(srgbToLab(rgb), srgbToLab(printed)),
      // What the colour reads back as on screen once the press has had it. The
      // hex a designer can set to see the printed result while still working.
      printed: normalizeHex(
        `${channelHex(printed.r)}${channelHex(printed.g)}${channelHex(printed.b)}`
      ),
    }
  } catch (error) {
    return null
  }
}

// Each colour is reported with a note of where it came from — which layer, whether
// it was a fill, a border or the text, and which one — rather than a closure that
// could set it. A closure would have to hold the fill or border itself, and those
// are throwaway wrappers around part of a style, not the layer. Keeping them alive
// across a dialog and into the next run left the collector holding objects nobody
// else did; the second time the profile changed, enough of them had been orphaned
// for a garbage collection to release them, and Sketch went down on the pointer.
// A layer is safe to hold — the document owns it — so that is all this keeps.
function collectColors(layer, sink) {
  const style = layer.style
  if (!style) {
    return
  }

  const fills = style.fills || []
  fills.forEach((fill, index) => {
    if (fill.enabled && fill.fillType === 'Color') {
      sink(fill.color, layer, { layer: layer, kind: 'fill', index: index })
    }
  })

  const borders = style.borders || []
  borders.forEach((border, index) => {
    if (border.enabled && border.fillType === 'Color') {
      sink(border.color, layer, { layer: layer, kind: 'border', index: index })
    }
  })

  if (layer.type === 'Text' && style.textColor) {
    sink(style.textColor, layer, { layer: layer, kind: 'text', index: 0 })
  }
}

// MARK: - Export geometry
// An export's page isn't quite its frame. Read the MediaBox off any exported PDF
// and it is a whole number of points, a fraction wider and taller than the frame
// it was made from, and the strip left over is never painted: a white line along
// the edge in Affinity and Acrobat, a transparent one in a PNG. Measuring the
// trim down from that page carries the error into the cut line, so both exporters
// find where the artwork sits inside the page and trim back to it.

function absoluteRect(layer) {
  try {
    // Omitting `to` converts to the canvas, the basis a frame is exported in.
    return layer.frame.changeBasis({ from: layer.parent })
  } catch (error) {
    return layer.frame
  }
}

function exportGeometry(frame) {
  const rect = absoluteRect(frame)
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
}

function intersectRect(rect, bounds) {
  const left = Math.max(rect.x, bounds.x)
  const top = Math.max(rect.y, bounds.y)
  const right = Math.min(rect.x + rect.width, bounds.x + bounds.width)
  const bottom = Math.min(rect.y + rect.height, bounds.y + bounds.height)
  return { x: left, y: top, width: right - left, height: bottom - top }
}

// Half a point of give, so a page that came out a hair smaller than the frame
// still counts as containing it.
const EDGE_EPS = 0.05

// More than this much page around the frame isn't rounding.
const MAX_PAGE_SLACK = 2

// How far the artwork sits from the leading edge of the page it was exported on.
// Page sizes come out as whole points, so a page's edges are the whole points
// either side of its frame's. Given the size a file actually came out at, only
// one whole point can be the leading edge, and that places the artwork — without
// assuming anything about how the size was picked. `slop` allows for a page
// measured in whole pixels rather than whole points.
function artworkOffset(position, extent, page, slop) {
  const slack = page - extent
  if (slack < -EDGE_EPS || slack > MAX_PAGE_SLACK + slop) {
    // Not rounding, then: something renders outside the frame — a frame that
    // doesn't clip its content, or a shadow past its edge — and there's no
    // saying where in the page the artwork ended up.
    return null
  }
  const offset = position - Math.floor(position)
  // If the artwork wouldn't fit at that offset, the page starts on the next
  // whole point up instead and the artwork begins at its very edge.
  return offset <= slack + EDGE_EPS ? offset : Math.max(0, offset - 1)
}

function artworkInPage(geometry, pageWidth, pageHeight, slop) {
  const left = artworkOffset(geometry.x, geometry.width, pageWidth, slop)
  const top = artworkOffset(geometry.y, geometry.height, pageHeight, slop)
  if (left === null || top === null) {
    return null
  }
  return {
    left: left,
    top: top,
    // PDF counts up from the bottom of the page.
    bottom: pageHeight - top - geometry.height,
  }
}

// MARK: - Raster export
// Exported rasters come out tagged 72 DPI, which is why the article has you fix
// the size by hand in Photoshop. Exporting one frame at a time into a temporary
// folder lets the plugin restamp the resolution and give the file a predictable
// name, so it opens at the right physical size with every pixel intact.

function safeFileName(name) {
  return String(name).replace(/[\/:]/g, '-')
}

// Finder's convention for a name that's already taken: artwork-2.pdf, then -3.
function uniquePath(path) {
  const fileManager = NSFileManager.defaultManager()
  if (!fileManager.fileExistsAtPath(path)) {
    return path
  }

  const dot = path.lastIndexOf('.')
  const slash = path.lastIndexOf('/')
  const hasExtension = dot > slash
  const stem = hasExtension ? path.substring(0, dot) : path
  const extension = hasExtension ? path.substring(dot) : ''

  let index = 2
  while (fileManager.fileExistsAtPath(`${stem}-${index}${extension}`)) {
    index += 1
  }
  return `${stem}-${index}${extension}`
}

function temporaryDirectory() {
  const path = `${String(NSTemporaryDirectory())}print-ready-${Date.now()}`
  NSFileManager.defaultManager().createDirectoryAtPath_withIntermediateDirectories_attributes_error(
    path,
    true,
    null,
    null
  )
  return path
}

// A subimage shares the pixels it came from, so this is a crop rather than a
// redraw: nothing is resampled and the colour profile survives untouched.
function cropImage(source, x, y, width, height) {
  let cropped = null
  let rep = null

  try {
    const cgImage = source.CGImage()
    if (!cgImage) {
      return null
    }
    cropped = CGImageCreateWithImageInRect(
      cgImage,
      NSMakeRect(x, y, width, height)
    )
    rep = cropped ? NSBitmapImageRep.alloc().initWithCGImage(cropped) : null
  } catch (error) {
    // An uncropped file is still a correct export, just on the page it came out
    // on, so a bridge that can't reach CoreGraphics loses the trim and nothing
    // else.
    return null
  }

  if (cropped) {
    // CocoaScript reads `already_retained` out of BridgeSupport but never acts
    // on it, so a Create call hands over a reference nothing else will drop —
    // and a full-size image is tens of megabytes per file.
    try {
      CGImageRelease(cropped)
    } catch (error) {
      // Leaking one reference beats losing the crop.
    }
  }

  return rep
}

// MARK: - PNG resolution
// AppKit derives the resolution it writes from the image's size in points and
// rounds each axis on its own, so 300 PPI comes out as 11813 pixels per metre
// across by 11812 down — non-square pixels, which Affinity Photo refuses and
// falls back to 72 DPI over, while Preview and sips tolerate and report as 300.
// It writes a second copy into an eXIf chunk that rounds differently again and
// that Apple's readers prefer, so one export can report three resolutions.
//
// So the chunk is written here instead. Only the handful of small chunks ahead
// of the pixels are read, and the pixels are copied straight across, so the
// image data never passes through JavaScript.

// Enough for the chunks that precede the pixels. A colour profile can be large,
// so this is a ceiling rather than an expectation.
const MAX_PNG_HEADER = 1 << 20

const BASE64 =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

// Bytes travel to and from NSData as base64: it is plain ASCII, so nothing in
// the trip depends on a string encoding surviving a NUL or a high byte.
function bytesToBase64(bytes) {
  let text = ''
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index]
    const second = bytes[index + 1]
    const third = bytes[index + 2]
    const hasSecond = index + 1 < bytes.length
    const hasThird = index + 2 < bytes.length
    text += BASE64.charAt(first >> 2)
    text += BASE64.charAt(((first & 3) << 4) | (hasSecond ? second >> 4 : 0))
    text += hasSecond
      ? BASE64.charAt(((second & 15) << 2) | (hasThird ? third >> 6 : 0))
      : '='
    text += hasThird ? BASE64.charAt(third & 63) : '='
  }
  return text
}

function base64ToBytes(text) {
  const clean = String(text).split('\n').join('').split('\r').join('')
  const bytes = []
  for (let index = 0; index + 3 < clean.length; index += 4) {
    const first = BASE64.indexOf(clean.charAt(index))
    const second = BASE64.indexOf(clean.charAt(index + 1))
    const thirdChar = clean.charAt(index + 2)
    const fourthChar = clean.charAt(index + 3)
    const third = thirdChar === '=' ? -1 : BASE64.indexOf(thirdChar)
    const fourth = fourthChar === '=' ? -1 : BASE64.indexOf(fourthChar)
    bytes.push(((first << 2) | (second >> 4)) & 0xff)
    if (third >= 0) {
      bytes.push(((second << 4) | (third >> 2)) & 0xff)
    }
    if (fourth >= 0) {
      bytes.push(((third << 6) | fourth) & 0xff)
    }
  }
  return bytes
}

function dataFromBytes(bytes) {
  return NSData.alloc().initWithBase64EncodedString_options(
    bytesToBase64(bytes),
    0
  )
}

function bytesFromData(data) {
  return base64ToBytes(String(data.base64EncodedStringWithOptions(0)))
}

const CRC_TABLE = []

function crc32(bytes) {
  if (!CRC_TABLE.length) {
    for (let index = 0; index < 256; index += 1) {
      let value = index
      for (let bit = 0; bit < 8; bit += 1) {
        value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
      }
      CRC_TABLE.push(value >>> 0)
    }
  }
  let crc = 0xffffffff
  bytes.forEach((byte) => {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  })
  return (crc ^ 0xffffffff) >>> 0
}

function bigEndian32(value) {
  return [
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ]
}

function readBigEndian32(bytes, offset) {
  return (
    bytes[offset] * 16777216 +
    (bytes[offset + 1] << 16) +
    (bytes[offset + 2] << 8) +
    bytes[offset + 3]
  )
}

function physChunkBytes(ppi) {
  const type = [0x70, 0x48, 0x59, 0x73] // pHYs
  // The chunk counts whole pixels per metre, which is why an exact DPI isn't
  // always representable — 300 is 11811.02. Both axes get the same number, so
  // the pixels are square whatever the rounding does.
  const perMetre = Math.round(ppi / 0.0254)
  const body = bigEndian32(perMetre).concat(bigEndian32(perMetre), [1]) // 1: metres
  return bigEndian32(body.length).concat(
    type,
    body,
    bigEndian32(crc32(type.concat(body)))
  )
}

// Rebuilds the chunks ahead of the pixels: the resolution replaced with an exact
// one, the duplicate in eXIf dropped, everything else carried across. Returns
// null while there are still more bytes to read.
function rebuildPngHeader(bytes, ppi) {
  let kept = bytes.slice(0, 8) // signature
  let offset = 8
  let replaced = false

  while (offset + 8 <= bytes.length) {
    const length = readBigEndian32(bytes, offset)
    const type = String.fromCharCode(
      bytes[offset + 4],
      bytes[offset + 5],
      bytes[offset + 6],
      bytes[offset + 7]
    )
    const size = 12 + length

    if (type === 'IDAT') {
      if (!replaced) {
        kept = kept.concat(physChunkBytes(ppi))
      }
      return { bytes: kept, pixelsAt: offset }
    }
    if (length < 0 || size > MAX_PNG_HEADER) {
      return { bytes: null, pixelsAt: 0 }
    }
    if (offset + size > bytes.length) {
      return null // need more of the file
    }
    if (type === 'pHYs') {
      kept = kept.concat(physChunkBytes(ppi))
      replaced = true
    } else if (type !== 'eXIf') {
      kept = kept.concat(bytes.slice(offset, offset + size))
    }
    offset += size
  }
  return null
}

// Returns null when the resolution was written, or a short reason when it wasn't.
function normalizePngResolution(path, ppi) {
  const handle = NSFileHandle.fileHandleForReadingAtPath(path)
  if (!handle) {
    return 'could not open the file'
  }

  let header = null
  let pixels = null

  try {
    let bytes = []
    while (bytes.length < MAX_PNG_HEADER) {
      const block = handle.readDataOfLength(4096)
      if (!block || !Number(block.length())) {
        break
      }
      bytes = bytes.concat(bytesFromData(block))
      const rebuilt = rebuildPngHeader(bytes, ppi)
      if (rebuilt) {
        header = rebuilt
        break
      }
    }
    if (!header || !header.bytes) {
      return 'no pixel data found in the header'
    }
    handle.seekToFileOffset(header.pixelsAt)
    pixels = handle.readDataToEndOfFile()
  } catch (error) {
    return `reading it failed (${error.message})`
  } finally {
    handle.closeFile()
  }

  if (!pixels || !Number(pixels.length())) {
    return 'the pixel data came back empty'
  }

  const prefix = dataFromBytes(header.bytes)
  if (!prefix || Number(prefix.length()) !== header.bytes.length) {
    return 'the header would not encode'
  }

  const backup = NSData.dataWithContentsOfFile(path)
  const output = NSMutableData.data()
  output.appendData(prefix)
  output.appendData(pixels)
  if (!output.writeToFile_atomically(path, true)) {
    return 'writing it back failed'
  }

  // Byte surgery that produced something unreadable has to put the export back.
  if (!isTaggedAt(path, ppi)) {
    if (backup) {
      backup.writeToFile_atomically(path, true)
    }
    return 'the rewritten file did not read back at the right resolution'
  }
  return null
}

// Trims the never-painted strip off the edges and restamps the resolution. The
// crop is a whole number of pixels — four transparent columns at 300 PPI on the
// exports that carry them — taken straight out of the exported image.
function finishRaster(path, ppi, format, geometry) {
  try {
    const source = NSBitmapImageRep.imageRepWithContentsOfFile(path)
    if (!source) {
      // A reason, not `false`: a falsy note reads as success further up and the
      // file goes out unstamped without anything being said about it.
      return 'the exported file could not be read back'
    }

    const pixelsWide = Number(source.pixelsWide())
    const pixelsHigh = Number(source.pixelsHigh())
    // The same scale the export was asked for, so the sums below use the number
    // the file was actually rendered at.
    const scale = round(ppi / PT_PER_INCH, 5)

    let rep = source
    let wide = pixelsWide
    let high = pixelsHigh

    // The page back in points. It carries up to a pixel of rounding, which is
    // what the last argument allows for.
    const placed = artworkInPage(
      geometry,
      pixelsWide / scale,
      pixelsHigh / scale,
      1 / scale
    )

    if (placed) {
      const x = Math.round(placed.left * scale)
      const y = Math.round(placed.top * scale)
      const width = Math.min(Math.round(geometry.width * scale), pixelsWide - x)
      const height = Math.min(Math.round(geometry.height * scale), pixelsHigh - y)
      if (
        width > 0 &&
        height > 0 &&
        (width < pixelsWide || height < pixelsHigh)
      ) {
        const cropped = cropImage(source, x, y, width, height)
        if (cropped) {
          rep = cropped
          wide = width
          high = height
        }
      }
    }

    // The DPI a file reports is its pixel count over its size in points.
    rep.setSize(
      NSMakeSize((wide * PT_PER_INCH) / ppi, (high * PT_PER_INCH) / ppi)
    )
    const fileType = format === 'tiff' ? 0 : 4 // NSTIFFFileType / NSPNGFileType
    const data = rep.representationUsingType_properties(
      fileType,
      NSDictionary.dictionary()
    )
    if (!data || !data.writeToFile_atomically(path, true)) {
      return 'the file could not be rewritten'
    }
    if (format === 'png') {
      return normalizePngResolution(path, ppi)
    }
    return isTaggedAt(path, ppi)
      ? null
      : `it reads back at ${round(readDpi(path), 2)} DPI, not ${ppi}`
  } catch (error) {
    return `stamping it failed (${error.message})`
  }
}

// Reads the resolution back out of the finished file. An export arrives with no
// pHYs chunk at all, and every viewer calls an untagged PNG 72 DPI, so a stamp
// that quietly failed leaves a file that looks right and prints at the wrong
// size. Worth checking rather than trusting.
function readDpi(path) {
  try {
    const rep = NSBitmapImageRep.imageRepWithContentsOfFile(path)
    if (!rep) {
      return 0
    }
    const width = Number(rep.size().width)
    return width ? (Number(rep.pixelsWide()) * PT_PER_INCH) / width : 0
  } catch (error) {
    return 0
  }
}

function isTaggedAt(path, ppi) {
  // PNG stores whole pixels per metre, so what comes back is a rounding away
  // from what was asked for.
  return Math.abs(readDpi(path) - ppi) < 1
}

// Both exporters route through a temporary folder so the plugin owns the final
// filename: exporting straight into the chosen folder lets Sketch pick the name
// and replace whatever is already there.
// `claimed` records the names this run has already written to. Two frames can
// reduce to one file name — safeFileName turns both `Card 1/2` and `Card 1-2` into
// `Card 1-2` — and the overwrite prompt can't catch it, because it only asks about
// files that were in the folder beforehand. Replacing a file this same export just
// wrote is never what was meant, whatever was answered there, so a claimed name is
// numbered instead.
function moveIntoPlace(source, destination, keepBoth, claimed) {
  const fileManager = NSFileManager.defaultManager()
  const collides = Boolean(claimed && claimed[destination])
  const target = keepBoth || collides ? uniquePath(destination) : destination
  if (!keepBoth && !collides && fileManager.fileExistsAtPath(target)) {
    fileManager.removeItemAtPath_error(target, null)
  }
  fileManager.moveItemAtPath_toPath_error(source, target, null)
  if (claimed) {
    claimed[destination] = true
    claimed[target] = true
  }
  return target
}

// The export names more than one frame reduces to, and how many frames are caught
// up in them, so the run can say so before it writes anything. Counted by frame
// rather than by name because a document can easily have four frames sharing one
// name, and `used twice` would then be wrong.
function collidingNames(frames) {
  const counts = Object.create(null)
  frames.forEach((frame) => {
    const name = safeFileName(frame.name)
    counts[name] = (counts[name] || 0) + 1
  })

  const names = []
  let affected = 0
  Object.keys(counts).forEach((name) => {
    const count = counts[name]
    if (count > 1) {
      names.push(name)
      affected += count
    }
  })
  return { names: names, frames: affected }
}

// Everything Sketch actually wrote, wherever it put it. A slash in a layer name is
// a path separator to the exporter, not a character: a frame called `Card 1/2`
// exports as a file `2@4x.png` inside a folder `Card 1`. Listing one level deep
// returned that folder, which was then moved into place as though it were the
// export — leaving a directory named `Card 1-2-300ppi.tiff` with the real file
// buried inside it, unstamped and unreported. Walking the tree finds the file.
function exportedFiles(root) {
  const fileManager = NSFileManager.defaultManager()
  const files = []
  const folders = [root]

  while (folders.length) {
    const folder = folders.shift()
    const names = fileManager.contentsOfDirectoryAtPath_error(folder, null)
    const count = names ? Number(names.count()) : 0
    for (let index = 0; index < count; index += 1) {
      const name = String(names.objectAtIndex(index))
      if (name.indexOf('.') === 0) {
        continue
      }
      const path = `${folder}/${name}`
      const attributes = fileManager.attributesOfItemAtPath_error(path, null)
      const type = attributes
        ? String(attributes.objectForKey('NSFileType'))
        : ''
      if (type === 'NSFileTypeDirectory') {
        folders.push(path)
      } else {
        files.push(path)
      }
    }
  }

  return files
}

// A print PDF has to say where the paper gets cut. An exported one arrives with
// every box equal to its MediaBox, so the bleed carries no meaning downstream —
// a printer can't tell trim from bleed. PDFKit sets the boxes on the finished
// file without re-rendering it, so the vectors and any transparency come through
// untouched.
const PDF_BOX_MEDIA = 0
const PDF_BOX_CROP = 1
const PDF_BOX_BLEED = 2
const PDF_BOX_TRIM = 3
const PDF_BOX_ART = 4

// Returns whether the boxes ended up describing the artwork. Measuring the trim
// down from the MediaBox is what the first version did, which put the trim line
// up to a point out whenever the page came out wider than the frame. Everything
// here is measured from the frame's own rect instead.
function setPdfBoxes(path, bleedPt, geometry) {
  const bleed = bleedPt > 0 ? bleedPt : 0

  try {
    const document = PDFDocument.alloc().initWithURL(NSURL.fileURLWithPath(path))
    if (!document) {
      return false
    }

    const pages = Number(document.pageCount())
    if (!pages) {
      return false
    }

    for (let index = 0; index < pages; index += 1) {
      const page = document.pageAtIndex(index)
      const media = page.boundsForBox(PDF_BOX_MEDIA)
      const bounds = {
        x: Number(media.origin.x),
        y: Number(media.origin.y),
        width: Number(media.size.width),
        height: Number(media.size.height),
      }

      // The MediaBox is the page as exported, measured in points already.
      const placed = artworkInPage(geometry, bounds.width, bounds.height, 0)

      if (!placed) {
        // Leave the file exactly as exported. Insetting this page by the bleed
        // would stamp a cut line onto it that a press would work to, and it
        // would be wrong by however far the overflow reaches — a 105 × 148 mm
        // postcard behind a big shadow claimed a 226 × 269 mm trim. No TrimBox
        // at all is the safer of the two wrong answers, and the export says so.
        return false
      }

      const artwork = intersectRect(
        {
          x: bounds.x + placed.left,
          y: bounds.y + placed.bottom,
          width: geometry.width,
          height: geometry.height,
        },
        bounds
      )

      const width = artwork.width - 2 * bleed
      const height = artwork.height - 2 * bleed
      if (width <= 0 || height <= 0) {
        return false
      }

      const artworkRect = NSMakeRect(
        artwork.x,
        artwork.y,
        artwork.width,
        artwork.height
      )
      const trimRect = NSMakeRect(
        artwork.x + bleed,
        artwork.y + bleed,
        width,
        height
      )

      // Cropping to the artwork is what clears the white line: a viewer shows
      // the CropBox and a press works to the MediaBox, so both have to stop
      // where the artwork does rather than at the page edge. With no
      // bleed all five boxes coincide, which is the honest answer — there is no
      // bleed to tell apart from the trim.
      page.setBounds_forBox(artworkRect, PDF_BOX_MEDIA)
      page.setBounds_forBox(artworkRect, PDF_BOX_CROP)
      page.setBounds_forBox(artworkRect, PDF_BOX_BLEED)
      page.setBounds_forBox(trimRect, PDF_BOX_TRIM)
      page.setBounds_forBox(trimRect, PDF_BOX_ART)
    }

    return Boolean(document.writeToFile(path))
  } catch (error) {
    // The export itself worked; missing boxes aren't worth failing it over.
    return false
  }
}

function exportPdf(frame, output, keepBoth, claimed) {
  const fileManager = NSFileManager.defaultManager()
  const temp = temporaryDirectory()
  const bleedPt = specForFrame(frame).bleedPt || 0
  const geometry = exportGeometry(frame)
  let written = null
  let note = 'nothing was exported'

  try {
    sketch.export(frame, {
      formats: 'pdf',
      scales: '1',
      output: temp,
      overwriting: true,
    })

    exportedFiles(temp).forEach((source) => {
      written = moveIntoPlace(
        source,
        `${output}/${safeFileName(frame.name)}.pdf`,
        keepBoth,
        claimed
      )
      note = setPdfBoxes(written, bleedPt, geometry)
        ? null
        : 'something renders outside the frame — a shadow, or content that is not clipped — so the page is bigger than the paper. The page boxes were left alone rather than marking a cut line in the wrong place. Clip the frame or pull the overflow inside, then export again.'
    })
  } finally {
    fileManager.removeItemAtPath_error(temp, null)
  }

  return { path: written, note: note }
}

function exportRaster(frame, format, ppi, output, keepBoth, claimed) {
  const fileManager = NSFileManager.defaultManager()
  const temp = temporaryDirectory()
  const geometry = exportGeometry(frame)
  let written = null
  let note = 'nothing was exported'

  try {
    sketch.export(frame, {
      formats: format,
      scales: String(round(ppi / PT_PER_INCH, 5)),
      output: temp,
      overwriting: true,
    })

    exportedFiles(temp).forEach((source) => {
      note = finishRaster(source, ppi, format, geometry)
      written = moveIntoPlace(
        source,
        `${output}/${safeFileName(frame.name)}-${ppi}ppi.${format}`,
        keepBoth,
        claimed
      )
    })
  } finally {
    fileManager.removeItemAtPath_error(temp, null)
  }

  return { path: written, note: note }
}

function fileName(path) {
  const text = String(path)
  return text.substring(text.lastIndexOf('/') + 1)
}

function collectProblem(result, sink) {
  if (result.path && result.note) {
    sink.push(`${fileName(result.path)} — ${result.note}`)
  }
}

// The names both exporters will write to, so a clash can be raised before
// anything is overwritten.
function plannedFiles(frames, output, formats, ppi) {
  const paths = []
  frames.forEach((frame) => {
    const stem = `${output}/${safeFileName(frame.name)}`
    if (formats.pdf) {
      paths.push(`${stem}.pdf`)
    }
    if (formats.png) {
      paths.push(`${stem}-${ppi}ppi.png`)
    }
    if (formats.tiff) {
      paths.push(`${stem}-${ppi}ppi.tiff`)
    }
  })
  return paths
}

// MARK: - Preflight

function issue(severity, message) {
  return { severity: severity, message: message }
}

// Measured from the image's own file data. The NSImage the API hands back can be
// a 2× render of the layer rather than the original, and for a file tagged above
// 72 DPI its size describes points rather than pixels — either one gives the
// wrong effective resolution.
function imagePixelSize(layer) {
  try {
    const data = layer.image.nsdata
    const representation = data ? NSBitmapImageRep.imageRepWithData(data) : null
    if (!representation) {
      return null
    }
    return {
      width: Number(representation.pixelsWide()),
      height: Number(representation.pixelsHigh()),
    }
  } catch (error) {
    return null
  }
}

function checkLayer(layer, frame, boxes, spec, issues) {
  const rect = rectInFrame(layer, frame)
  const right = rect.x + rect.width
  const bottom = rect.y + rect.height
  const name = layerPath(layer, frame)

  const reachesBleed =
    rect.x <= EPS &&
    rect.y <= EPS &&
    right >= boxes.width - EPS &&
    bottom >= boxes.height - EPS

  const outsideSafe =
    rect.x < boxes.safe.left - EPS ||
    rect.y < boxes.safe.top - EPS ||
    right > boxes.safe.right + EPS ||
    bottom > boxes.safe.bottom + EPS

  const crossesTrim =
    rect.x < boxes.trim.left - EPS ||
    rect.y < boxes.trim.top - EPS ||
    right > boxes.trim.right + EPS ||
    bottom > boxes.trim.bottom + EPS

  if (!reachesBleed && outsideSafe) {
    if (layer.type === 'Text') {
      issues.push(
        issue(
          'warning',
          `${name} — text reaches into the safe margin. Keep type at least ${round(
            fromPt(spec.marginPt || 0, spec.unit),
            3
          )} ${spec.unit} inside the trim so a trimming slip can’t clip it.`
        )
      )
    } else if (crossesTrim) {
      issues.push(
        issue(
          'warning',
          `${name} — crosses the trim line but stops before the bleed edge. Extend it to the bleed edge, or pull it inside the trim.`
        )
      )
    } else {
      issues.push(
        issue('info', `${name} — sits between the safe margin and the trim line.`)
      )
    }
  }

  if (layer.type === 'Image') {
    const pixels = imagePixelSize(layer)
    if (!pixels) {
      // Say so rather than skipping: an unmeasured image must not read as a pass.
      issues.push(
        issue(
          'info',
          `${name} — couldn’t read the pixel dimensions, so its resolution is unchecked.`
        )
      )
    } else if (rect.width > 0 && rect.height > 0) {
      const ppi = Math.min(
        pixels.width / (rect.width / PT_PER_INCH),
        pixels.height / (rect.height / PT_PER_INCH)
      )
      const rounded = Math.round(ppi)
      if (ppi < PPI_FLOOR) {
        issues.push(
          issue(
            'error',
            `${name} — ${rounded} PPI at this size (${pixels.width} × ${pixels.height} px). Below ${PPI_FLOOR} PPI it will look soft in print.`
          )
        )
      } else if (ppi < PPI_TARGET) {
        issues.push(
          issue(
            'warning',
            `${name} — ${rounded} PPI at this size (${pixels.width} × ${pixels.height} px). Aim for ${PPI_TARGET} PPI.`
          )
        )
      }
    }
  }

  if (layer.type === 'Text') {
    const fontSize = layer.style ? layer.style.fontSize : undefined
    if (fontSize && fontSize < MIN_FONT_SIZE) {
      issues.push(
        issue(
          'warning',
          `${name} — ${round(fontSize, 1)} pt type. Under ${MIN_FONT_SIZE} pt is hard to hold on press.`
        )
      )
    }
  }

  const borders = layer.style ? layer.style.borders || [] : []
  borders.forEach((border) => {
    if (border.enabled && border.thickness > 0 && border.thickness < HAIRLINE_MIN) {
      issues.push(
        issue(
          'warning',
          `${name} — ${round(border.thickness, 3)} pt border. Hairlines under ${HAIRLINE_MIN} pt can break up or disappear.`
        )
      )
    }
  })
}

// Colour issues are found per colour rather than per layer, so the layers using
// a flagged colour have to be marked affected explicitly — otherwise the report
// names them and “Select Affected Layers” can't find them.
function checkColors(colorUsage, issues, markAffected, profile, corrections, proofed) {
  Object.keys(colorUsage).forEach((hex) => {
    const usage = colorUsage[hex]
    const info = cmykInfo(hex, profile)
    if (!info) {
      return
    }

    const names = usage.names.slice(0, 3).join(', ')
    const more =
      usage.names.length > 3 ? ` +${usage.names.length - 3} more` : ''
    const recipe = `C${info.c} M${info.m} Y${info.y} K${info.k}`

    const flag = (message) => {
      issues.push(issue('warning', message))
      usage.layers.forEach(markAffected)
    }

    if (info.deltaE >= DELTA_E_LIMIT && proofed.indexOf(hex) !== -1) {
      // This colour has already been set to what the press prints, so what's left
      // isn't a shift waiting to happen — it's the profile's round trip failing to
      // be reversible, which is a fact about the measurement and not about the
      // artwork. Warning again would be a dead end: correcting it a second time is
      // refused, and rightly, so there would be nothing to do about it.
      issues.push(
        issue(
          'info',
          `${hex} — already matched to ${profile.name}; it prints as ${recipe}. Used by: ${names}${more}`
        )
      )
    } else if (info.deltaE >= DELTA_E_LIMIT) {
      flag(
        `${hex} — outside the CMYK gamut (ΔE ${round(info.deltaE, 1)}); it will print duller as ${recipe}, nearer ${info.printed}. Used by: ${names}${more}`
      )
      // Setting the colour to what the press will make of it is the one shift
      // that removes the surprise: the screen stops promising something the ink
      // can't do. Only gamut is worth offering — see below for why ink isn't.
      if (info.printed !== hex) {
        corrections.push({
          hex: hex,
          printed: info.printed,
          uses: usage.uses,
        })
      }
    }

    if (info.ink > TOTAL_INK_LIMIT) {
      flag(
        `${hex} — ${info.ink}% total ink (${recipe}) is over the ${TOTAL_INK_LIMIT}% most presses allow. Used by: ${names}${more}`
      )
      // Deliberately not offered as a correction. The printed colour round-trips
      // to much the same recipe, so applying it would leave the coverage where it
      // was while looking like a fix. Over-inking is solved by choosing a lighter
      // colour or a different black build, not by nudging RGB.
    }
  })
}

function preflightFrame(frame, profile, proofed) {
  const spec = specForFrame(frame)
  const boxes = boxesForFrame(frame, spec)
  const issues = []
  const colorUsage = Object.create(null)
  const affected = []

  // Deduplicated by layer id, not by wrapper identity: the JS API hands out a
  // fresh wrapper object each time, so the same layer reached twice would
  // otherwise be selected twice.
  const seen = Object.create(null)
  const markAffected = (layer) => {
    // Not named `id`: CocoaScript reads a bare `id` as the Objective-C type and
    // rewrites the declaration to `const var`, which doesn't parse — so the whole
    // plugin silently fails to load. 2026.2 doesn't do this; 2026.1, the oldest
    // build supported, does.
    const layerId = String(layer.id)
    if (seen[layerId]) {
      return
    }
    seen[layerId] = true
    affected.push(layer)
  }

  const sink = (color, layer, use) => {
    const hex = normalizeHex(color)
    if (!colorUsage[hex]) {
      colorUsage[hex] = { names: [], layers: [], uses: [] }
    }
    if (colorUsage[hex].names.indexOf(layer.name) === -1) {
      colorUsage[hex].names.push(layer.name)
    }
    colorUsage[hex].layers.push(layer)
    if (use) {
      colorUsage[hex].uses.push(use)
    }
  }

  eachDescendant(frame, (layer) => {
    const before = issues.length
    checkLayer(layer, frame, boxes, spec, issues)
    collectColors(layer, sink)
    if (issues.length > before) {
      markAffected(layer)
    }
  })

  collectColors(frame, sink)
  const corrections = []
  checkColors(colorUsage, issues, markAffected, profile, corrections, proofed || [])

  if (!spec.bleedPt) {
    issues.push(
      issue(
        'info',
        'No bleed recorded for this frame. Run “Add Bleed & Guides to Selection…” if the artwork runs to the paper edge.'
      )
    )
  } else if (spec.bleedPt < 4) {
    // Under about 1.5 mm no printer can hold the cut. Almost always a unit slip.
    issues.push(
      issue(
        'error',
        `Bleed is only ${round(spec.bleedPt, 2)} pt (${round(
          fromPt(spec.bleedPt, 'mm'),
          2
        )} mm). Printers normally want ⅛ in / 3 mm — check the unit you typed.`
      )
    )
  }

  return {
    frame: frame,
    spec: spec,
    issues: issues,
    affected: affected,
    corrections: corrections,
  }
}

const SEVERITY_ORDER = { error: 0, warning: 1, info: 2 }
const SEVERITY_LABEL = { error: '[ERROR]', warning: '[WARN ]', info: '[INFO ]' }

function preflightReport(results, profile) {
  const lines = []
  let errors = 0
  let warnings = 0

  results.forEach((result) => {
    const size = result.frame.frame
    const spec = result.spec
    const bleed = spec.bleedPt || 0
    const unit = spec.unit || 'in'

    lines.push(result.frame.name)
    lines.push(
      `  Document ${formatSize(size.width, size.height, unit)}` +
        (bleed
          ? `   Trim ${formatSize(
              size.width - 2 * bleed,
              size.height - 2 * bleed,
              unit
            )}   Bleed ${round(fromPt(bleed, unit), 3)} ${unit}`
          : '   No bleed')
    )
    lines.push('')

    if (!result.issues.length) {
      lines.push('  Nothing to flag.')
      lines.push('')
      return
    }

    result.issues
      .slice()
      .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
      .forEach((entry) => {
        if (entry.severity === 'error') {
          errors += 1
        } else if (entry.severity === 'warning') {
          warnings += 1
        }
        lines.push(`  ${SEVERITY_LABEL[entry.severity]} ${entry.message}`)
        // Each entry wraps over two or three lines in the dialog, so without a
        // gap the next one reads as a continuation of the last.
        lines.push('')
      })

    lines.push('')
  })

  lines.push(`Proofed against ${profile.name}.`)
  lines.push(
    'This is what the profile changes: the figures above, not the exported files.'
  )
  lines.push(
    'Exports stay RGB — a PNG cannot hold CMYK at all. Bringing colours into gamut'
  )
  lines.push(
    'makes the screen match the press instead; convert the PDF itself in Acrobat,'
  )
  lines.push('or hand it to your printer with this report.')

  return { text: lines.join('\n'), errors: errors, warnings: warnings }
}

// Colours already brought into gamut, kept per profile on the document. Applying
// a correction twice is actively harmful: the first pass sets a colour to what the
// press prints, which is the answer, but the round trip isn't reversible — the
// printed value converted again compresses a second time, so a red walks
// #E4002B → #D31C2D → #C4272F → #B72D30 a click at a time, each one further from
// what the press could actually have given. Rendering intent would fix that and
// NSColor doesn't expose it, so the record does instead. Changing profile means a
// different press, so those are tracked separately.
const PROOFED_KEY = 'printReady.proofed'

function proofedKey(profile) {
  return profile.path || 'generic'
}

function proofedColors(document, profile) {
  const stored = Settings.documentSettingForKey(document, PROOFED_KEY) || {}
  // The key goes in a variable on purpose. A subscript holding a call reads as an
  // Objective-C message send to CocoaScript's preprocessor, which rewrote
  // `stored[proofedKey(profile)]` into `storedproofedKey.(profile)()` and stopped
  // the whole file from parsing — every command silently did nothing.
  const key = proofedKey(profile)
  return stored[key] || []
}

function rememberProofed(document, profile, hexes) {
  const stored = Settings.documentSettingForKey(document, PROOFED_KEY) || {}
  const key = proofedKey(profile)
  const known = stored[key] || []
  hexes.forEach((hex) => {
    if (known.indexOf(hex) === -1) {
      known.push(hex)
    }
  })
  stored[key] = known
  Settings.setDocumentSettingForKey(document, PROOFED_KEY, stored)
}

// Sets every place a colour was used to what the press will actually make of it.
// Returns how many places changed. Nothing here touches an out-of-gamut colour
// twice: the same hex reached through three fills is one correction naming three
// places.
function applyCorrections(corrections) {
  let changed = 0
  corrections.forEach((correction) => {
    correction.uses.forEach((use) => {
      try {
        // The style is read fresh here rather than remembered, so nothing holds a
        // fill or a border for longer than it takes to set it.
        const style = use.layer.style
        if (!style) {
          return
        }
        if (use.kind === 'fill' && style.fills[use.index]) {
          style.fills[use.index].color = correction.printed
        } else if (use.kind === 'border' && style.borders[use.index]) {
          style.borders[use.index].color = correction.printed
        } else if (use.kind === 'text') {
          style.textColor = correction.printed
        } else {
          return
        }
        changed += 1
      } catch (error) {
        // A colour that won't take the change isn't worth failing the rest over.
      }
    })
  })
  return changed
}

// MARK: - Commands

var newPrintFrame = function () {
  const document = currentDocument()
  if (!document) {
    return
  }

  const saved = prefs()
  const titles = []
  let group = null
  PRESETS.forEach((preset) => {
    if (group !== null && preset.group !== group) {
      titles.push('-')
    }
    group = preset.group
    titles.push(presetTitle(preset))
  })

  const presetPopUp = makePopUp(titles, NSMakeRect(0, 0, 240, 22), saved.presetTitle)
  const orientationPopUp = makePopUp(
    ['Portrait', 'Landscape'],
    NSMakeRect(0, 0, 130, 22),
    saved.orientation || 'Portrait'
  )
  const startingPreset =
    presetForTitle(String(presetPopUp.titleOfSelectedItem())) || PRESETS[0]
  const bleedField = makeField(
    saved.bleed ||
      measureLabel(defaultBleed(startingPreset.unit), startingPreset.unit),
    NSMakeRect(0, 0, 90, 22)
  )
  const marginField = makeField(
    saved.margin ||
      measureLabel(defaultMargin(startingPreset.unit), startingPreset.unit),
    NSMakeRect(0, 0, 90, 22)
  )
  const countField = makeField(1, NSMakeRect(0, 0, 70, 22))
  const guidesCheckbox = makeCheckbox(
    'Add trim and safe-area guides',
    NSMakeRect(0, 0, 260, 22),
    saved.guides !== false
  )

  const form = buildForm(440, [
    { label: 'Paper size', control: presetPopUp, controlWidth: 280 },
    { label: 'Orientation', control: orientationPopUp, controlWidth: 150 },
    { label: 'Bleed', control: bleedField, controlWidth: 90, suffix: 'in, mm, cm or pt' },
    { label: 'Safe margin', control: marginField, controlWidth: 90, suffix: 'in, mm, cm or pt' },
    { label: 'Frames', control: countField, controlWidth: 90, suffix: 'side by side' },
    { label: '', control: guidesCheckbox, controlWidth: 290 },
  ])

  const clicked = runAlert(
    'New Print Frame',
    'The canvas is 72 px per inch, so 1 px = 1 pt and the frame exports to PDF at its real physical size. Bleed is added outside the paper size.',
    form,
    ['Create', 'Cancel']
  )
  if (clicked !== 0) {
    return
  }

  let preset = presetForTitle(String(presetPopUp.titleOfSelectedItem()))
  if (!preset) {
    return
  }

  if (preset.id === 'custom') {
    const custom = askForCustomSize()
    if (!custom) {
      return
    }
    preset = {
      id: 'custom',
      name: 'Custom',
      unit: custom.unit,
      w: custom.width,
      h: custom.height,
    }
  }

  const bleed = readMeasure(bleedField, defaultBleed(preset.unit), preset.unit)
  const margin = readMeasure(marginField, defaultMargin(preset.unit), preset.unit)
  const count = Math.max(1, Math.round(parseNumber(countField, 1)))
  const isLandscape = String(orientationPopUp.titleOfSelectedItem()) === 'Landscape'

  savePrefs({
    presetTitle: String(presetPopUp.titleOfSelectedItem()),
    orientation: String(orientationPopUp.titleOfSelectedItem()),
    bleed: String(bleedField.stringValue()),
    margin: String(marginField.stringValue()),
    guides: guidesCheckbox.state() === 1,
  })

  // Presets are stored in the orientation a printer quotes them in, so some
  // (business cards, postcards) are already landscape. Normalise to portrait
  // before applying the choice, or the popup is inverted for exactly those.
  // A custom size is used as typed — the user gave both numbers on purpose.
  const isCustom = preset.id === 'custom'
  const shortSide = isCustom ? preset.w : Math.min(preset.w, preset.h)
  const longSide = isCustom ? preset.h : Math.max(preset.w, preset.h)
  const trimWidth = toPt(isLandscape && !isCustom ? longSide : shortSide, preset.unit)
  const trimHeight = toPt(isLandscape && !isCustom ? shortSide : longSide, preset.unit)
  const bleedPt = bleed.pt
  const marginPt = margin.pt
  const width = round(trimWidth + 2 * bleedPt, 2)
  const height = round(trimHeight + 2 * bleedPt, 2)

  const page = document.selectedPage
  const origin = nextFreeSpot(page)
  const created = []

  for (let index = 0; index < count; index += 1) {
    const frame = new sketch.Group.Frame({
      parent: page,
      name:
        count > 1
          ? `${preset.name} ${index + 1}`
          : `${preset.name}${
              bleedPt
                ? ` + ${round(fromPt(bleedPt, bleed.unit), 3)} ${
                    bleed.unit
                  } bleed`
                : ''
            }`,
      frame: new sketch.Rectangle(
        origin.x + index * (width + 60),
        origin.y,
        width,
        height
      ),
    })

    Settings.setLayerSettingForKey(frame, SPEC_KEY, {
      unit: preset.unit,
      bleedPt: bleedPt,
      marginPt: marginPt,
      presetId: preset.id,
    })

    if (guidesCheckbox.state() === 1) {
      addPrintGuides(frame, bleedPt, marginPt)
    }

    created.push(frame)
  }

  document.selectedLayers.clear()
  created.forEach((frame) => {
    frame.selected = true
  })
  document.centerOnLayer(created[0])

  UI.message(
    `${count > 1 ? `${count} frames` : preset.name} at ${formatSize(
      trimWidth,
      trimHeight,
      preset.unit
    )} trim${
      bleedPt
        ? `, ${round(fromPt(bleedPt, bleed.unit), 3)} ${bleed.unit} bleed`
        : ''
    }.`
  )
}

function askForCustomSize() {
  const widthField = makeField('5 in', NSMakeRect(0, 0, 90, 22))
  const heightField = makeField('7 in', NSMakeRect(0, 0, 90, 22))

  const form = buildForm(390, [
    { label: 'Trim width', control: widthField, controlWidth: 90, suffix: 'in, mm, cm or pt' },
    { label: 'Trim height', control: heightField, controlWidth: 90, suffix: 'in, mm, cm or pt' },
  ])

  const clicked = runAlert(
    'Custom Trim Size',
    'The finished size after trimming. Bleed is added outside it.',
    form,
    ['OK', 'Cancel']
  )
  if (clicked !== 0) {
    return null
  }

  const width = readMeasure(widthField, 0, 'in')
  const height = readMeasure(heightField, 0, 'in')
  if (width.pt <= 0 || height.pt <= 0) {
    UI.message('That trim size isn’t valid.')
    return null
  }

  // Hand back the size in the unit that was typed, so the frame's numbers read
  // the way it was specified.
  return {
    unit: width.unit,
    width: fromPt(width.pt, width.unit),
    height: fromPt(height.pt, width.unit),
  }
}

function nextFreeSpot(page) {
  const layers = page.layers
  if (!layers.length) {
    return { x: 0, y: 0 }
  }
  let maxX = -Infinity
  let minY = Infinity
  layers.forEach((layer) => {
    maxX = Math.max(maxX, layer.frame.x + layer.frame.width)
    minY = Math.min(minY, layer.frame.y)
  })
  return { x: Math.round(maxX + 120), y: Math.round(minY) }
}

var addBleed = function () {
  const document = currentDocument()
  if (!document) {
    return
  }

  const frames = document.selectedLayers.layers.filter(isFrameLike)
  if (!frames.length) {
    UI.message('Select one or more frames first.')
    return
  }

  const saved = prefs()
  const bleedField = makeField(
    saved.bleed || measureLabel(defaultBleed('in'), 'in'),
    NSMakeRect(0, 0, 90, 22)
  )
  const marginField = makeField(
    saved.margin || measureLabel(defaultMargin('in'), 'in'),
    NSMakeRect(0, 0, 90, 22)
  )
  const growCheckbox = makeCheckbox(
    'Grow the frame, keeping the current size as trim',
    NSMakeRect(0, 0, 320, 22),
    true
  )

  const form = buildForm(440, [
    { label: 'Bleed', control: bleedField, controlWidth: 90, suffix: 'in, mm, cm or pt' },
    { label: 'Safe margin', control: marginField, controlWidth: 90, suffix: 'in, mm, cm or pt' },
    { label: '', control: growCheckbox, controlWidth: 300 },
  ])

  const clicked = runAlert(
    frames.length > 1 ? `Add Bleed to ${frames.length} Frames` : 'Add Bleed & Guides',
    'Growing the frame moves the artwork with it, so what you have now becomes the trim area and the bleed sits outside it.',
    form,
    ['Apply', 'Cancel']
  )
  if (clicked !== 0) {
    return
  }

  const bleed = readMeasure(bleedField, defaultBleed('in'), 'in')
  const margin = readMeasure(marginField, defaultMargin('in'), 'in')
  const bleedPt = bleed.pt
  const marginPt = margin.pt
  const chosenUnit = bleed.unit
  savePrefs({
    bleed: String(bleedField.stringValue()),
    margin: String(marginField.stringValue()),
  })

  let grown = 0
  let adjusted = 0
  let refused = 0

  frames.forEach((frame) => {
    const existing = Settings.layerSettingForKey(frame, SPEC_KEY)
    const previousBleed = storedPt(existing && existing.bleedPt)
    // How much the bleed has to change by, rather than what it should become.
    // Growing a frame that already carried bleed used to be refused outright —
    // while the new figure was recorded anyway, so a frame still sized for 3 mm
    // could claim 5 mm and hand a press a cut line 4 mm inside the artwork.
    // Resizing by the difference keeps the trim where it is and the recorded
    // bleed true, and asking for the bleed a frame already has does nothing at
    // all instead of being a case of its own.
    const delta = bleedPt - previousBleed

    if (growCheckbox.state() === 1 && Math.abs(delta) > 0.005) {
      const rect = frame.frame
      const width = round(rect.width + 2 * delta, 2)
      const height = round(rect.height + 2 * delta, 2)

      if (width <= 0 || height <= 0) {
        // Taking that much bleed off would leave nothing to trim.
        refused += 1
      } else {
        // Where the artwork sits on the canvas, noted before the frame moves out
        // from under it. Resizing a frame can shift its children by itself, so
        // adding a fixed nudge afterwards lands them somewhere else again — it
        // left one image a whole bleed to the left, covering that edge and
        // leaving the opposite one bare. Putting each child back on the canvas
        // position it already had gives the same answer whatever the resize did.
        const anchors = frame.layers
          .filter((layer) => !isGuidesLayer(layer))
          .map((layer) => ({ layer: layer, rect: absoluteRect(layer) }))

        frame.frame = new sketch.Rectangle(
          round(rect.x - delta, 2),
          round(rect.y - delta, 2),
          width,
          height
        )

        anchors.forEach((anchor) => {
          const local = anchor.rect.changeBasis({ to: frame })
          anchor.layer.frame = new sketch.Rectangle(
            round(local.x, 2),
            round(local.y, 2),
            anchor.rect.width,
            anchor.rect.height
          )
        })

        if (previousBleed) {
          adjusted += 1
        } else {
          grown += 1
        }
      }
    }

    Settings.setLayerSettingForKey(frame, SPEC_KEY, {
      unit: chosenUnit,
      bleedPt: bleedPt,
      marginPt: marginPt,
      presetId: existing ? existing.presetId : 'custom',
    })

    addPrintGuides(frame, bleedPt, marginPt)
  })

  UI.message(
    `Bleed set on ${frames.length} frame${frames.length > 1 ? 's' : ''}.` +
      (grown ? ` ${grown} grown.` : '') +
      (adjusted
        ? ` ${adjusted} resized to the new bleed, trim unchanged.`
        : '') +
      (refused ? ` ${refused} left alone — that would leave no trim.` : '')
  )
}

var preflight = function () {
  const document = currentDocument()
  if (!document) {
    return
  }

  const frames = targetFrames(document)
  if (!frames.length) {
    UI.message('No frames on this page to check.')
    return
  }

  // The report depends on which profile is in force, so changing it re-runs the
  // check rather than trying to update a modal that's already on screen.
  let profile = chosenProfile()
  let showing = true

  while (showing) {
    showing = false

    const proofed = proofedColors(document, profile)
    const results = frames.map((frame) =>
      preflightFrame(frame, profile, proofed)
    )
    const report = preflightReport(results, profile)
    const affected = results.reduce(
      (all, result) => all.concat(result.affected),
      []
    )

    // The same colour can be out of gamut in several frames at once.
    const corrections = []
    const correctedHexes = {}
    results.forEach((result) => {
      result.corrections.forEach((correction) => {
        if (correctedHexes[correction.hex]) {
          const known = correctedHexes[correction.hex]
          known.uses = known.uses.concat(correction.uses)
          return
        }
        correctedHexes[correction.hex] = correction
        corrections.push(correction)
      })
    })


    const summary =
      report.errors || report.warnings
        ? `${report.errors} error${report.errors === 1 ? '' : 's'}, ${
            report.warnings
          } warning${report.warnings === 1 ? '' : 's'} across ${frames.length} frame${
            frames.length > 1 ? 's' : ''
          }.`
        : `${
            frames.length === 1 ? '1 frame looks' : `${frames.length} frames look`
          } ready to print.`

    const buttons = ['Done']
    const selectIndex = affected.length ? buttons.length : -1
    if (affected.length) {
      buttons.push(
        `Select ${affected.length} Affected Layer${affected.length > 1 ? 's' : ''}`
      )
    }
    const applyIndex = corrections.length ? buttons.length : -1
    if (corrections.length) {
      buttons.push(
        `Bring ${corrections.length} Colour${
          corrections.length > 1 ? 's' : ''
        } into Gamut`
      )
    }
    const profileIndex = buttons.length
    buttons.push('Profile…')

    const clicked = runAlert(
      'Preflight Check',
      `${summary} Proofed against ${profile.name}.`,
      makeScrollingText(report.text, 560, 320),
      buttons
    )

    if (clicked === selectIndex && affected.length) {
      document.selectedLayers.clear()
      affected.forEach((layer) => {
        layer.selected = true
      })
    } else if (clicked === applyIndex && corrections.length) {
      const changed = applyCorrections(corrections)
      rememberProofed(
        document,
        profile,
        corrections.map((correction) => correction.printed)
      )
      UI.message(
        `${corrections.length} colour${
          corrections.length > 1 ? 's' : ''
        } set to what ${profile.name} will print, in ${changed} place${
          changed === 1 ? '' : 's'
        }. Undo puts them back.`
      )
      // Run again so the report reflects the document as it now stands.
      showing = true
    } else if (clicked === profileIndex) {
      const picked = askForProfile(profile)
      if (picked) {
        profile = picked
        savePrefs({ profilePath: picked.path })
      }
      showing = true
    }
  }
}

var exportForPrint = function () {
  const document = currentDocument()
  if (!document) {
    return
  }

  const frames = targetFrames(document)
  if (!frames.length) {
    UI.message('No frames on this page to export.')
    return
  }

  const saved = prefs()
  const pdfCheckbox = makeCheckbox(
    'Vector PDF at 1× (real physical size)',
    NSMakeRect(0, 0, 320, 22),
    saved.pdf !== false
  )
  const pngCheckbox = makeCheckbox(
    'PNG at the resolution below',
    NSMakeRect(0, 0, 320, 22),
    Boolean(saved.png)
  )
  const tiffCheckbox = makeCheckbox(
    'TIFF at the resolution below',
    NSMakeRect(0, 0, 320, 22),
    Boolean(saved.tiff)
  )
  const ppiField = makeField(saved.ppi || PPI_TARGET, NSMakeRect(0, 0, 70, 22))
  const hideGuidesCheckbox = makeCheckbox(
    'Hide print guides in exports',
    NSMakeRect(0, 0, 320, 22),
    saved.hideGuides !== false
  )
  const revealCheckbox = makeCheckbox(
    'Show the files in Finder afterwards',
    NSMakeRect(0, 0, 320, 22),
    saved.reveal !== false
  )

  const form = buildForm(440, [
    { label: 'Formats', control: pdfCheckbox, controlWidth: 300 },
    { label: '', control: pngCheckbox, controlWidth: 300 },
    { label: '', control: tiffCheckbox, controlWidth: 300 },
    { label: 'Resolution', control: ppiField, controlWidth: 70, suffix: 'PPI' },
    { label: '', control: hideGuidesCheckbox, controlWidth: 300 },
    { label: '', control: revealCheckbox, controlWidth: 300 },
  ])

  const clicked = runAlert(
    `Export ${frames.length} Frame${frames.length > 1 ? 's' : ''} for Print`,
    'PDF at 1× keeps everything vector at the exact page size. Rasters are tagged with the resolution you set, so they open at the right physical size without resampling.',
    form,
    ['Choose Folder…', 'Cancel']
  )
  if (clicked !== 0) {
    return
  }

  const wantsPdf = pdfCheckbox.state() === 1
  const wantsPng = pngCheckbox.state() === 1
  const wantsTiff = tiffCheckbox.state() === 1
  if (!wantsPdf && !wantsPng && !wantsTiff) {
    UI.message('Pick at least one format.')
    return
  }

  const ppi = Math.max(72, Math.round(parseNumber(ppiField, PPI_TARGET)))

  savePrefs({
    pdf: wantsPdf,
    png: wantsPng,
    tiff: wantsTiff,
    ppi: ppi,
    hideGuides: hideGuidesCheckbox.state() === 1,
    reveal: revealCheckbox.state() === 1,
  })

  const panel = NSOpenPanel.openPanel()
  panel.setCanChooseDirectories(true)
  panel.setCanChooseFiles(false)
  panel.setCanCreateDirectories(true)
  panel.setAllowsMultipleSelection(false)
  panel.setPrompt('Export')
  panel.setMessage('Where should the print files go?')
  if (Number(panel.runModal()) !== 1) {
    return
  }
  const output = String(panel.URL().path())

  const formats = { pdf: wantsPdf, png: wantsPng, tiff: wantsTiff }
  const fileManager = NSFileManager.defaultManager()

  // Raised before the overwrite prompt, because it is a different question: these
  // frames would land on each other rather than on anything already in the folder.
  const collisions = collidingNames(frames)
  if (collisions.names.length) {
    const shownNames = collisions.names.slice(0, 4).join(', ')
    const moreNames =
      collisions.names.length > 4
        ? ` and ${collisions.names.length - 4} more`
        : ''
    const collisionChoice = runAlert(
      `${collisions.frames} Frames Would Overwrite Each Other`,
      `They all export as ${shownNames}${moreNames}. A slash or a colon in a frame name becomes a dash in the file name, and identically named frames collide outright, so frames that read differently on the canvas can end up as one file. Numbering keeps them all; without it only the last one would survive.`,
      null,
      ['Number Them', 'Cancel']
    )
    if (collisionChoice !== 0) {
      return
    }
  }

  const clashes = plannedFiles(frames, output, formats, ppi).filter((path) =>
    fileManager.fileExistsAtPath(path)
  )

  let keepBoth = false
  if (clashes.length) {
    const shown = clashes
      .slice(0, 4)
      .map((path) => path.substring(path.lastIndexOf('/') + 1))
    const more = clashes.length > 4 ? ` and ${clashes.length - 4} more` : ''
    const choice = runAlert(
      `${clashes.length} File${clashes.length > 1 ? 's' : ''} Already There`,
      `${shown.join(', ')}${more} already exist in that folder. Keeping both adds a number to the new files, the way Finder does.`,
      null,
      ['Keep Both', 'Replace', 'Cancel']
    )
    if (choice === 2) {
      return
    }
    keepBoth = choice === 0
  }

  const hidden = []
  if (hideGuidesCheckbox.state() === 1) {
    frames.forEach((frame) => {
      const guides = guidesLayer(frame)
      if (guides && !guides.hidden) {
        guides.hidden = true
        hidden.push(guides)
      }
    })
  }

  const written = []
  const problems = []
  // Every name this run writes, so no frame can quietly replace another's file.
  const claimed = Object.create(null)
  try {
    if (wantsPdf) {
      frames.forEach((frame) => {
        collectProblem(exportPdf(frame, output, keepBoth, claimed), problems)
      })
      written.push('PDF at 1×')
    }
    if (wantsPng) {
      frames.forEach((frame) => {
        collectProblem(
          exportRaster(frame, 'png', ppi, output, keepBoth, claimed),
          problems
        )
      })
      written.push(`PNG at ${ppi} PPI`)
    }
    if (wantsTiff) {
      frames.forEach((frame) => {
        collectProblem(
          exportRaster(frame, 'tiff', ppi, output, keepBoth, claimed),
          problems
        )
      })
      written.push(`TIFF at ${ppi} PPI`)
    }
  } catch (error) {
    UI.message(`Export failed: ${error.message}`)
    return
  } finally {
    hidden.forEach((layer) => {
      layer.hidden = false
    })
  }

  if (revealCheckbox.state() === 1) {
    NSWorkspace.sharedWorkspace().openURL(NSURL.fileURLWithPath(output))
  }

  // A resolution or a trim line that came out wrong is invisible on screen and
  // only shows up on paper, so this stops rather than mentioning it in passing.
  // A transient message at the bottom of the canvas is no way to report it.
  if (problems.length) {
    runAlert(
      `Check ${problems.length} File${
        problems.length > 1 ? 's' : ''
      } Before Printing`,
      `These exported, but not the way they should have. Every pixel is there — it's the resolution or the trim line that's off, which won't look wrong until it's on paper. Open them before sending to press.`,
      makeScrollingText(
        problems.join('\n\n'),
        460,
        Math.min(240, 30 + problems.length * 34)
      ),
      ['Done']
    )
  }

  UI.message(
    `${written.join(' and ')} — ${frames.length} frame${
      frames.length > 1 ? 's' : ''
    } exported. Convert to CMYK before sending to press.`
  )
}

var toggleGuides = function () {
  const document = currentDocument()
  if (!document) {
    return
  }

  const frames = targetFrames(document)
  const guides = frames.map(guidesLayer).filter(Boolean)
  if (!guides.length) {
    UI.message('These frames have no print guides. Add them with “Add Bleed & Guides to Selection…”.')
    return
  }

  const shouldHide = guides.some((layer) => !layer.hidden)
  guides.forEach((layer) => {
    layer.hidden = shouldHide
  })
  UI.message(shouldHide ? 'Print guides hidden.' : 'Print guides shown.')
}

var showPhysicalSize = function () {
  const document = currentDocument()
  if (!document) {
    return
  }

  const selected = document.selectedLayers.layers
  if (!selected.length) {
    UI.message('Select a layer to see its printed size.')
    return
  }

  const lines = selected.map((layer) => {
    const rect = layer.frame
    const parts = [
      `${layer.name}`,
      `  ${round(rect.width, 2)} × ${round(rect.height, 2)} pt`,
      `  ${formatSize(rect.width, rect.height, 'in')}`,
      `  ${formatSize(rect.width, rect.height, 'mm')}`,
    ]

    if (isFrameLike(layer)) {
      const spec = specForFrame(layer)
      const bleed = spec.bleedPt || 0
      if (bleed > 0) {
        parts.push(
          `  Trim ${formatSize(
            rect.width - 2 * bleed,
            rect.height - 2 * bleed,
            spec.unit || 'in'
          )} after ${round(fromPt(bleed, spec.unit || 'in'), 3)} ${
            spec.unit || 'in'
          } bleed`
        )
      }
    }

    if (layer.type === 'Image') {
      const pixels = imagePixelSize(layer)
      if (pixels && rect.width > 0) {
        const ppi = Math.round(pixels.width / (rect.width / PT_PER_INCH))
        parts.push(
          `  ${pixels.width} × ${pixels.height} px — ${ppi} PPI at this size`
        )
      }
    }

    return parts.join('\n')
  })

  if (selected.length === 1) {
    const rect = selected[0].frame
    UI.message(
      `${formatSize(rect.width, rect.height, 'in')} · ${formatSize(
        rect.width,
        rect.height,
        'mm'
      )} · ${round(rect.width, 2)} × ${round(rect.height, 2)} pt`
    )
  }

  runAlert(
    'Physical Size',
    'At 72 px per inch, 1 px on the canvas is 1 pt on paper.',
    makeScrollingText(lines.join('\n\n'), 440, Math.min(320, 40 + lines.length * 70)),
    ['Done']
  )
}
