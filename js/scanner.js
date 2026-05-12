/* ===== 扫码模块 =====
   拍照后用多引擎、多尺度并行解码 */

var _photoScanCallback = null;

function startScanner(elementId, onScanCallback, mode) {
  stopScanner();
  mode = mode || 'inventory';
  var el = document.getElementById(elementId);
  if (!el) return;
  _photoScanCallback = onScanCallback;
  renderPhotoCapture(el, mode);
}

function renderPhotoCapture(el, mode) {
  var ts = Date.now();
  var inputId = 'photo-input-' + ts;
  var hint = mode === 'isbn' ? '📷 对准图书上的ISBN条形码拍照' : '📷 对准图书上的条形码拍照';

  el.innerHTML =
    '<div class="photo-scan-area">' +
      '<span class="photo-icon" style="font-size:3rem">📸</span>' +
      '<p style="font-size:1rem;margin-bottom:4px">' + hint + '</p>' +
      '<p style="font-size:0.78rem;color:var(--color-text-light);margin-bottom:16px">光线充足、手持平稳、条形码占画面一半以上效果最佳</p>' +
      '<input type="file" id="' + inputId + '" accept="image/*" capture="environment" style="display:none">' +
      '<button class="btn btn-success btn-block" id="btn-photo-' + ts + '" style="font-size:1.1rem;padding:16px">📸 拍照识别</button>' +
      '<p style="font-size:0.7rem;color:var(--color-text-light);margin-top:10px">点击后打开相机，拍照自动识别</p>' +
    '</div>';

  document.getElementById('btn-photo-' + ts).addEventListener('click', function () {
    document.getElementById(inputId).click();
  });

  document.getElementById(inputId).addEventListener('change', function (e) {
    var file = e.target.files[0];
    if (!file) return;
    var photoArea = el.querySelector('.photo-scan-area');
    if (photoArea) {
      photoArea.innerHTML =
        '<span class="photo-icon" style="font-size:2rem">🔍</span>' +
        '<p style="font-size:0.95rem;margin-top:8px">正在识别条形码...</p>';
    }
    decodePhoto(file, function (result) {
      if (result && _photoScanCallback) {
        _photoScanCallback(result);
      } else {
        var pa = el.querySelector('.photo-scan-area');
        if (pa) {
          pa.innerHTML =
            '<span class="photo-icon" style="font-size:2rem">😞</span>' +
            '<p style="font-size:0.9rem;margin:8px 0;color:var(--color-crayon-orange)">未能识别条形码</p>' +
            '<p style="font-size:0.78rem;color:var(--color-text-light);margin-bottom:12px">试试: 靠近一点拍、光线亮一点、保持手机稳定</p>' +
            '<button class="btn btn-outline btn-sm" onclick="retryScanner()">🔄 重试</button>';
        }
      }
    });
  });
}

/* ===== 核心解码：多引擎 + 多尺度 ===== */
function decodePhoto(file, callback) {
  var url = URL.createObjectURL(file);
  var img = new Image();
  img.onload = function () {
    URL.revokeObjectURL(url);
    tryAllDecoders(img, callback);
  };
  img.onerror = function () {
    URL.revokeObjectURL(url);
    callback(null);
  };
  img.src = url;
}

function tryAllDecoders(img, callback) {
  var w = img.width, h = img.height;
  var canvas = document.createElement('canvas');
  var ctx = canvas.getContext('2d');

  // 生成多个尺度的画布用于尝试
  var scales = [
    { scale: 0.4, label: 'small' },
    { scale: 0.7, label: 'medium' },
    { scale: 1.0, label: 'full' }
  ];

  var tried = 0;
  var done = false;

  function next() {
    tried++;
    if (tried >= scales.length * 2 && !done) { done = true; callback(null); }
  }

  scales.forEach(function (s) {
    var sw = Math.round(w * s.scale);
    var sh = Math.round(h * s.scale);
    canvas.width = sw;
    canvas.height = sh;

    // 尝试 1: 原色
    ctx.filter = 'none';
    ctx.drawImage(img, 0, 0, sw, sh);
    tryDecodeCanvas(canvas, function (result) {
      if (!done && result) { done = true; callback(result); return; }
      next();
    });

    // 尝试 2: 灰度 + 增强对比度
    var dataUrl = getProcessedDataUrl(img, sw, sh);
    var img2 = new Image();
    img2.onload = function () {
      canvas.width = sw;
      canvas.height = sh;
      ctx.filter = 'none';
      ctx.drawImage(img2, 0, 0);
      tryDecodeCanvas(canvas, function (result) {
        if (!done && result) { done = true; callback(result); return; }
        next();
      });
    };
    img2.onerror = function () { next(); };
    img2.src = dataUrl;
  });
}

/* 在 Canvas 上用 quagga2 解码 */
function tryDecodeCanvas(canvas, callback) {
  try {
    Quagga.decodeSingle({
      src: canvas,
      numOfWorkers: 2,
      decoder: {
        readers: ['ean_reader', 'ean_8_reader', 'upc_reader', 'upc_e_reader']
      }
    }, function (result) {
      if (result && result.codeResult && result.codeResult.code) {
        callback(result.codeResult.code);
      } else {
        callback(null);
      }
    });
  } catch (e) {
    callback(null);
  }
}

/* 生成预处理图片（灰度+对比度+锐化） */
function getProcessedDataUrl(img, w, h) {
  var canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  var ctx = canvas.getContext('2d');
  ctx.filter = 'grayscale(1) contrast(1.4) brightness(1.05)';
  ctx.drawImage(img, 0, 0, w, h);

  // 再叠一层轻微锐化
  var imageData = ctx.getImageData(0, 0, w, h);
  var data = imageData.data;
  var stride = w * 4;
  for (var y = 1; y < h - 1; y++) {
    for (var x = 1; x < w - 1; x++) {
      var i = y * stride + x * 4;
      // 简单拉普拉斯锐化
      var val = 5 * data[i] - data[i - 4] - data[i + 4] - data[i - stride] - data[i + stride];
      data[i] = Math.max(0, Math.min(255, val));
      data[i + 1] = data[i];
      data[i + 2] = data[i];
    }
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/jpeg', 0.92);
}

/* ===== 生命周期 ===== */
function stopScanner() { _photoScanCallback = null; }
function retryScanner() { route(); }

/* 保留照片文件解码备用 */
function scanImageFile(file) {
  if (!file) return Promise.resolve(null);
  return new Promise(function (resolve) {
    decodePhoto(file, function (result) { resolve(result || null); });
  });
}
