/*
 * svgpath.js — parse, uniformly scale, round and compress SVG path data.
 * Works in the browser (window.SVGPath) and in Node (module.exports).
 *
 * Grammar follows SVG 1.1 / SVG 2 path data: all 20 commands, implicit
 * command repetition, exponent numbers, optional separators and packed arc flags.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SVGPath = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // number of arguments per command
  const ARITY = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };
  const NUMBER = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;
  const WS = /\s/;

  class PathError extends Error {
    constructor(message, index) {
      super(message);
      this.index = index;
    }
  }

  // ---------------------------------------------------------------- parsing

  /**
   * Parse path data into [{cmd, args, index}]. Never throws: on a syntax error it
   * returns the segments parsed so far plus `error`, mirroring how renderers draw
   * everything before the first error.
   */
  function parse(d) {
    const segments = [];
    let i = 0;
    const n = d.length;

    const skipWs = () => { while (i < n && WS.test(d[i])) i++; };
    const fail = (msg, at) => { throw new PathError(msg, at === undefined ? i : at); };

    const readNumber = () => {
      NUMBER.lastIndex = i;
      const m = NUMBER.exec(d);
      if (!m) fail(i < n ? `Expected a number but found "${d[i]}"` : 'Unexpected end of path, expected a number');
      const v = Number(m[0]);
      if (!isFinite(v)) fail(`Number out of range: ${m[0]}`);
      i += m[0].length;
      return v;
    };

    const readFlag = () => {
      if (d[i] !== '0' && d[i] !== '1') fail(i < n ? `Arc flag must be 0 or 1, found "${d[i]}"` : 'Unexpected end of path, expected an arc flag');
      return d[i++] === '1' ? 1 : 0;
    };

    // optional wsp* [,] wsp* between arguments; returns true if a comma was consumed
    const skipSeparator = () => {
      skipWs();
      if (d[i] === ',') { i++; skipWs(); return true; }
      return false;
    };

    try {
      skipWs();
      if (i < n && d[i] !== 'M' && d[i] !== 'm') fail('Path data must begin with a moveto (M or m)');
      while (i < n) {
        const cmd = d[i];
        const type = cmd.toUpperCase();
        if (!(type in ARITY) || !/[A-Za-z]/.test(cmd)) fail(`Unexpected character "${cmd}", expected a path command`);
        const start = i++;
        const arity = ARITY[type];
        if (arity === 0) {
          segments.push({ cmd, args: [], index: start });
          skipWs();
          continue;
        }
        skipWs();
        let first = true;
        for (;;) {
          const args = [];
          for (let k = 0; k < arity; k++) {
            if (k > 0) skipSeparator();
            args.push(type === 'A' && (k === 3 || k === 4) ? readFlag() : readNumber());
          }
          // first group keeps the command letter; later groups are implicit repeats
          segments.push({ cmd: first ? cmd : (type === 'M' ? (cmd === 'M' ? 'L' : 'l') : cmd), args, index: first ? start : i, implicit: !first });
          first = false;
          const comma = skipSeparator();
          if (i >= n || (!comma && /[A-Za-z]/.test(d[i]))) break;
          if (!comma && !/[0-9.+-]/.test(d[i])) fail(`Unexpected character "${d[i]}"`);
          // a comma (or a number) means another argument group must follow
        }
      }
    } catch (e) {
      if (e instanceof PathError) return { segments, error: { message: e.message, index: e.index } };
      throw e;
    }
    return { segments, error: null };
  }

  // -------------------------------------------------------------- rounding

  const fix15 = x => { const v = Number(x.toPrecision(15)); return v === 0 ? 0 : v; };
  const clean = x => (x === 0 ? 0 : x);

  function makeRounder(mode, precision) {
    if (mode === 'sig') {
      const p = Math.min(Math.max(Math.round(precision), 1), 100);
      return x => (x === 0 ? 0 : clean(Number(x.toPrecision(p))));
    }
    const dp = Math.min(Math.max(Math.round(precision), 0), 100);
    return x => (Math.abs(x) < 1e21 ? clean(Number(x.toFixed(dp))) : x);
  }

  // -------------------------------------------------- number to text

  function expandExponent(s) {
    const m = /^(-?)(\d+)(?:\.(\d+))?e([+-]\d+)$/.exec(s);
    if (!m) return s;
    const digits = m[2] + (m[3] || '');
    const point = m[2].length + Number(m[4]);
    let body;
    if (point <= 0) body = '0.' + '0'.repeat(-point) + digits;
    else if (point >= digits.length) body = digits + '0'.repeat(point - digits.length);
    else body = digits.slice(0, point) + '.' + digits.slice(point);
    return m[1] + body;
  }

  function formatNumber(n, minify) {
    let s = expandExponent(String(clean(n)));
    if (!minify) return s;
    const neg = s[0] === '-';
    if (neg) s = s.slice(1);
    if (s.startsWith('0.')) s = s.slice(1); // 0.5 -> .5
    // exponent form, when strictly shorter (e.g. 1000000 -> 1e6, .0000001 -> 1e-7)
    const dot = s.indexOf('.');
    let digits = s.replace('.', '');
    let exp = dot === -1 ? 0 : -(s.length - dot - 1);
    const lead = digits.match(/^0*/)[0].length;
    digits = digits.slice(lead);
    const trail = digits.match(/0*$/)[0].length;
    if (digits.length > trail) {
      digits = digits.slice(0, digits.length - trail);
      exp += trail;
      const short = digits + 'e' + exp;
      if (short.length < s.length) s = short;
    }
    return (neg ? '-' : '') + s;
  }

  // ----------------------------------------------------------- serializer

  /*
   * Incremental, immutable serializer so callers can cheaply compare how long
   * an alternative would make the output. Items: {cmd, args:[numbers]}.
   * Arc flags (args 3 and 4 of A/a) are emitted as single characters.
   */
  function emptyState() { return { str: '', cmd: '', last: '', lastKind: '' }; }

  function emit(state, item, minify) {
    let str = state.str;
    let last = state.last;
    let lastKind = state.lastKind;
    const type = item.cmd.toUpperCase();
    const prev = state.cmd;
    const omitLetter = minify && prev !== '' && type !== 'Z' && type !== 'M' &&
      (item.cmd === prev || (item.cmd === 'L' && prev === 'M') || (item.cmd === 'l' && prev === 'm'));
    if (!omitLetter) {
      str += item.cmd;
      last = item.cmd;
      lastKind = 'cmd';
    }
    item.args.forEach((v, k) => {
      const isFlag = type === 'A' && (k === 3 || k === 4);
      const text = isFlag ? String(v) : formatNumber(v, minify);
      let sep = '';
      if (lastKind === 'num' || lastKind === 'flag') {
        if (minify) {
          if (lastKind === 'flag') sep = '';
          else if (!isFlag && (text[0] === '-' || (text[0] === '.' && /[.e]/.test(last)))) sep = '';
          else sep = ' ';
        } else {
          sep = ' ';
        }
      }
      str += sep + text;
      last = text;
      lastKind = isFlag ? 'flag' : 'num';
    });
    return { str, cmd: item.cmd, last, lastKind };
  }

  function serialize(items, minify) {
    let st = emptyState();
    for (const it of items) st = emit(st, it, minify);
    return st.str;
  }

  // ------------------------------------------------- scale + round (pass 1)

  /*
   * Returns [{cmd, args, op}] where args are the rounded values in the original
   * command form and op is the same segment in absolute form (for optimizing).
   * Relative commands are rounded against the position the renderer will really
   * reach, so rounding error never accumulates along a path.
   */
  function scaleSegments(segments, scale, round) {
    const out = [];
    let ex = 0, ey = 0;       // exact (unrounded) current point
    let px = 0, py = 0;       // current point as emitted
    let sx = 0, sy = 0, spx = 0, spy = 0; // subpath start (exact, emitted)

    const range = v => { if (!isFinite(v)) throw new PathError('Scaled value out of range'); return v; };

    for (const seg of segments) {
      const type = seg.cmd.toUpperCase();
      const rel = seg.cmd !== type;
      const a = seg.args;
      const args = [];
      const abs = [];
      // coordinate kinds per argument: 'x', 'y', 'r' (radius), 'k' (keep as is)
      let kinds;
      switch (type) {
        case 'H': kinds = ['x']; break;
        case 'V': kinds = ['y']; break;
        case 'A': kinds = ['r', 'r', 'k', 'k', 'k', 'x', 'y']; break;
        case 'Z': kinds = []; break;
        default: kinds = a.map((_, k) => (k % 2 === 0 ? 'x' : 'y'));
      }
      let nex = ex, ney = ey, npx = px, npy = py;
      a.forEach((v, k) => {
        const kind = kinds[k];
        if (kind === 'k') { args.push(v); abs.push(v); return; }
        if (kind === 'r') {
          const r = round(range(Math.abs(v * scale)));
          args.push(r); abs.push(r);
          return;
        }
        const isX = kind === 'x';
        const baseExact = rel ? (isX ? ex : ey) : 0;
        const baseEmit = rel ? (isX ? px : py) : 0;
        const exact = range(baseExact + v * scale);
        const rounded = round(exact - baseEmit);
        const absVal = fix15(baseEmit + rounded);
        args.push(rounded);
        abs.push(absVal);
        // the last x and last y among the arguments is the new pen position
        if (isX) { nex = exact; npx = absVal; } else { ney = exact; npy = absVal; }
      });
      if (type === 'Z') {
        nex = sx; ney = sy; npx = spx; npy = spy;
      }
      ex = nex; ey = ney; px = npx; py = npy;
      if (type === 'M') { sx = ex; sy = ey; spx = px; spy = py; }
      out.push({ cmd: seg.cmd, args, op: { t: type, p: abs } });
    }
    return out;
  }

  // ------------------------------------------------------ optimizer (pass 2)

  // a - b with float cancellation noise removed (15 significant digits of the larger operand)
  function diff(a, b) {
    const mag = Math.max(Math.abs(a), Math.abs(b));
    if (mag === 0) return 0;
    const dp = Math.min(Math.max(14 - Math.floor(Math.log10(mag)), 0), 100);
    return clean(Number((a - b).toFixed(dp)));
  }

  const near = (a, b) => Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(a), Math.abs(b));

  /*
   * Geometry-preserving rewrites on the rounded output:
   *   L -> H / V, C -> S, Q -> T, zero-radius arc -> L, circular arc rotation -> 0,
   * then per segment choose absolute or relative, whichever is shorter.
   * Deliberately NOT done (they can alter stroke caps/joins or markers):
   * removing zero-length segments, dropping a closing L before Z, merging movetos.
   */
  function optimize(scaled, minify) {
    let cx = 0, cy = 0, sx = 0, sy = 0;
    let prevCubic = null; // second control point of previous C/S
    let prevQuad = null;  // control point of previous Q/T
    let st = emptyState();

    for (let n = 0; n < scaled.length; n++) {
      let { t, p } = scaled[n].op;
      if (t === 'A') {
        if (p[0] === 0 || p[1] === 0) { t = 'L'; p = [p[5], p[6]]; }
        else if (p[0] === p[1] && p[2] !== 0) p = [p[0], p[1], 0, p[3], p[4], p[5], p[6]];
      }
      if (t === 'L') {
        if (near(p[1], cy)) { t = 'H'; p = [p[0]]; }
        else if (near(p[0], cx)) { t = 'V'; p = [p[1]]; }
      } else if (t === 'C') {
        const ix = prevCubic ? 2 * cx - prevCubic[0] : cx;
        const iy = prevCubic ? 2 * cy - prevCubic[1] : cy;
        if (near(p[0], ix) && near(p[1], iy)) { t = 'S'; p = p.slice(2); }
      } else if (t === 'Q') {
        const ix = prevQuad ? 2 * cx - prevQuad[0] : cx;
        const iy = prevQuad ? 2 * cy - prevQuad[1] : cy;
        if (near(p[0], ix) && near(p[1], iy)) { t = 'T'; p = p.slice(2); }
      }

      // effective control points for the following segment
      let nextCubic = null, nextQuad = null;
      if (t === 'C') nextCubic = [p[2], p[3]];
      else if (t === 'S') nextCubic = [p[0], p[1]];
      else if (t === 'Q') nextQuad = [p[0], p[1]];
      else if (t === 'T') nextQuad = prevQuad ? [2 * cx - prevQuad[0], 2 * cy - prevQuad[1]] : [cx, cy];

      // relative form
      let relArgs;
      if (t === 'A') relArgs = [p[0], p[1], p[2], p[3], p[4], diff(p[5], cx), diff(p[6], cy)];
      else if (t === 'H') relArgs = [diff(p[0], cx)];
      else if (t === 'V') relArgs = [diff(p[0], cy)];
      else relArgs = p.map((v, k) => diff(v, k % 2 === 0 ? cx : cy));

      const absItem = { cmd: t, args: p };
      if (t === 'Z') {
        st = emit(st, absItem, minify);
      } else {
        const relItem = { cmd: t.toLowerCase(), args: relArgs };
        const a = emit(st, absItem, minify);
        const r = emit(st, relItem, minify);
        st = r.str.length < a.str.length || (r.str.length === a.str.length && n > 0) ? r : a;
      }

      // advance the pen
      if (t === 'Z') { cx = sx; cy = sy; }
      else if (t === 'H') cx = p[0];
      else if (t === 'V') cy = p[0];
      else { cx = p[p.length - 2]; cy = p[p.length - 1]; }
      if (t === 'M') { sx = cx; sy = cy; }
      prevCubic = nextCubic;
      prevQuad = nextQuad;
    }
    return st.str;
  }

  // ------------------------------------------------------------- public API

  /**
   * Scale one path-data string.
   * opts: {scale, mode: 'dec'|'sig', precision, minify, optimize}
   * Returns {output, error} where error is null or {message, index}; on error the
   * output covers the valid prefix (as a renderer would draw it).
   */
  function scalePath(d, opts) {
    const o = Object.assign({ scale: 1, mode: 'dec', precision: 3, minify: true, optimize: true }, opts);
    if (!isFinite(o.scale)) throw new TypeError('scale must be a finite number');
    const { segments, error } = parse(d);
    const round = makeRounder(o.mode, o.precision);
    let scaled;
    let err = error;
    try {
      scaled = scaleSegments(segments, o.scale, round);
    } catch (e) {
      if (!(e instanceof PathError)) throw e;
      return { output: '', error: { message: e.message, index: 0 } };
    }
    const output = o.optimize
      ? optimize(scaled, o.minify)
      : serialize(scaled.map(s => ({ cmd: s.cmd, args: s.args })), o.minify);
    return { output, error: err };
  }

  /**
   * Scale raw path data or markup. If the text contains "<", every d="…" attribute
   * is rewritten in place; otherwise the whole text (optionally `d="…"`) is path data.
   * Returns {output, paths:[d,…] (input), outPaths:[d,…], errors:[{path,message,index}]}.
   */
  function scaleInput(text, opts) {
    const errors = [];
    const paths = [];
    const outPaths = [];
    const run = (d, label) => {
      const r = scalePath(d, opts);
      if (r.error) errors.push({ path: label, message: r.error.message, index: r.error.index });
      paths.push(d);
      outPaths.push(r.output);
      return r.output;
    };

    if (text.indexOf('<') !== -1) {
      let n = 0;
      const output = text.replace(/(\sd\s*=\s*)(?:"([^"]*)"|'([^']*)')/g, (m, pre, dq, sq) => {
        const q = dq !== undefined ? '"' : "'";
        return pre + q + run(dq !== undefined ? dq : sq, ++n) + q;
      });
      return { output, paths, outPaths, errors, markup: true };
    }
    const m = /^\s*d\s*=\s*(?:"([^"]*)"|'([^']*)')\s*;?\s*$/.exec(text);
    const d = m ? (m[1] !== undefined ? m[1] : m[2]) : text;
    const output = run(d, 1);
    return { output, paths, outPaths, errors, markup: false };
  }

  return { parse, scalePath, scaleInput, formatNumber, PathError };
});
