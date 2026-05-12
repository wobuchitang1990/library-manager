/* 小小图书馆 HTTPS 服务器 */
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 4433;
const ROOT = __dirname;
const data = require('./server-data.js');
const crypto = require('crypto');

// 简单的 Token 鉴权
var authToken = crypto.randomBytes(16).toString('hex');
function getPassword() { return _config.password || '123456'; }
function checkAuth(req) {
  var auth = req.headers['authorization'] || '';
  return auth === 'Bearer ' + authToken;
}

var _config = {};
try { _config = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8')); } catch (e) {}

function getApiKey() {
  return process.env.DEEPSEEK_API_KEY || _config.deepseekApiKey || '';
}
function getBaiduKeys() {
  return {
    apiKey: process.env.BAIDU_OCR_API_KEY || _config.baiduOcrApiKey || '',
    secretKey: process.env.BAIDU_OCR_SECRET_KEY || _config.baiduOcrSecretKey || ''
  };
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function jsonReply(res, data) {
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'Pragma': 'no-cache'
  });
  res.end(JSON.stringify(data));
}

/* 服务端代理：从豆瓣抓取图书信息 */
function fetchDoubanBook(isbn, callback) {
  var reqUrl = 'https://book.douban.com/isbn/' + encodeURIComponent(isbn) + '/';
  https.get(reqUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } }, function (resp) {
    var body = '';
    resp.on('data', function (chunk) { body += chunk; });
    resp.on('end', function () {
      // 检查是否重定向到 subject 页面
      if (resp.statusCode >= 300 && resp.statusCode < 400 && resp.headers.location) {
        var redirectUrl = resp.headers.location;
        if (redirectUrl.startsWith('/')) redirectUrl = 'https://book.douban.com' + redirectUrl;
        https.get(redirectUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } }, function (resp2) {
          var body2 = '';
          resp2.on('data', function (chunk) { body2 += chunk; });
          resp2.on('end', function () { callback(parseDoubanHTML(body2)); });
        }).on('error', function () { callback(null); });
        return;
      }
      callback(parseDoubanHTML(body));
    });
  }).on('error', function () {
    callback(null);
  });
}

function parseDoubanHTML(html) {
  if (!html) return null;
  try {
    // 提取 title 标签内容
    var titleMatch = html.match(/<title>\s*(.+?)\s*\(豆瓣\)\s*<\/title>/i);
    var title = titleMatch ? titleMatch[1].trim() : '';

    // 提取 meta keywords
    var kwMatch = html.match(/<meta\s+name="keywords"\s+content="([^"]+)"/i);
    var author = '';
    var publisher = '';
    var pubDate = '';
    if (kwMatch) {
      var keywords = kwMatch[1].split(',');
      title = title || (keywords[0] || '').trim();
      // keywords: "解忧杂货店,[日] 东野圭吾,南海出版公司,2014-5,简介,..."
      if (keywords.length > 1) author = keywords[1].trim();
      if (keywords.length > 2) publisher = keywords[2].trim();
      if (keywords.length > 3) pubDate = keywords[3].trim();
    }

    // 提取封面图
    var coverMatch = html.match(/<a[^>]*class="nbg"[^>]*href="([^"]+)"[^>]*>\s*<img[^>]*src="([^"]+)"/i)
      || html.match(/<img[^>]*src="([^"]*\/view\/[^"]+)"[^>]*>/i);
    var coverUrl = coverMatch ? (coverMatch[2] || coverMatch[1]) : null;

    if (!title) return null;
    return { title: title, author: author, publisher: publisher, publishDate: pubDate, coverUrl: coverUrl, source: 'douban' };
  } catch (e) {
    return null;
  }
}

/* 服务端代理：从 Open Library 抓取（海外可用） */
function fetchOpenLibrary(isbn, callback) {
  var apiUrl = 'https://openlibrary.org/api/books?bibkeys=ISBN:' + isbn + '&format=json&jscmd=data';
  https.get(apiUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } }, function (resp) {
    var body = '';
    resp.on('data', function (chunk) { body += chunk; });
    resp.on('end', function () {
      try {
        var data = JSON.parse(body);
        var key = 'ISBN:' + isbn;
        var info = data[key];
        if (!info) { callback(null); return; }
        var author = '';
        if (info.authors && info.authors.length > 0) {
          author = info.authors.map(function (a) { return a.name; }).join(', ');
        }
        var coverUrl = null;
        if (info.cover) coverUrl = info.cover.medium || info.cover.small || info.cover.large || null;
        callback({ title: info.title || '', author: author, publisher: '', coverUrl: coverUrl, source: 'openlib' });
      } catch (e) { callback(null); }
    });
  }).on('error', function () { callback(null); });
}

