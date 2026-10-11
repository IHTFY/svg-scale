'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parse, scalePath, scaleInput, formatNumber } = require('../svgpath.js');

const run = (d, o) => scalePath(d, Object.assign({ scale: 2, mode: 'dec', precision: 3 }, o));
const plain = { minify: false, optimize: false };

// ---- independent reference: expand any path to absolute M/L/C/Q/A/Z ops ----
function absolutize(d) {
  const { segments, error } = parse(d);
  assert.equal(error, null, `parse error in ${d}`);
  const ops = [];
  let x = 0, y = 0, sx = 0, sy = 0, pc = null, pq = null;
  for (const { cmd, args: a } of segments) {
    const T = cmd.toUpperCase(), rel = cmd !== T;
    const ox = rel ? x : 0, oy = rel ? y : 0;
    let nc = null, nq = null;
    switch (T) {
      case 'M': x = a[0] + ox; y = a[1] + oy; sx = x; sy = y; ops.push(['M', x, y]); break;
      case 'L': x = a[0] + ox; y = a[1] + oy; ops.push(['L', x, y]); break;
      case 'H': x = a[0] + ox; ops.push(['L', x, y]); break;
      case 'V': y = a[0] + oy; ops.push(['L', x, y]); break;
      case 'C': ops.push(['C', a[0] + ox, a[1] + oy, a[2] + ox, a[3] + oy, a[4] + ox, a[5] + oy]);
        nc = [a[2] + ox, a[3] + oy]; x = a[4] + ox; y = a[5] + oy; break;
      case 'S': {
        const c1 = pc ? [2 * x - pc[0], 2 * y - pc[1]] : [x, y];
        ops.push(['C', c1[0], c1[1], a[0] + ox, a[1] + oy, a[2] + ox, a[3] + oy]);
        nc = [a[0] + ox, a[1] + oy]; x = a[2] + ox; y = a[3] + oy; break;
      }
      case 'Q': ops.push(['Q', a[0] + ox, a[1] + oy, a[2] + ox, a[3] + oy]);
        nq = [a[0] + ox, a[1] + oy]; x = a[2] + ox; y = a[3] + oy; break;
      case 'T': {
        const c = pq ? [2 * x - pq[0], 2 * y - pq[1]] : [x, y];
        ops.push(['Q', c[0], c[1], a[0] + ox, a[1] + oy]);
        nq = c; x = a[0] + ox; y = a[1] + oy; break;
      }
      case 'A':
        if (a[0] === 0 || a[1] === 0) ops.push(['L', a[5] + ox, a[6] + oy]);
        else ops.push(['A', Math.abs(a[0]), Math.abs(a[1]), a[0] === a[1] ? 0 : a[2], a[3], a[4], a[5] + ox, a[6] + oy]);
        x = a[5] + ox; y = a[6] + oy; break;
      case 'Z': ops.push(['Z']); x = sx; y = sy; break;
    }
    pc = nc; pq = nq;
  }
  return ops;
}

function assertSameGeometry(input, output, scale, tol) {
  const want = absolutize(input);
  const got = absolutize(output);
  assert.equal(got.length, want.length, `segment count differs: ${input} -> ${output}`);
  want.forEach((w, i) => {
    const g = got[i];
    assert.equal(g[0], w[0], `op ${i} type: ${input} -> ${output}`);
    for (let k = 1; k < w.length; k++) {
      const isAngleOrFlag = w[0] === 'A' && (k === 3 || k === 4 || k === 5);
      const expected = isAngleOrFlag ? w[k] : (w[0] === 'A' && k <= 2 ? Math.abs(w[k] * scale) : w[k] * scale);
      assert.ok(Math.abs(g[k] - expected) <= tol, `op ${i} arg ${k}: got ${g[k]} want ${expected} (${input} -> ${output})`);
    }
  });
}

test('basic scale, matches original behaviour', () => {
  assert.equal(run('M2 12V0h7v2H4v3h5v2H4v5H2z', plain).output, 'M4 24V0h14v4H8v6h10v4H8v10H4z');
});

