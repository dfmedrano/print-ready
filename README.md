# Print Ready

Print production helpers for Sketch: bleed-ready frames, a preflight check, and exports that land at the right physical size.

Built from [Sketch for Print Design](https://medium.com/sketch-tricks/sketch-for-print-design-fd165b92cb3a) on Sketch Tricks. That article's core insight is that the Sketch canvas is **72 px per inch**, so 1 px = 1 pt and a frame exported to PDF at 1× comes out at exactly the right size on paper. Everything here automates the manual setup and checking that follows from it.

## Install

Download the latest release and double-click `Print Ready.sketchplugin`, or clone this repo and symlink it:

```bash
ln -s "$PWD/Print Ready.sketchplugin" ~/Library/Application\ Support/com.bohemiancoding.sketch3/Plugins/
```

Requires **Sketch 2026.1 or newer**. No build step — the plugin is plain JavaScript against the public Sketch API.

## Commands

### New Print Frame…

Creates a frame at a real paper size, with bleed added *outside* the trim size, so the frame you get is what the printer receives.

- 19 presets: US Letter/Legal/Tabloid, A1–A6, DL, business cards (US and EU), postcards, photo sizes, posters — plus a custom trim size.
- Portrait or landscape, and any number of frames side by side.
- Bleed and safe margin default to ⅛ in (3 mm and 5 mm for the metric presets).

Imperial presets are stored in inches, ISO presets in millimetres, so the numbers you see are the ones a printer asks for.

### Add Bleed & Guides to Selection…

The same setup for frames you already have. *Grow the frame, keeping the current size as trim* expands the frame by the bleed on all four sides and moves the artwork with it, so what you designed becomes the trim area.

A frame that already carries bleed is resized by the **difference**, so its trim stays exactly where it is: 3 mm becomes 5 mm by growing 2 mm on each side, and dropping to no bleed shrinks it back to the trim size. Asking for the bleed a frame already has does nothing at all. Growing twice was previously refused outright while the new figure was recorded regardless, which left a frame still sized for 3 mm claiming 5 mm — and a `TrimBox` 4 mm inside the artwork.

### Preflight Check

Checks the selected frames — or every frame on the page — and reports:

| Check | Flags |
| --- | --- |
| Image resolution | Under 300 PPI at placed size (warning), under 150 PPI (error) |
| Safe margin | Text reaching into the margin, where a trimming slip could clip it |
| Bleed | Artwork that crosses the trim line but stops short of the bleed edge |
| Hairlines | Borders thinner than 0.25 pt, which can break up on press |
| Small type | Type under 5 pt |
| CMYK gamut | Colours that shift when converted, with the CMYK recipe they become |
| Total ink | Colours over 320% total ink coverage |

Full-bleed artwork is recognised as intentional and isn't flagged for crossing the trim. *Select Affected Layers* selects everything the report mentions.

### Proofing against your press

*Profile…* picks the CMYK profile the gamut and ink figures are measured against. That choice matters: pure black reports 295% ink under ColorSync's Generic CMYK but **329% under Coated FOGRA39** — over the 320% ceiling, so an error the generic profile passes in silence. A vivid blue reports ΔE 47 generically and 35 against FOGRA39.

Profiles are found, not shipped: Coated FOGRA39 and U.S. Web Coated (SWOP) are licensed to the applications that install them, but they're usually already on the machine — the plugin reads the ColorSync folders, Adobe's, Ghostscript's and any Affinity app's resources, which is sixteen real press profiles on a typical setup. *Choose a profile file…* takes whatever your printer sends you. [ECI](https://eci.org) publishes free ISO profiles if you have none.

**This changes the figures, not the exported files.** Exports stay RGB, and a PNG cannot hold CMYK at all — the format has no CMYK colour type. To close the gap the other way, use:

### Bring colours into gamut

For each colour that can't be reproduced, *Bring N Colours into Gamut* sets every fill, border and text colour using it to what the press will actually print — `#1B4FD8` becomes `#2C509E` under FOGRA39. The document stays RGB, but the RGB you're looking at is now what comes off the press, so the deviation is gone at source rather than being discovered on paper. One undo puts it back.

A colour that has been corrected is reported as **already matched** rather than warned about again. It can still measure a ΔE above the limit afterwards — yellow `#EDE44C` goes 7.7 → 6.7 under FOGRA39 — but that residual is the profile's round trip failing to be reversible, not a shift still waiting to happen. Warning about it would be a dead end, since correcting it a second time is refused, and rightly. So the report says what it is and the frame comes back ready to print.

Each colour is corrected once and then recorded on the document, per profile. That's deliberate: the round trip isn't reversible, so a corrected colour converted *again* compresses a second time, and a red would walk `#E4002B → #D31C2D → #C4272F → #B72D30` one click at a time, each step further from anything the press would have produced. Only the first step is the answer. Choosing a different profile means a different press, so those colours are offered again.

Over-inking is reported but never corrected this way. The printed colour round-trips to much the same recipe, so applying it would leave the coverage where it was while looking like a fix — that one needs a lighter colour or a different black build.

### Export for Print…

- **Vector PDF at 1×** — page size matches the frame exactly (a US Letter frame with ⅛ in bleed exports a 630 × 810 pt PDF), with a **TrimBox** marking the cut line and a **BleedBox** around the full artwork.
- **PNG or TIFF** at any resolution, defaulting to 300 PPI.

Exported rasters come out tagged 72 DPI, which is why the article has you fix the size by hand in Photoshop. This stamps the real resolution into the file instead, so a 300 PPI export opens at its true physical size with every pixel intact — no resampling step. Rasters are also cropped back to the frame; see below for why they need it.

The resolution is read back out of each finished file, because an untagged PNG carries no `pHYs` chunk at all and every viewer then calls it 72 DPI — a file that looks correct and lands at the wrong physical size. Anything that didn't take is named in an alert rather than counted as a success.

For PNG the `pHYs` chunk is then written directly, because AppKit's is subtly wrong in a way that costs you the resolution in Affinity Photo.

`pHYs` holds pixels per metre for each axis as whole numbers. AppKit derives them from the image's size in points, rounding each axis on its own, so a 300 PPI export comes out as **11813 across and 11812 down** — 300.05 by 300.03 DPI, non-square pixels — where every other tool writes 11811 for both. Affinity Photo 2 won't accept an axis mismatch: a document has one resolution, so it discards the chunk and falls back to 72 DPI. Preview, Finder and `sips` tolerate it and report 300, which is why the same file reads 300 in one app and 72 in another. AppKit also writes a second copy of the resolution into an `eXIf` chunk that rounds differently again and which Apple's readers prefer over `pHYs`, so a single export could report 300.05, 300.039 or 300 depending on who asked.

Writing the chunk directly gives both axes the same exact value, drops the duplicate `eXIf`, and takes the resolution out of AppKit's hands — if the stamp failed entirely, this still puts a correct `pHYs` in front of the pixels. The pixels themselves aren't touched, and if the result doesn't read back correctly the original bytes are restored. TIFF needs none of this: its encoder writes exact integer rationals, equal on both axes.

Print guides are hidden automatically during export and restored afterwards.

If any of the files are already in the folder you pick, the plugin says which ones and lets you replace them or keep both — keeping both adds `-2`, `-3` to the new files the way Finder does.

### Page boxes and the exported page

An exported PDF arrives with every page box equal to its MediaBox, so a printer can't tell trim from bleed and the bleed you added means nothing downstream. The plugin sets them afterwards: `TrimBox` and `ArtBox` at the cut line, `BleedBox`, `CropBox` and `MediaBox` around the full artwork. Check it with `pdfinfo -box`, or Acrobat's Print Production → Set Page Boxes. With no bleed all five coincide, which is the honest answer — there's no bleed to tell apart from the trim.

Those boxes are measured from the frame's own rect rather than from the page the export came out on, because the two aren't quite the same: an exported page is a whole number of points, so it can be a fraction wider and taller than the frame. The strip left over is never painted — a white line along the edge in Affinity and Acrobat, transparent columns in a PNG — and a TrimBox measured down from that page carries the same error into the cut line, up to a point off. Both exporters trim back to the artwork instead: the PDF through its boxes, rasters by cropping whole pixels straight out of the exported image, so nothing is resampled and the colour profile is untouched. Where the artwork sits inside the page is worked out from the size the export actually produced, so nothing here assumes how that size was chosen.

If a page arrives more than a rounding larger than its frame — a frame that doesn't clip its content, or a shadow reaching past its edge — there's no saying where inside it the artwork ended up. That export is then left exactly as it came, with no boxes set at all: insetting the oversized page by the bleed would stamp a cut line that a press would work to, and it would be wrong by however far the overflow reaches. A 105 × 148 mm postcard behind a big shadow claimed a 226 × 269 mm trim that way. No `TrimBox` is the safer of the two wrong answers, and a dialog afterwards names the file and says what to fix.

### Toggle Print Guides · Show Physical Size

Small utilities: hide and show the guides, and read any layer's size in points, inches and millimetres — including a frame's trim size and an image's effective PPI.

### Setting a print grid

The plugin doesn't set the canvas grid, because Sketch's public API doesn't expose one — and a grid can't be stored on a Frame in the first place. In Sketch's own file format, grid settings belong to Pages, Artboards and Symbol Masters; a Frame is a group, and groups have nowhere to keep one.

Set it yourself in **View → Canvas → Grid Settings**, using whichever row matches the units you're working in:

| Working in | Grid block size | Thick line every |
| --- | --- | --- |
| Inches | 9 pt | 8 blocks (= 72 pt, exactly 1 in) |
| Millimetres | 7 pt | 4 blocks (= 28 pt, 9.88 mm) |

Grid size is a whole number of points, so 1 cm exactly isn't available — 28 pt lands within a third of a millimetre of it.

## Converting to CMYK

Sketch exports RGB and this plugin doesn't change that, so the conversion happens after export. In rough order of how much you should trust the result:

**Let your printer do it.** They have the profile for their press and their paper, and they will convert better than any default. Send them the RGB PDF along with the preflight report.

**Acrobat Pro** — Tools → Print Production → Convert Colors. You choose the destination profile and keep control over how black is handled.

A stock Mac only carries `/System/Library/ColorSync/Profiles/Generic CMYK Profile.icc`. Press profiles like Coated FOGRA39 or US Web Coated (SWOP) come with Adobe apps, in `/Library/Application Support/Adobe/Color/Profiles/Recommended/`, or as a free download from [ECI](https://www.eci.org).

### Two things to check in the result

**Black.** A pure RGB black converts to a four-colour black — roughly 72/68/67/88, close to 300% ink. That's acceptable behind a large solid and wrong for body text, which wants black on the K plate alone so it stays sharp when the plates sit slightly out of register. If your artwork has black text, convert it in Acrobat or hand it to the printer.

**Transparency.** Converting to CMYK composites transparency away. Printers generally want it flattened anyway, but check that blend modes and overlapping translucent shapes still look the way you meant.

## What this doesn't do

Sketch works in RGB and exports RGB; there is no CMYK document mode to switch to, and no plugin can add one. See [Converting to CMYK](#converting-to-cmyk) for how to handle it after export, and outline your type there if the printer asks for it. The preflight gamut check exists so you know which colours will move before you get there.

Other limits worth knowing:

- Layers inside Components (symbols) aren't inspected — preflight sees the instance, not its contents.
- Rotated layers are measured by their bounding box.
- The canvas grid is left to Sketch — see [Setting a print grid](#setting-a-print-grid).

## License

Copyright © 2026 Jorge Medrano. All rights reserved. See [LICENSE](LICENSE).