/* 百度 OCR（国内最佳中文识别） */
var _baiduToken = null;
var _baiduTokenExpiry = 0;
function getBaiduToken(keys, callback) {
  if (_baiduToken && Date.now() < _baiduTokenExpiry) { callback(_baiduToken); return; }
  var authUrl = '/oauth/2.0/token?grant_type=client_credentials&client_id=' + encodeURIComponent(keys.apiKey) + '&client_secret=' + encodeURIComponent(keys.secretKey);
  var req = https.request({ hostname: 'aip.baidubce.com', path: authUrl, method: 'POST' }, function (resp) {
    var data = ''; resp.on('data', function (c) { data += c; });
    resp.on('end', function () {
      try { var j = JSON.parse(data); _baiduToken = j.access_token; _baiduTokenExpiry = Date.now() + (j.expires_in - 300) * 1000; callback(_baiduToken); }
      catch (e) { callback(null); }
    });
  });
  req.on('error', function () { callback(null); });
  req.end();
}

function doBaiduOCR(base64Image, keys, callback) {
  getBaiduToken(keys, function (token) {
    if (!token) { callback(null); return; }
    var postStr = 'image=' + encodeURIComponent(base64Image) + '&language_type=CHN_ENG&detect_direction=true&paragraph=true';
    var req = https.request({
      hostname: 'aip.baidubce.com',
      path: '/rest/2.0/ocr/v1/accurate_basic?access_token=' + token,
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(postStr) }
    }, function (resp) {
      var data = ''; resp.on('data', function (c) { data += c; });
      resp.on('end', function () {
        try {
          var j = JSON.parse(data);
          if (j.words_result && j.words_result.length > 0) {
            callback(j.words_result.map(function (w) { return w.words; }).join('\n'));
          } else { callback(null); }
        } catch (e) { callback(null); }
      });
    });
    req.on('error', function () { callback(null); });
    req.write(postStr);
    req.end();
  });
}

function doOcrSpace(base64Image, callback) {
  var postData = new URLSearchParams();
  postData.append('base64Image', 'data:image/jpeg;base64,' + base64Image);
  postData.append('language', 'chs');
  postData.append('isOverlayRequired', 'false');
  postData.append('OCREngine', '2');
  postData.append('scale', 'true');
  postData.append('detectOrientation', 'true');
  var postStr = postData.toString();
  var req = https.request({
    hostname: 'api.ocr.space',
    path: '/parse/image',
    method: 'POST',
    headers: { 'apikey': 'helloworld', 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(postStr) }
  }, function (resp) {
    var data = ''; resp.on('data', function (c) { data += c; });
    resp.on('end', function () {
      try { var r = JSON.parse(data); callback(r && r.ParsedResults && r.ParsedResults.length > 0 ? r.ParsedResults[0].ParsedText || '' : null); }
      catch (e) { callback(null); }
    });
  });
  req.on('error', function () { callback(null); });
  req.write(postStr);
  req.end();
}

var USE_HTTPS = false;
try { if (fs.existsSync(path.join(ROOT, 'server.key'))) USE_HTTPS = true; } catch (e) {}

var server;
if (USE_HTTPS) {
  server = https.createServer({
    key: fs.readFileSync(path.join(ROOT, 'server.key')),
    cert: fs.readFileSync(path.join(ROOT, 'server.crt'))
  }, requestHandler);
} else {
  server = http.createServer(requestHandler);
}

