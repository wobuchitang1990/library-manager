/* ===== 数据模块（通过服务端 API，多设备共享同一份数据） ===== */

function getToken() { return sessionStorage.getItem('lib_token') || ''; }
function setToken(t) { sessionStorage.setItem('lib_token', t); }
function isLoggedIn() { return !!getToken(); }
function logout() { sessionStorage.removeItem('lib_token'); location.reload(); }

function api(path, method, body) {
  var opts = { method: method || 'GET', headers: { 'Content-Type': 'application/json' }, cache: 'no-store' };
  var token = getToken();
  if (token) opts.headers['Authorization'] = 'Bearer ' + token;
  if (body) opts.body = JSON.stringify(body);
  // 破缓存：GET 加时间戳
  var url = path;
  if (!method || method === 'GET') {
    url += (path.indexOf('?') === -1 ? '?' : '&') + '_t=' + Date.now();
  }
  return fetch(url, opts).then(function (r) {
    if (!r.ok) throw new Error('API error: ' + r.status);
    return r.json();
  });
}

function openDB() { return Promise.resolve(); } // 兼容旧代码

function getNextNumber() {
  return api('/api/data/books').then(function (books) {
    var max = 0;
    books.forEach(function (b) { if (b.number > max) max = b.number; });
    return max + 1;
  });
}

function isNumberUsed(number, excludeId) {
  return api('/api/data/books').then(function (books) {
    return books.some(function (b) { return b.number === number && b.id !== excludeId; });
  });
}

function addBook(bookData) { return api('/api/data/books', 'POST', bookData); }
function updateBook(id, updates) { return api('/api/data/books/' + id, 'PUT', updates); }
function deleteBook(id) { return api('/api/data/books/' + id, 'DELETE'); }
function getBook(id) { return api('/api/data/books/' + id); }

function getBookByIsbn(isbn) {
  var clean = (isbn || '').replace(/[-\s]/g, '');
  if (!clean) return Promise.resolve(null);
  return api('/api/data/books?q=' + encodeURIComponent(clean)).then(function (books) {
    return books.find(function (b) { return b.isbn === clean; }) || null;
  });
}

function getBookByNumber(number) {
  return api('/api/data/books?q=' + encodeURIComponent(String(number))).then(function (books) {
    return books.find(function (b) { return b.number === number; }) || null;
  });
}

function getAllBooks(opts) {
  opts = opts || {};
  var params = [];
  if (opts.category && opts.category !== '全部') params.push('category=' + encodeURIComponent(opts.category));
  if (opts.status) params.push('status=' + encodeURIComponent(opts.status));
  var qs = params.length > 0 ? '?' + params.join('&') : '';
  return api('/api/data/books' + qs);
}

function searchBooks(query, category) {
  var params = [];
  if (query) params.push('q=' + encodeURIComponent(query));
  if (category && category !== '全部') params.push('category=' + encodeURIComponent(category));
  return api('/api/data/books' + (params.length > 0 ? '?' + params.join('&') : ''));
}

function addBorrowRecord(bookId, borrowerName) {
  return api('/api/data/borrows', 'POST', { bookId: bookId, borrowerName: borrowerName });
}

function returnBook(bookId) {
  return api('/api/data/borrows/return', 'POST', { bookId: bookId });
}

function getBorrowHistory(bookId) {
  return api('/api/data/borrows?bookId=' + bookId);
}

function getRecentActivity(limit) {
  limit = limit || 10;
  return api('/api/data/borrows').then(function (records) {
    return records.slice(0, limit);
  });
}

function getStats() { return api('/api/data/stats'); }

function getBorrowerNames() { return api('/api/data/borrowers'); }