test('exponent numbers are numbers, not commands', () => {
  assert.equal(run('M1e2 5E-1', plain).output, 'M200 1');
  assert.equal(run('M0 0l1e-1 1.5e1', plain).output, 'M0 0l0.2 30');
});

test('plus sign is a number prefix / separator', () => {
  assert.equal(run('M+1+2', plain).output, 'M2 4');
});

test('numbers glued by sign and dot', () => {
  assert.equal(run('M1-2', plain).output, 'M2 -4');
  assert.equal(run('M.5.5', plain).output, 'M1 1');
  assert.equal(run('M1.5.5', plain).output, 'M3 1');
  assert.equal(run('M1e1.5', plain).output, 'M20 1');
});

test('leading zeros in a single number are one number', () => {
  assert.equal(run('M007 5', plain).output, 'M14 10');
  assert.equal(run('M00.5 0', plain).output, 'M1 0');
});

test('implicit lineto after M / m and implicit repeats', () => {
  assert.equal(run('M0 0 10 10 20 0', plain).output, 'M0 0L20 20L40 0');
  assert.equal(run('m0 0 1 1', plain).output, 'm0 0l2 2');
  assert.equal(run('M0 0c1 1 2 2 3 3 1 1 2 2 3 3', plain).output, 'M0 0c2 2 4 4 6 6c2 2 4 4 6 6');
});

test('arcs: only radii scale; rotation and flags untouched; every repeat', () => {
  const r = run('M0 0a5 5 30 1 0 10 0 6 3 45 0 1 10 0', plain).output;
  assert.equal(r, 'M0 0a10 10 30 1 0 20 0a12 6 45 0 1 20 0');
});

test('arcs: packed flags, with and without separators', () => {
  assert.equal(run('M0 0a5 5 0 1110 0', plain).output, 'M0 0a10 10 0 1 1 20 0');
  assert.equal(run('M0 0a5 5 0 0010 10', plain).output, 'M0 0a10 10 0 0 0 20 20');
  assert.equal(run('M0 0a5 5 0 01-10 10', plain).output, 'M0 0a10 10 0 0 1 -20 20');
  assert.equal(run('M0 0a5,5,0,1,1,10,0', plain).output, 'M0 0a10 10 0 1 1 20 0');
  assert.equal(run('M0 0a5 5 0 1 1.5.5', plain).output, 'M0 0a10 10 0 1 1 1 1');
});

test('negative scale keeps arc sweep (point reflection) and uses |radius|', () => {
  assert.equal(run('M0 0a5 5 0 1 1 10 0', Object.assign({ scale: -1 }, plain)).output, 'M0 0a5 5 0 1 1 -10 0');
});

test('whitespace and comma forms', () => {
  assert.equal(run(' \n\tM0\n0\tL10,10 , 20 ,20', plain).output, 'M0 0L20 20L40 40');
  assert.equal(run('M0 0zM1 1', plain).output, 'M0 0zM2 2');
  assert.equal(run('M0 0 Z   m 1 1 z', plain).output, 'M0 0Zm2 2z');
});

test('empty and whitespace-only paths are valid and empty', () => {
  assert.deepEqual(run('').error, null);
  assert.equal(run('   ').output, '');
});

test('syntax errors are reported with an index and keep the valid prefix', () => {
  const cases = [
    ['L 1 2', 'moveto'],
    ['M0 0 L1', 'expected a number'],
    ['M0 0 L1,', 'expected a number'],
    ['M0 0,, 1', 'Expected a number'],
    ['M0 0 L,1 2', 'Expected a number'],
    ['M0 0 Z 1', 'Unexpected character'],
    ['M0 0 Z,', 'Unexpected character'],
    ['M0 0 a1 1 0 2 0 1 1', 'flag'],
    ['M0 0 a1 1 0 0 0 1', 'expected a number'],
    ['M0 0 X1 1', 'Unexpected character'],
    ['M0 0 L1e 1', 'Expected a number'],
    ['M0 0 L5 5 #', 'Unexpected character'],
    ['M0 0 L−5 5', 'Expected a number'],
    ['M1e999 0', 'out of range'],
  ];
  for (const [d, msg] of cases) {
    const { error } = parse(d);
    assert.ok(error && error.message.includes(msg), `${d}: ${error && error.message}`);
  }
  const r = run('M0 0 L5 5 #', plain);
  assert.equal(r.output, 'M0 0L10 10');
  assert.equal(r.error.index, 10);
});

