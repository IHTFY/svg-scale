M.AutoInit();
document.addEventListener('DOMContentLoaded', function () {
  var ranges = document.querySelectorAll('input[type=range]');
  M.Range.init(ranges);
});

// function vbFromCenter(cx, cy, w, h) {
//   return `${cx - w / 2} ${cy - h / 2} ${w} ${h}`;
// }

// function getVBCenter(vb) {
//   [x, y, w, h] = vb.split(' ');
//   return ({
//     cx: x + w / 2,
//     cy: y + h / 2
//   });
// }

const go = () => {

  const path = document.getElementById('path').value;
  const scale = document.getElementById('scale').value;
  const precision = document.getElementById('precision').value;

  const svgArray = [];
  let term = '';
  let hasDecimal = false;

  const add = () => {
    if (term.length) {
      svgArray.push(term);
      term = '';
      hasDecimal = false;
    }
  }

  for (let symbol of path.trim()) {
    if (/\s|,/.test(symbol)) {
      add();
      continue;
    }
    if (/[A-Za-z]/.test(symbol)) {
      add();
      svgArray.push(symbol);
      continue;
    }
    if (/\d/.test(symbol)) {
      term += `${symbol}`;
      continue;
    }
    if (symbol === '.') {
      if (hasDecimal) {
        add();
        term += '0';
      }
      term += symbol;
      hasDecimal = true;
    }
    if (symbol === '-') {
      add();
      term += symbol;
    }
  }
  add();

  const scaledPath = svgArray
    .map(i => /\d/.test(i) ? parseFloat(parseFloat(i * scale).toPrecision(precision)) : i)
    .join(' ')
    .replace(/\s*([A-Za-z])\s*/g, '$1')
    .replace(/ -/g, '-')
    .replace(/-0\./g, '-.');

  document.getElementById('output').textContent = scaledPath;


  document.getElementById('inputPath').setAttribute('d', path);
  const output = document.getElementById('output').textContent;
  document.getElementById('outputPath').setAttribute('d', output);


  const bbIn = document.getElementById('inputPath').getBBox();
  const bbOut = document.getElementById('outputPath').getBBox();

  let bb;
  let ix = 0;
  let iy = 0;
  let ox = 0;
  let oy = 0;
  if (bbIn.width >= bbOut.width) {
    bb = bbIn;
    ox = (bbIn.width - bbOut.width) / 2;
    oy = (bbIn.height - bbOut.height) / 2;
  } else {
    bb = bbOut;
    ix = (bbOut.width - bbIn.width) / 2;
    iy = (bbOut.height - bbIn.height) / 2;
  }

  console.log(bbIn,bbOut,ox,oy,ix,iy);

  document.getElementById('svgInput').setAttribute('viewBox', `${bbIn.x - ix} ${bbIn.y - iy} ${bb.width} ${bb.height}`)
  document.getElementById('svgOutput').setAttribute('viewBox', `${bbOut.x - ox} ${bbOut.y - oy} ${bb.width} ${bb.height}`);
}

document.getElementById('path').addEventListener('input', go);
document.getElementById('scale').addEventListener('input', go);
document.getElementById('precision').addEventListener('input', go);

document.getElementById('copyButton').addEventListener('click', () => {
  navigator.clipboard.writeText(document.getElementById('output').textContent).then(function () {
    M.toast({ html: 'Copied to Clipboard' });
  }, function (err) {
    M.toast({ html: 'Error Copying to Clipboard' });
  });
});