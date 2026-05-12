/* ===== 封面 OCR 识别（纯 OCR，不含条码） ===== */
function recognizeCover(file, callback) {
  preprocessForOCR(file, function (processedBlob) {
    cloudOCR(processedBlob, function (ocrText) {
      if (!ocrText || ocrText.trim().length < 2) { callback(null); return; }
      var lines = tokenize(ocrText);
      if (lines.length === 0) { callback(null); return; }
      aiParseBookInfo(ocrText, function (ai) {
        if (ai && ai.title) { callback({ title: ai.title, author: ai.author || '', lines: lines, rawText: ocrText.substring(0, 300), source: 'ai-deepseek' }); }
        else { var local = parseBookInfo(ocrText); callback({ title: local ? local.title : (lines[0] || ''), author: local ? local.author : '', lines: lines, rawText: ocrText.substring(0, 300), source: 'ocr' }); }
      });
    });
  });
}

/* ===== 图片预处理：增强字体识别 =====
   灰度 → 对比增强 → 自适应二值化 → 锐化
   处理后不同字体（宋体/黑体/艺术字/彩色字）都变清晰黑白 */
function preprocessForOCR(file, callback) {
  var img = new Image();
  var url = URL.createObjectURL(file);
  img.onload = function () {
    URL.revokeObjectURL(url);
    var maxDim = 1200; // 缩小加快上传
    var w = img.width, h = img.height;
    if (w > maxDim || h > maxDim) {
      var r = Math.min(maxDim / w, maxDim / h);
      w = Math.round(w * r); h = Math.round(h * r);
    }
    var canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    var ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);

    // 获取像素
    var imageData = ctx.getImageData(0, 0, w, h);
    var data = imageData.data;
    var len = data.length;

    // 第一步：灰度 + 对比度增强
    for (var i = 0; i < len; i += 4) {
      var gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      // 对比度拉伸: (gray - 128) * 1.8 + 128
      gray = (gray - 128) * 1.8 + 128;
      gray = Math.max(0, Math.min(255, gray));
      data[i] = data[i + 1] = data[i + 2] = gray;
    }

    // 第二步：自适应二值化（大津法 Otsu）
    var histogram = new Array(256).fill(0);
    for (var i2 = 0; i2 < len; i2 += 4) histogram[data[i2]]++;

    var totalPx = w * h;
    var sum = 0;
    for (var t = 0; t < 256; t++) sum += t * histogram[t];
    var sumB = 0, wB = 0, wF = 0, maxVariance = 0, threshold = 128;
    for (var t2 = 0; t2 < 256; t2++) {
      wB += histogram[t2];
      if (wB === 0) continue;
      wF = totalPx - wB;
      if (wF === 0) break;
      sumB += t2 * histogram[t2];
      var mB = sumB / wB;
      var mF = (sum - sumB) / wF;
      var variance = wB * wF * (mB - mF) * (mB - mF);
      if (variance > maxVariance) { maxVariance = variance; threshold = t2; }
    }

    // 应用二值化
    for (var i3 = 0; i3 < len; i3 += 4) {
      var val = data[i3] > threshold ? 255 : 0;
      data[i3] = data[i3 + 1] = data[i3 + 2] = val;
    }

    ctx.putImageData(imageData, 0, 0);
    canvas.toBlob(function (blob) { callback(blob || file); }, 'image/jpeg', 0.85);
  };
  img.onerror = function () { URL.revokeObjectURL(url); callback(file); };
  img.src = url;
}

/* ===== 条码扫描（同之前） ===== */
function scanBarcodeFromPhoto(file, callback) {
  compressForBarcode(file, 1920).then(function (blob) {
    var f = new File([blob], 'scan.jpg', { type: 'image/jpeg' });
    var done = false;

    tryBarcodeWithHtml5Qr(f, function (r) { if (!done && r) { done = true; callback(r); } });
    setTimeout(function () {
      if (!done) tryBarcodeWithQuagga(f, function (r) { if (!done && r) { done = true; callback(r); } });
      if (!done) { done = true; callback(null); }
    }, 3000);
  });
}