test('scaled overflow is reported instead of emitting Infinity', () => {
  const r = run('M1e308 0', { scale: 10 });
  assert.ok(r.error);
  assert.equal(r.output, '');
});

test('precision: decimal places and significant digits', () => {
  assert.equal(run('M1.23456 0', Object.assign({ precision: 2 }, plain)).output, 'M2.47 0');
  assert.equal(run('M12345.678 0', Object.assign({ mode: 'sig', precision: 4 }, plain)).output, 'M24690 0');
  assert.equal(run('M12345.678 0', Object.assign({ mode: 'dec', precision: 0 }, plain)).output, 'M24691 0');
  assert.equal(run('M0.00001234 0', Object.assign({ mode: 'sig', precision: 3 }, plain)).output, 'M0.0000247 0');
  assert.equal(run('M-0.0001 0', Object.assign({ precision: 2 }, plain)).output, 'M0 0'); // no "-0"
});

test('relative commands do not accumulate rounding error', () => {
  const d = 'M0 0' + 'l0.3333 0'.repeat(300);
  const r = run(d, Object.assign({ scale: 1, precision: 1 }, plain));
  const { segments } = parse(r.output);
  const sum = segments.slice(1).reduce((s, g) => s + g.args[0], 0);
  assert.ok(Math.abs(sum - 99.99) <= 0.05, `end x = ${sum}`);
});

test('number formatting', () => {
  assert.equal(formatNumber(0.5, true), '.5');
  assert.equal(formatNumber(-0.5, true), '-.5');
  assert.equal(formatNumber(0.5, false), '0.5');
  assert.equal(formatNumber(1000000, true), '1e6');
  assert.equal(formatNumber(1000, true), '1e3');
  assert.equal(formatNumber(100, true), '100');
  assert.equal(formatNumber(1e-7, true), '1e-7');
  assert.equal(formatNumber(1e-7, false), '0.0000001');
  assert.equal(formatNumber(1.5e21, false), '1500000000000000000000');
  assert.equal(formatNumber(-0, true), '0');
});

test('minify: separators, repeated commands, packed flags', () => {
  const o = { optimize: false, minify: true };
  assert.equal(run('M0.5 0.5 L1.5 0.25', o).output, 'M1 1 3 .5');
  assert.equal(run('M0 0 L1 1 L2 2', o).output, 'M0 0 2 2 4 4');
  assert.equal(run('M0 0 a5 5 0 1 0 10 0', o).output, 'M0 0a10 10 0 1020 0');
  assert.equal(run('M0 0L-1 -1', o).output, 'M0 0-2-2');
});

test('optimize: shorthands and shortest form', () => {
  const o = { optimize: true, minify: true };
  assert.equal(run('M0 0 L10 0 L10 10', o).output, 'M0 0h20v20');
  assert.equal(run('M0 0 C1 1 2 2 3 3 4 4 5 5 6 6', o).output, 'M0 0c2 2 4 4 6 6s4 4 6 6');
  assert.equal(run('M0 0 Q1 1 2 2 3 3 4 4', o).output, 'M0 0q2 2 4 4t4 4');
  assert.equal(run('M0 0 A0 5 0 0 0 10 0', o).output, 'M0 0h20');
  assert.equal(run('M0 0 A5 5 45 0 0 10 10', o).output, 'M0 0a10 10 0 0020 20');
});

test('relative after Z is relative to subpath start', () => {
  const d = 'M10 10 l5 0 l0 5 z l3 3 m1 1 l1 1 Z m2 2 L0 0';
  for (const o of [plain, { minify: true, optimize: false }, { minify: true, optimize: true }]) {
    const r = run(d, Object.assign({ scale: 3, precision: 6 }, o));
    assertSameGeometry(d, r.output, 3, 1e-9);
  }
});

