# svg-scale
Scale an SVG path directly as opposed to using the `transform` attribute and `scale()`.

Paste the value of your `d` attribute (or `d="…"`, or a whole `<svg>` / `<path>` snippet, in which case every `d` attribute is rewritten in place), set the scale factor, then copy the result.

[Live Demo](https://scale.ihtfy.com/)

## What it handles
- All 20 path commands, absolute and relative, with implicit command repetition (including the implicit `L` after `M`)
- Any number syntax: exponents (`1e-5`), `+`/`-` signs, `.5.5`, `1-2`, packed arc flags (`a5 5 0 1110 0`)
- Arcs: only `rx`/`ry` are scaled; rotation and flags are left alone
- Rounding by decimal places or significant digits; relative commands are rounded against the position actually emitted, so error does not accumulate
- Syntax errors are reported with a position (output stops there, like a browser would render)

## Compression
- **Minify** (lossless text): `0.5` → `.5`, no separators where unambiguous, repeated command letters dropped, arc flags packed, `1000000` → `1e6`
- **Optimize** (geometry-preserving): `L` → `H`/`V`, `C` → `S`, `Q` → `T`, zero-radius arc → line, shortest of relative/absolute per segment

Zero-length segments, a closing `L` before `Z`, and consecutive movetos are deliberately left alone because removing them can change stroke caps/joins or markers.

## Not covered
- Uniform scale only (no separate X/Y scale)
- Only `d` is scaled: `stroke-width`, `viewBox`, `transform` and other shapes (`rect`, `polygon`, …) are not touched

## Development
No build step and no dependencies (plain HTML/CSS/JS). `svgpath.js` holds the logic, `script.js` the UI.

```
npm test
```
