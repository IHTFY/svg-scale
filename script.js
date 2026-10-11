const $ = id => document.getElementById(id);

const NS_PAD = 0.05;

// Fit both previews to the same scale, each bounding box centred, with padding.
function fitPreviews() {
  const boxes = ['inputPath', 'outputPath'].map(id => {
    try { return $(id).getBBox(); } catch (e) { return { x: 0, y: 0, width: 0, height: 0 }; }
  });
  const w = Math.max(boxes[0].width, boxes[1].width);
  const h = Math.max(boxes[0].height, boxes[1].height);
  const pad = Math.max(w, h) * NS_PAD || 1;
  ['svgInput', 'svgOutput'].forEach((id, k) => {
    const b = boxes[k];
    const cx = b.x + b.width / 2;
    const cy = b.y + b.height / 2;
    const vw = w + 2 * pad;
    const vh = h + 2 * pad;
    $(id).setAttribute('viewBox', `${cx - vw / 2} ${cy - vh / 2} ${vw} ${vh}`);
  });
}

const byteLength = s => new Blob([s]).size;

const go = () => {
  const input = $('path').value;
  const scale = $('scale').value.trim() === '' ? NaN : Number($('scale').value);
  const precision = Number($('precision').value);
  const mode = $('mode').value;

  const show = (out, err, stats, inD, outD) => {
    $('output').textContent = out;
    $('error').textContent = err;
    $('stats').textContent = stats;
    $('inputPath').setAttribute('d', inD);
    $('outputPath').setAttribute('d', outD);
    fitPreviews();
  };

  if (!isFinite(scale)) return show('', 'Scale must be a finite number.', '', '', '');
  if (!Number.isInteger(precision) || precision < (mode === 'sig' ? 1 : 0) || precision > 16) {
    return show('', `Precision must be a whole number from ${mode === 'sig' ? 1 : 0} to 16.`, '', '', '');
  }

  const r = SVGPath.scaleInput(input, {
    scale,
    mode,
    precision,
    minify: $('minify').checked,
    optimize: $('optimize').checked
  });

  const err = r.errors
    .map(e => `${r.markup ? `Path ${e.path}: ` : ''}${e.message} (character ${e.index + 1}). Output stops at this point.`)
    .join(' ');
  const inBytes = byteLength(input);
  const outBytes = byteLength(r.output);
  const stats = input.trim() === '' ? '' : `${inBytes} → ${outBytes} bytes (${inBytes ? Math.round((outBytes / inBytes - 1) * 100) : 0}%)`;
  show(r.output, err, stats, r.paths.join(' '), r.outPaths.join(' '));
};

['path', 'scale', 'precision', 'mode', 'minify', 'optimize'].forEach(id => {
  $(id).addEventListener('input', go);
  $(id).addEventListener('change', go);
});

$('mode').addEventListener('change', () => {
  const sig = $('mode').value === 'sig';
  $('precision').min = sig ? 1 : 0;
  $('precision').value = sig ? 6 : 3;
  go();
});

const copyText = text => {
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
  return new Promise((resolve, reject) => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy') ? resolve() : reject(new Error('copy failed')); } catch (e) { reject(e); }
    document.body.removeChild(ta);
  });
};

let toastTimer;
const toast = text => {
  const el = $('toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
};

$('copyButton').addEventListener('click', () => {
  copyText($('output').textContent).then(
    () => toast('Copied to Clipboard'),
    () => toast('Error Copying to Clipboard')
  );
});

go();