function tryBarcodeWithHtml5Qr(file, cb) {
  var el = document.createElement('div'); el.style.display = 'none'; document.body.appendChild(el);
  var tid = 'bc-' + Date.now(); el.id = tid;
  try {
    var s = new Html5Qrcode(tid);
    s.scanFile(file, false).then(function (t) { var c = (t || '').replace(/[-\s]/g, ''); cb(c.length >= 10 && /^\d{9,13}[\dXx]$/.test(c) ? c : null); })
      .catch(function () { cb(null); }).finally(function () { try { s.clear(); } catch(e) {}; el.remove(); });
  } catch(e) { el.remove(); cb(null); }
}

function tryBarcodeWithQuagga(file, cb) {
  if (typeof Quagga === 'undefined') { cb(null); return; }
  var url = URL.createObjectURL(file), img = new Image();
  img.onload = function () { URL.revokeObjectURL(url);
    try { Quagga.decodeSingle({ src: img, numOfWorkers: 2, decoder: { readers: ['ean_reader','ean_8_reader'] } }, function (r) { cb(r && r.codeResult ? r.codeResult.code : null); }); }
    catch(e) { cb(null); }
  };
  img.onerror = function () { URL.revokeObjectURL(url); cb(null); };
  img.src = url;
}

/* ===== OCR / AI ===== */
function cloudOCR(file, cb) {
  var reader = new FileReader();
  reader.onload = function () {
    fetch('/api/ocr', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: reader.result.split(',')[1] })
    }).then(function (r) { return r.json(); }).then(function (d) { cb(d && d.text ? d.text : null); }).catch(function () { cb(null); });
  };
  reader.onerror = function () { cb(null); };
  reader.readAsDataURL(file);
}

function aiParseBookInfo(text, cb) {
  fetch('/api/ai-parse', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: text })
  }).then(function (r) { return r.json(); }).then(function (d) { cb(d && !d.error && d.title ? d : null); }).catch(function () { cb(null); });
}

function parseBookInfo(text) {
  var lines = text.split(/\n|\r\n?/).map(function(l){return l.replace(/^\s+|\s+$/g,'');}).filter(function(l){return l.length>1;});
  if (!lines.length) return null;
  var author='', authorIdx=-1;
  for (var i=0;i<lines.length;i++) { if (/[著编撰译]/.test(lines[i]) && lines[i].length<30) { author=lines[i].replace(/[\[［].+?[\]］]/g,'').replace(/\s*[著编撰译]+.*$/,'').replace(/\s+/g,'').trim(); authorIdx=i; break; } }
  var c=lines.filter(function(l,i){return i!==authorIdx&&l.length>1;});
  c.sort(function(a,b){return b.length-a.length;});
  var title=c.length>0?c[0].replace(/^\s*[\[〔【\(（].*?[\]〕】\)）]\s*/,'').trim():'';
  return title?{title:title,author:author}:null;
}

function tokenize(text) {
  var lines = text.split(/\n|\r\n?|\|/).map(function(l){return l.replace(/^\s+|\s+$/g,'');}).filter(function(l){return l.length>=2&&l.length<80;});
  var seen={}, clean=[];
  lines.forEach(function(l){if(!seen[l]&&!/^[0-9\s\.\,\;\:\!\?\-—·]+$/.test(l)&&l.length>1){seen[l]=true;clean.push(l);}});
  return clean;
}

function compressForBarcode(file, maxDim) {
  return new Promise(function (resolve) {
    var img = new Image(), url = URL.createObjectURL(file);
    img.onload = function () { URL.revokeObjectURL(url); var w=img.width,h=img.height; if(w<=maxDim&&h<=maxDim){resolve(file);return;} var r=Math.min(maxDim/w,maxDim/h); var c=document.createElement('canvas');c.width=Math.round(w*r);c.height=Math.round(h*r);c.getContext('2d').drawImage(img,0,0,c.width,c.height);c.toBlob(function(b){resolve(b||file);},'image/jpeg',0.9); };
    img.onerror = function () { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}
