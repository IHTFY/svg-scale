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

  let svgArray = [];
  let term = '';
  let hasDecimal = false;

  const add = t => {
    if (t.length) {
      if (/^0+[0-9]/.test(t)) {
        add('0');
        add(t.substr(1));
        console.log(0, t.substr(1));
      } else {
        svgArray.push(t);
        term = '';
        hasDecimal = false;
      }
    }
  }

  for (let symbol of path.trim()) {
    if (/\s|,/.test(symbol)) {
      add(term);
      continue;
    }
    if (/[A-Za-z]/.test(symbol)) {
      add(term);
      svgArray.push(symbol);
      continue;
    }
    if (/\d/.test(symbol)) {
      term += `${symbol}`;
      continue;
    }
    if (symbol === '.') {
      if (hasDecimal) {
        add(term);
        term += '0';
      }
      term += symbol;
      hasDecimal = true;
    }
    if (symbol === '-') {
      add(term);
      term += symbol;
    }
  }
  add(term);

  
  for (let i = 0; i < svgArray.length; i++) {
    if (/\d/.test(svgArray[i])) {
      // number
      svgArray[i] = parseFloat(parseFloat(svgArray[i] * scale).toPrecision(precision)); // rx, scale
    } else {
      // do arcs manually
      if (svgArray[i] === 'A' || svgArray[i] === 'a') {
        svgArray[i + 1] = parseFloat(parseFloat(svgArray[i + 1] * scale).toPrecision(precision)); // rx, scale
        svgArray[i + 2] = parseFloat(parseFloat(svgArray[i + 2] * scale).toPrecision(precision)); // ry, scale
        // +3 rotation, don't change
        // +4 boolean flag, don't change
        // +5 boolean flag, don't change
        i += 5; // skip to next argument
      }
    }
  }

  const scaledPath = svgArray
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

  const offset = {
    x: Math.abs(bbIn.width - bbOut.width) / 2,
    y: Math.abs(bbIn.height - bbOut.height) / 2
  };

  if (bbIn.width >= bbOut.width) {
    document.getElementById('svgInput').setAttribute('viewBox', `${bbIn.x} ${bbIn.y} ${bbIn.width} ${bbIn.height}`)
    document.getElementById('svgOutput').setAttribute('viewBox', `${bbOut.x - offset.x} ${bbOut.y - offset.y} ${bbIn.width} ${bbIn.height}`);
  } else {
    document.getElementById('svgInput').setAttribute('viewBox', `${bbIn.x - offset.x} ${bbIn.y - offset.y} ${bbOut.width} ${bbOut.height}`)
    document.getElementById('svgOutput').setAttribute('viewBox', `${bbOut.x} ${bbOut.y} ${bbOut.width} ${bbOut.height}`);
  }

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