test('markup mode rewrites d attributes in place', () => {
  const src = '<svg viewBox="0 0 10 10" id="a"><path d="M1 1h2" fill="red"/><path\n  d=\'M2 2 L4 4\'/></svg>';
  const r = scaleInput(src, { scale: 2, minify: true, optimize: true });
  assert.equal(r.output, '<svg viewBox="0 0 10 10" id="a"><path d="M2 2h4" fill="red"/><path\n  d=\'M4 4l4 4\'/></svg>');
  assert.equal(r.outPaths.length, 2);
  assert.deepEqual(r.errors, []);
});

test('markup mode reports which path has an error', () => {
  const r = scaleInput('<path d="M0 0 L1"/><path d="M1 1"/>', { scale: 2 });
  assert.equal(r.errors.length, 1);
  assert.equal(r.errors[0].path, 1);
});

test('raw d="..." wrapper is accepted', () => {
  assert.equal(scaleInput('d="M1 1"', { scale: 2 }).output, 'M2 2');
  assert.equal(scaleInput("  d = 'M1 1';", { scale: 2 }).output, 'M2 2');
});

// ---- property test: every option combination preserves geometry and is re-parseable ----
function rng(seed) { let s = seed; return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296; }

function randomPath(rand) {
  const num = () => {
    const k = rand();
    const v = k < 0.3 ? Math.round(rand() * 200 - 100) : Math.round((rand() * 200 - 100) * 1000) / 1000;
    return v;
  };
  const cmds = 'MLHVCSQTAZmlhvcsqtaz';
  let d = 'M' + num() + ' ' + num();
  const n = 1 + Math.floor(rand() * 12);
  for (let i = 0; i < n; i++) {
    const c = cmds[Math.floor(rand() * cmds.length)];
    const T = c.toUpperCase();
    if (T === 'M' && rand() < 0.5) { d += c + num() + ' ' + num(); continue; }
    const groups = 1 + Math.floor(rand() * 2);
    d += c;
    if (T === 'Z') continue;
    for (let g = 0; g < groups; g++) {
      const arity = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7 }[T];
      const a = [];
      for (let k = 0; k < arity; k++) {
        if (T === 'A' && (k === 3 || k === 4)) a.push(rand() < 0.5 ? 0 : 1);
        else if (T === 'A' && k < 2) a.push(rand() < 0.15 ? 0 : Math.abs(num()));
        else a.push(num());
      }
      d += (g ? ' ' : '') + a.join(rand() < 0.5 ? ' ' : ',');
    }
  }
  return d;
}

test('property: all option combinations preserve geometry', () => {
  const rand = rng(12345);
  const scales = [2, 0.5, -3, 7.25, 1e-3];
  for (let i = 0; i < 1500; i++) {
    const d = randomPath(rand);
    const scale = scales[i % scales.length];
    for (const minify of [false, true]) for (const optimize of [false, true]) {
      const r = scalePath(d, { scale, mode: 'dec', precision: 10, minify, optimize });
      assert.equal(r.error, null, d);
      const back = parse(r.output);
      assert.equal(back.error, null, `output not parseable: ${d} -> ${r.output}`);
      assertSameGeometry(d, r.output, scale, 1e-9 * Math.max(1, Math.abs(scale)));
    }
  }
});

test('property: minified output never longer than the unminified output', () => {
  const rand = rng(99);
  for (let i = 0; i < 500; i++) {
    const d = randomPath(rand);
    const a = scalePath(d, { scale: 2, precision: 3, minify: false, optimize: false }).output;
    const b = scalePath(d, { scale: 2, precision: 3, minify: true, optimize: true }).output;
    assert.ok(b.length <= a.length, `${d}: ${b} vs ${a}`);
  }
});

test('property: output is a fixed point of a scale-1 pass', () => {
  const rand = rng(7);
  for (let i = 0; i < 300; i++) {
    const d = randomPath(rand);
    const once = scalePath(d, { scale: 3, precision: 3 }).output;
    const twice = scalePath(once, { scale: 1, precision: 3 }).output;
    assertSameGeometry(once, twice, 1, 1e-9);
  }
});