function requestHandler(req, res) {
  var parsed = url.parse(req.url, true);
  var pathname = parsed.pathname;

  // API: ISBN 查询
  if (pathname === '/api/book') {
    var isbn = (parsed.query.isbn || '').replace(/[-\s]/g, '');
    if (!isbn || isbn.length < 10) {
      jsonReply(res, { error: 'Invalid ISBN' });
      return;
    }

    // 先尝试豆瓣（国内快），5秒超时后尝试 Open Library
    var done = false;
    var timer = setTimeout(function () {
      if (!done) {
        // 豆瓣超时，尝试 Open Library
        fetchOpenLibrary(isbn, function (data) {
          if (done) return;
          done = true;
          if (data) { jsonReply(res, data); }
          else { jsonReply(res, { error: 'Book not found' }); }
        });
      }
    }, 5000);

    fetchDoubanBook(isbn, function (data) {
      if (done) return;
      clearTimeout(timer);
      done = true;
      if (data) { jsonReply(res, data); }
      else {
        // 豆瓣失败，尝试 Open Library
        fetchOpenLibrary(isbn, function (data2) {
          if (done) return;
          done = true;
          if (data2) { jsonReply(res, data2); }
          else { jsonReply(res, { error: 'Book not found' }); }
        });
      }
    });
    return;
  }

  // API: OCR 封面识别（POST）
  if (pathname === '/api/ocr' && req.method === 'POST') {
    var body = '';
    req.on('data', function (chunk) { body += chunk; });
    req.on('end', function () {
      try {
        var payload = JSON.parse(body);
        var base64Image = payload.image;
        if (!base64Image) { jsonReply(res, { error: 'No image' }); return; }

        var baidu = getBaiduKeys();
        if (baidu.apiKey && baidu.secretKey) {
          // 百度 OCR（中文最佳）
          doBaiduOCR(base64Image, baidu, function (text) {
            if (text) { jsonReply(res, { text: text }); }
            else { doOcrSpace(base64Image, function (t) { jsonReply(res, t ? { text: t } : { error: 'No text' }); }); }
          });
        } else {
          // 回退到 OCR.space
          doOcrSpace(base64Image, function (t) { jsonReply(res, t ? { text: t } : { error: 'No text' }); });
        }
      } catch (e) { jsonReply(res, { error: 'Invalid request' }); }
    });
    return;
  }

  // API: 条码识别（服务端，百度API）
  if (pathname === '/api/barcode' && req.method === 'POST') {
    var bcBody = '';
    req.on('data', function (chunk) { bcBody += chunk; });
    req.on('end', function () {
      try {
        var bcPayload = JSON.parse(bcBody);
        var bcImage = bcPayload.image;
        if (!bcImage) { jsonReply(res, { error: 'No image' }); return; }
        var baidu = getBaiduKeys();
        if (!baidu.apiKey || !baidu.secretKey) { jsonReply(res, { error: 'No Baidu keys' }); return; }
        getBaiduToken(baidu, function (token) {
          if (!token) { jsonReply(res, { error: 'Auth failed' }); return; }
          var postStr = 'image=' + encodeURIComponent(bcImage);
          var bcr = https.request({
            hostname: 'aip.baidubce.com',
            path: '/rest/2.0/ocr/v1/qrcode?access_token=' + token,
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(postStr) }
          }, function (resp) {
            var d = ''; resp.on('data', function (c) { d += c; });
            resp.on('end', function () {
              try {
                var j = JSON.parse(d);
                if (j.codes_result && j.codes_result.length > 0) {
                  var codes = j.codes_result.map(function (c) { return c.text ? c.text[0] : ''; }).filter(Boolean);
                  jsonReply(res, { codes: codes });
                } else { jsonReply(res, { codes: [] }); }
              } catch (e) { jsonReply(res, { error: 'Parse error' }); }
            });
          });
          bcr.on('error', function () { jsonReply(res, { error: 'API error' }); });
          bcr.write(postStr); bcr.end();
        });
      } catch (e) { jsonReply(res, { error: 'Invalid request' }); }
    });
    return;
  }

  // API: AI 解析书名作者
  if (pathname === '/api/ai-parse' && req.method === 'POST') {
    var aiBody = '';
    req.on('data', function (chunk) { aiBody += chunk; });
    req.on('end', function () {
      try {
        var aiPayload = JSON.parse(aiBody);
        var ocrText = aiPayload.text;
        if (!ocrText || ocrText.trim().length < 2) { jsonReply(res, { error: 'No text' }); return; }

        var apiKey = getApiKey();
        if (!apiKey) {
          // 没有 API Key，返回本地解析结果
          jsonReply(res, { error: 'No API key configured. Set DEEPSEEK_API_KEY environment variable.' });
          return;
        }

        var prompt = '你是一个图书识别助手。下面是从一本书封面通过OCR识别出的文字，可能包含书名、作者、出版社、推荐语等碎片信息。请从中识别出准确的【书名】和【作者】。\n\n规则：\n1. 书名通常是封面上字体最大的文字，去掉出版社名和宣传语\n2. 作者通常带"著""编""译"等字，或带有[日][美]等国别标记\n3. 只返回JSON格式: {"title":"书名","author":"作者"}\n4. 不确定就返回 {"title":"","author":""}\n\nOCR识别的文字：\n' + ocrText;

        var aiReqData = JSON.stringify({
          model: 'deepseek-chat',
          messages: [
            { role: 'system', content: '你是一个精确的图书识别助手。只返回JSON。' },
            { role: 'user', content: prompt }
          ],
          temperature: 0.1,
          max_tokens: 200
        });

        var aiOptions = {
          hostname: 'api.deepseek.com',
          path: '/v1/chat/completions',
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + apiKey,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(aiReqData)
          }
        };

        var aiApiReq = https.request(aiOptions, function (aiRes) {
          var aiData = '';
          aiRes.on('data', function (chunk) { aiData += chunk; });
          aiRes.on('end', function () {
            try {
              var aiResult = JSON.parse(aiData);
              if (aiResult.choices && aiResult.choices.length > 0) {
                var content = aiResult.choices[0].message.content;
                // 解析 AI 返回的 JSON
                var jsonMatch = content.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                  var parsed = JSON.parse(jsonMatch[0]);
                  jsonReply(res, {
                    title: parsed.title || '',
                    author: parsed.author || '',
                    source: 'ai-deepseek'
                  });
                } else {
                  jsonReply(res, { error: 'AI returned non-JSON' });
                }
              } else {
                jsonReply(res, { error: 'AI API error: ' + (aiResult.error && aiResult.error.message || 'unknown') });
              }
            } catch (e) { jsonReply(res, { error: 'Parse AI response failed' }); }
          });
        });
        aiApiReq.on('error', function () { jsonReply(res, { error: 'AI API unreachable' }); });
        aiApiReq.write(aiReqData);
        aiApiReq.end();
      } catch (e) { jsonReply(res, { error: 'Invalid request' }); }
    });
    return;
  }

  // === 登录 API ===
  if (pathname === '/api/login' && req.method === 'POST') {
    var loginBody = '';
    req.on('data', function (c) { loginBody += c; });
    req.on('end', function () {
      try {
        var lp = JSON.parse(loginBody);
        if (lp.password === getPassword()) {
          jsonReply(res, { token: authToken });
        } else {
          res.writeHead(401);
          res.end(JSON.stringify({ error: '密码错误' }));
        }
      } catch (e) { res.writeHead(400); res.end(JSON.stringify({ error: '请求无效' })); }
    });
    return;
  }

  // === 修改密码 API ===
  if (pathname === '/api/change-password' && req.method === 'POST') {
    var cpBody = '';
    req.on('data', function (c) { cpBody += c; });
    req.on('end', function () {
      try {
        var cp = JSON.parse(cpBody);
        if (!cp.oldPassword || !cp.newPassword) { jsonReply(res, { error: '请填写完整' }); return; }
        if (cp.oldPassword !== getPassword()) { jsonReply(res, { error: '当前密码错误' }); return; }
        if (cp.newPassword.length < 1) { jsonReply(res, { error: '新密码不能为空' }); return; }
        _config.password = cp.newPassword;
        fs.writeFileSync(path.join(ROOT, 'config.json'), JSON.stringify(_config, null, 2), 'utf8');
        authToken = crypto.randomBytes(16).toString('hex'); // 重新生成token，所有设备需重新登录
        jsonReply(res, { success: true, token: authToken });
      } catch (e) { jsonReply(res, { error: '保存失败' }); }
    });
    return;
  }

  // === REST API: 图书/借阅数据（需要登录） ===
  if (pathname.indexOf('/api/data/') === 0 && !checkAuth(req)) {
    res.writeHead(401);
    res.end(JSON.stringify({ error: '请先登录' }));
    return;
  }
  function readBody(cb) {
    var b = ''; req.on('data', function (c) { b += c; }); req.on('end', function () { try { cb(JSON.parse(b)); } catch(e) { cb({}); } });
  }

  // GET /api/data/books
  if (pathname === '/api/data/books' && req.method === 'GET') {
    var query = parsed.query.q || '';
    var category = parsed.query.category || '';
    var status = parsed.query.status || '';
    var books = data.getAllBooks();
    if (category && category !== '全部') books = books.filter(function (b) { return b.category === category; });
    if (status === '在库') books = books.filter(function (b) { return b.status === '在库'; });
    if (status === '借出') books = books.filter(function (b) { return b.status === '借出'; });
    if (query) {
      var q = query.toLowerCase();
      books = books.filter(function (b) {
        return String(b.number).includes(q) || (b.title && b.title.toLowerCase().includes(q)) || (b.author && b.author.toLowerCase().includes(q)) || (b.isbn && b.isbn.includes(q));
      });
    }
    jsonReply(res, books);
    return;
  }

  // POST /api/data/books
  if (pathname === '/api/data/books' && req.method === 'POST') {
    readBody(function (body) {
      var result = data.addBook(body);
      if (result.error) { jsonReply(res, result); }
      else { jsonReply(res, result.book); }
    });
    return;
  }

  // GET/PUT/DELETE /api/data/books/:id
  var bookMatch = pathname.match(/^\/api\/data\/books\/(\d+)$/);
  if (bookMatch) {
    var bookId = parseInt(bookMatch[1]);
    if (req.method === 'GET') {
      var book = data.getBook(bookId);
      jsonReply(res, book || { error: 'Not found' });
    } else if (req.method === 'PUT') {
      readBody(function (body) {
        var result = data.updateBook(bookId, body);
        if (result.error) { jsonReply(res, result); }
        else { jsonReply(res, result.book); }
      });
    } else if (req.method === 'DELETE') {
      jsonReply(res, data.deleteBook(bookId));
    }
    return;
  }

  // GET /api/data/borrows
  if (pathname === '/api/data/borrows' && req.method === 'GET') {
    var bookIdParam = parsed.query.bookId;
    if (bookIdParam) {
      jsonReply(res, data.getBorrowHistory(parseInt(bookIdParam)));
    } else {
      jsonReply(res, data.getAllBorrowRecords());
    }
    return;
  }

  // POST /api/data/borrows
  if (pathname === '/api/data/borrows' && req.method === 'POST') {
    readBody(function (body) {
      jsonReply(res, data.addBorrowRecord(body.bookId, body.borrowerName));
    });
    return;
  }

  // POST /api/data/borrows/return (按 bookId 归还)
  if (pathname === '/api/data/borrows/return' && req.method === 'POST') {
    readBody(function (body) {
      jsonReply(res, data.returnBook(body.bookId));
    });
    return;
  }

  // GET /api/data/stats
  if (pathname === '/api/data/stats' && req.method === 'GET') {
    jsonReply(res, data.getStats());
    return;
  }

  // GET /api/data/borrowers
  if (pathname === '/api/data/borrowers' && req.method === 'GET') {
    jsonReply(res, data.getBorrowerNames());
    return;
  }

  // === 静态文件服务 ===
  var filePath = path.join(ROOT, pathname === '/' ? 'index.html' : pathname.split('?')[0]);
  var ext = path.extname(filePath).toLowerCase();
  fs.readFile(filePath, function (err, data) {
    if (err) {
      if (!ext || ext === '.html') {
        fs.readFile(path.join(ROOT, 'index.html'), function (err2, html) {
          if (err2) { res.writeHead(404); res.end('Not Found'); }
          else { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html); }
        });
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

server.listen(PORT, '0.0.0.0', function () {
  console.log('HTTPS 服务器已启动: https://localhost:' + PORT);
  var os = require('os');
  var ifaces = os.networkInterfaces();
  Object.keys(ifaces).forEach(function (name) {
    ifaces[name].forEach(function (iface) {
      if (iface.family === 'IPv4' && !iface.internal) {
        console.log('手机访问: https://' + iface.address + ':' + PORT);
      }
    });
  });
  console.log('注意：自签名证书会显示安全警告，点击"高级→继续访问"即可');
  console.log('登录密码: ' + getPassword() + '（可在 config.json 中修改）');
  var baidu = getBaiduKeys();
  if (baidu.apiKey && baidu.secretKey) {
    console.log('✅ 百度 OCR 已配置（中文识别最准）');
  } else {
    console.log('⚠️  未配置百度 OCR，使用 OCR.space（识别效果一般）');
    console.log('   注册 https://console.bce.baidu.com/ai/#/ai/ocr/overview');
    console.log('   获取 API Key 和 Secret Key 后：');
    console.log('   set BAIDU_OCR_API_KEY=xxx');
    console.log('   set BAIDU_OCR_SECRET_KEY=xxx');
    console.log('   node server.js');
  }
  if (!getApiKey()) {
    console.log('⚠️  未设置 DEEPSEEK_API_KEY，AI 封面解析不可用');
  } else {
    console.log('✅ DeepSeek API Key 已配置，AI 封面解析可用');
  }
});
