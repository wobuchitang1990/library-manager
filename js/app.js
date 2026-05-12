/* ===== 小小图书馆 —— 应用主模块 ===== */

var CATEGORIES = ['全部', '绘本', '科普', '文学', '历史', '艺术', '教辅', '其他'];

var _currentView = null;
var _deferredPrompt = null;

/* ===== 初始化 ===== */


/* 登录相关全局函数（HTML onclick 调用） */
function doLogin() {
  var pw = document.getElementById('login-password').value;
  if (!pw) return;
  var btn = document.getElementById('login-btn');
  btn.disabled = true; btn.textContent = '验证中...';
  document.getElementById('login-error').textContent = '';
  fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }) })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (data.token) {
        setToken(data.token);
        document.getElementById('login-overlay').style.display = 'none';
        document.getElementById('app-header').style.display = '';
        document.getElementById('main-content').style.display = '';
        document.getElementById('tab-bar').style.display = '';
        document.getElementById('fab-add').style.display = '';
        initApp();
      } else {
        document.getElementById('login-error').textContent = data.error || '密码错误';
        btn.disabled = false; btn.textContent = '进入';
      }
    }).catch(function () {
      document.getElementById('login-error').textContent = '网络错误，请检查服务器';
      btn.disabled = false; btn.textContent = '进入';
    });
}

function showChangePwForm() {
  document.getElementById('login-form').style.display = 'none';
  document.getElementById('change-pw-form').style.display = 'block';
}

function hideChangePwForm() {
  document.getElementById('change-pw-form').style.display = 'none';
  document.getElementById('login-form').style.display = 'block';
  document.getElementById('cp-error').textContent = '';
  document.getElementById('cp-success').textContent = '';
}

function doChangePassword() {
  var oldPw = document.getElementById('cp-old-pw').value;
  var newPw = document.getElementById('cp-new-pw').value;
  if (!oldPw || !newPw) { document.getElementById('cp-error').textContent = '请填写完整'; return; }
  var btn = document.getElementById('change-pw-btn');
  btn.disabled = true; btn.textContent = '修改中...';
  document.getElementById('cp-error').textContent = '';
  document.getElementById('cp-success').textContent = '';
  fetch('/api/change-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ oldPassword: oldPw, newPassword: newPw }) })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      btn.disabled = false; btn.textContent = '确认修改';
      if (data.error) { document.getElementById('cp-error').textContent = data.error; }
      else {
        document.getElementById('cp-success').textContent = '密码修改成功！请用新密码登录';
        document.getElementById('cp-old-pw').value = '';
        document.getElementById('cp-new-pw').value = '';
        setToken('');
        setTimeout(hideChangePwForm, 1500);
      }
    }).catch(function () {
      btn.disabled = false; btn.textContent = '确认修改';
      document.getElementById('cp-error').textContent = '网络错误';
    });
}

function init() {
  if (!isLoggedIn()) {
    document.getElementById('login-overlay').style.display = 'flex';
    document.getElementById('app-header').style.display = 'none';
    document.getElementById('main-content').style.display = 'none';
    document.getElementById('tab-bar').style.display = 'none';
    document.getElementById('fab-add').style.display = 'none';
    document.getElementById('login-password').focus();
    return;
  }
  initApp();
}
function initApp() {
  // 验证 Token 是否有效
  fetch('/api/data/stats?_t=' + Date.now(), { headers: { 'Authorization': 'Bearer ' + getToken() } })
    .then(function (r) {
      if (r.status === 401) { logout(); return; }
      startApp();
    }).catch(function () { startApp(); });

  function startApp() {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('./sw.js').catch(function () {});
      });
    }
    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      _deferredPrompt = e;
      showInstallBanner();
    });
    window.addEventListener('hashchange', route);
    if (!location.hash) location.hash = '#home';
    document.querySelectorAll('#tab-bar .tab-btn').forEach(function (btn) {
      btn.addEventListener('click', function () { location.hash = '#' + btn.dataset.view; });
    });
    document.getElementById('fab-add').addEventListener('click', function () { location.hash = '#add'; });
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && _currentView) route();
    });
    route();
    document.getElementById('toast-container').addEventListener('click', function (e) {
      var toast = e.target.closest('.toast');
      if (toast) toast.remove();
    });
  }
}

/* ===== 路由 ===== */

function route() {
  var hash = location.hash || '#home';
  var parts = hash.replace('#', '').split('/');
  var view = parts[0];
  var param = parts[1];
  _currentView = view;

  document.querySelectorAll('#tab-bar .tab-btn').forEach(function (btn) {
    btn.classList.toggle('active', btn.dataset.view === view);
  });

  if (view === 'add' || view === 'detail') {
    document.querySelectorAll('#tab-bar .tab-btn').forEach(function (b) { b.classList.remove('active'); });
  }

  var titles = { home: '首页', browse: '浏览', borrow: '借阅', return: '归还', add: '添加图书', detail: '图书详情' };
  document.getElementById('header-title').textContent = '小小图书馆';
  document.getElementById('header-subtitle').textContent = titles[view] || '';

  var main = document.getElementById('main-content');
  main.innerHTML = '';

  switch (view) {
    case 'home':   renderHome(main); break;
    case 'browse': renderBrowse(main, param); break;
    case 'add':    renderAdd(main); break;
    case 'borrow': renderBorrow(main); break;
    case 'return': renderReturn(main); break;
    case 'detail': renderDetail(main, parseInt(param)); break;
    default:       renderHome(main);
  }

  main.scrollTop = 0;
}

/* ===== Toast 提示 ===== */

function showToast(message, type) {
  type = type || 'info';
  var container = document.getElementById('toast-container');
  var el = document.createElement('div');
  el.className = 'toast toast-' + type;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(function () {
    el.style.opacity = '0';
    el.style.transition = 'opacity 0.3s';
    setTimeout(function () { el.remove(); }, 300);
  }, 2500);
}

/* ===== 确认对话框 ===== */

function showConfirm(message, title) {
  return new Promise(function (resolve) {
    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = '<div class="modal-box">' +
      '<div class="modal-title">' + escapeHtml(title || '提示') + '</div>' +
      '<p>' + escapeHtml(message) + '</p>' +
      '<div class="modal-actions">' +
        '<button class="btn btn-outline btn-sm" data-action="cancel">取消</button>' +
        '<button class="btn btn-danger btn-sm" data-action="confirm">确认</button>' +
      '</div>' +
    '</div>';
    document.body.appendChild(overlay);
    overlay.querySelector('[data-action="cancel"]').onclick = function () { overlay.remove(); resolve(false); };
    overlay.querySelector('[data-action="confirm"]').onclick = function () { overlay.remove(); resolve(true); };
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) { overlay.remove(); resolve(false); }
    });
  });
}

/* ===== 通用函数 ===== */

function renderBookCard(book) {
  var isBorrowed = book.status === '借出';
  return '<div class="card book-card" data-book-id="' + book.id + '" onclick="location.hash=\'#detail/' + book.id + '\'">' +
    '<div class="book-number-badge' + (isBorrowed ? ' borrowed' : '') + '">' + book.number + '</div>' +
    '<div class="book-info">' +
      '<div class="book-title">' + escapeHtml(book.title) + '</div>' +
      '<div class="book-author">' + escapeHtml(book.author || '未知作者') + '</div>' +
    '</div>' +
    '<div class="book-status ' + (isBorrowed ? 'status-borrowed' : 'status-available') + '">' +
      (isBorrowed ? '借出' : '在库') +
    '</div>' +
  '</div>';
}

/* ===== 首页 ===== */

function renderHome(main) {
  main.innerHTML = '<div class="install-banner" id="install-banner">' +
    '添加到主屏幕，像App一样使用！<button class="install-btn" id="install-btn">添加</button>' +
  '</div>' +
  '<div class="stats-row" id="stats-row"></div>' +
  '<div class="quick-actions">' +
    '<button class="btn btn-success btn-block quick-action-btn" onclick="location.hash=\'#add\'">' +
      '<span class="qa-icon">＋</span> 添加新书<span class="qa-arrow">→</span>' +
    '</button>' +
    '<button class="btn btn-warning btn-block quick-action-btn" onclick="location.hash=\'#borrow\'">' +
      '<span class="qa-icon">📖</span> 借阅图书<span class="qa-arrow">→</span>' +
    '</button>' +
    '<button class="btn btn-primary btn-block quick-action-btn" onclick="location.hash=\'#return\'">' +
      '<span class="qa-icon">📚</span> 归还图书<span class="qa-arrow">→</span>' +
    '</button>' +
  '</div>' +
  '<div class="section-title">📋 最近借阅动态</div>' +
  '<div class="recent-activity" id="recent-activity"></div>';

  // 加载统计数据
  getStats().then(function (stats) {
    var available = stats.total - stats.borrowed;
    document.getElementById('stats-row').innerHTML =
      '<div class="card stat-card" style="cursor:pointer" onclick="location.hash=\'#browse\'">' +
        '<span class="stat-number">' + stats.total + '</span>' +
        '<span class="stat-label">📦 馆藏</span>' +
      '</div>' +
      '<div class="card stat-card" style="cursor:pointer" onclick="location.hash=\'#browse/在库\'">' +
        '<span class="stat-number" style="color:var(--color-crayon-green)">' + available + '</span>' +
        '<span class="stat-label">📗 在库</span>' +
      '</div>' +
      '<div class="card stat-card" style="cursor:pointer" onclick="location.hash=\'#browse/借出\'">' +
        '<span class="stat-number borrowed">' + stats.borrowed + '</span>' +
        '<span class="stat-label">📕 借出</span>' +
      '</div>';
  });

  getRecentActivity(10).then(function (records) {
    var el = document.getElementById('recent-activity');
    if (records.length === 0) {
      el.innerHTML = '<div class="empty-state"><span class="empty-icon">✏️</span><span class="empty-text">暂无借阅记录~</span></div>';
      return;
    }
    var bookIds = [];
    var seen = {};
    records.forEach(function (r) { if (!seen[r.bookId]) { seen[r.bookId] = true; bookIds.push(r.bookId); } });
    Promise.all(bookIds.map(function (id) { return getBook(id); })).then(function (books) {
      var bookMap = {};
      books.forEach(function (b) { if (b) bookMap[b.id] = b; });
      var html = '';
      records.forEach(function (r) {
        var book = bookMap[r.bookId];
        if (!book) return;
        var isReturn = r.returnTime != null;
        var dotClass = isReturn ? 'return' : 'borrow';
        var action = isReturn ? '归还' : '借出';
        html += '<div class="activity-item">' +
          '<div class="activity-dot ' + dotClass + '"></div>' +
          '<div class="activity-info">' +
            '<div class="activity-title">' + escapeHtml(book.title) + ' · ' + action + '</div>' +
            '<div class="activity-meta">' + escapeHtml(r.borrowerName) + ' · ' + formatDate(isReturn ? r.returnTime : r.borrowTime) + '</div>' +
          '</div>' +
        '</div>';
      });
      el.innerHTML = html;
    });
  });

  if (_deferredPrompt) showInstallBanner();
}

/* ===== 浏览 ===== */

function renderBrowse(main, statusFilter) {
  var activeCategory = '全部';
  var activeStatus = statusFilter || ''; // '在库' | '借出' | ''

  main.innerHTML =
    '<div class="search-box">' +
      '<span class="search-icon">🔍</span>' +
      '<input type="search" id="search-input" placeholder="搜索书名、作者或编号..." inputmode="search">' +
      '<button class="btn btn-primary btn-sm" id="search-btn" style="flex-shrink:0;padding:8px 14px">搜索</button>' +
    '</div>' +
    '<div class="filter-chips" id="filter-chips">' +
      CATEGORIES.map(function (c) { return '<span class="chip' + (c === activeCategory ? ' active' : '') + '" data-cat="' + c + '">' + c + '</span>'; }).join('') +
    '</div>' +
    '<div id="book-list"></div>';

  var searchInput = document.getElementById('search-input');
  var bookList = document.getElementById('book-list');

  // 状态筛选标签
  if (activeStatus) {
    var statusBar = document.createElement('div');
    statusBar.style.cssText = 'margin-bottom:10px;display:flex;align-items:center;gap:6px;font-size:0.8rem';
    statusBar.innerHTML = '<span style="color:var(--color-text-light)">筛选:</span>' +
      '<span class="chip active" style="background:' + (activeStatus === '在库' ? 'var(--color-crayon-green)' : 'var(--color-crayon-orange)') + ';color:#fff;border:none">' + activeStatus + '</span>' +
      '<a href="#browse" style="font-size:0.75rem;color:var(--color-crayon-blue);cursor:pointer;text-decoration:underline">清除筛选</a>';
    bookList.parentNode.insertBefore(statusBar, bookList);
  }

  function loadBooks() {
    var q = (searchInput.value || '').trim();

    // 编号精确搜索
    if (/^\d+$/.test(q)) {
      getBookByNumber(parseInt(q)).then(function (book) {
        if (book && matchesFilter(book)) { renderList([book]); }
        else { renderList([]); }
      }).catch(function () { renderList([]); });
      return;
    }

    // 按状态 + 分类 + 文字过滤
    var opts = {};
    if (activeStatus) opts.status = activeStatus;
    if (activeCategory !== '全部') opts.category = activeCategory;
    getAllBooks(opts).then(function (books) {
      if (q) {
        var lq = q.toLowerCase();
        books = books.filter(function (b) { return String(b.number).indexOf(q) !== -1 || b.title.toLowerCase().indexOf(lq) !== -1 || b.author.toLowerCase().indexOf(lq) !== -1; });
      }
      renderList(books);
    }).catch(function () { renderList([]); });
  }

  function matchesFilter(book) {
    if (activeStatus && book.status !== activeStatus) return false;
    if (activeCategory !== '全部' && book.category !== activeCategory) return false;
    return true;
  }

  function renderList(books) {
    if (books.length === 0) {
      var msg = '还没有图书，快去添加吧~';
      if (searchInput.value.trim()) msg = '没有找到匹配的书哦~';
      else if (activeStatus === '在库') msg = '所有书都已借出~';
      else if (activeStatus === '借出') msg = '没有借出的书~';
      bookList.innerHTML = '<div class="empty-state"><span class="empty-icon">📚</span><span class="empty-text">' + msg + '</span></div>';
      return;
    }
    books.sort(function (a, b) { return a.number - b.number; });
    bookList.innerHTML = books.map(renderBookCard).join('');
  }

  loadBooks();

  document.getElementById('search-btn').addEventListener('click', loadBooks);
  searchInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); loadBooks(); } });
  searchInput.addEventListener('input', debounce(loadBooks, 400));

  document.getElementById('filter-chips').addEventListener('click', function (e) {
    var chip = e.target.closest('.chip');
    if (!chip) return;
    activeCategory = chip.dataset.cat;
    document.querySelectorAll('#filter-chips .chip').forEach(function (c) { c.classList.remove('active'); });
    chip.classList.add('active');
    loadBooks();
  });
}

/* ===== 添加图书 ===== */

function renderAdd(main) {
  var scanResultData = null;
  var nextNumber = null;

  main.innerHTML = '<div id="add-form"></div>';

  getNextNumber().then(function (n) { nextNumber = n; renderForm(); });

  function renderForm(prefill) {
    prefill = prefill || {};
    document.getElementById('add-form').innerHTML =
      '<div id="scan-section" style="margin-bottom:16px">' +
        '<input type="file" id="ocr-photo-input" accept="image/*" capture="environment" style="display:none">' +
        '<input type="file" id="barcode-photo-input" accept="image/*" capture="environment" style="display:none">' +
        '<div style="display:flex;gap:8px">' +
          '<button class="btn btn-primary btn-block btn-sm" id="btn-ocr-cover" style="flex:1;font-size:0.9rem;padding:12px">📷 拍照识别封面</button>' +
          '<button class="btn btn-success btn-block btn-sm" id="btn-scan-isbn" style="flex:1;font-size:0.9rem;padding:12px">📖 扫描ISBN条码</button>' +
        '</div>' +
        '<div id="scan-status" style="margin-top:8px;text-align:center"></div>' +
      '</div>' +
      '<div class="form-group">' +
        '<label class="form-label">书名 <span style="color:var(--color-crayon-red)">*</span></label>' +
        '<input class="form-input" id="input-title" placeholder="输入书名" value="' + escapeHtml(prefill.title || '') + '">' +
      '</div>' +
      '<div class="form-group">' +
        '<label class="form-label">作者 <span style="color:var(--color-crayon-red)">*</span></label>' +
        '<input class="form-input" id="input-author" placeholder="输入作者" value="' + escapeHtml(prefill.author || '') + '">' +
      '</div>' +
      '<div class="form-group">' +
        '<label class="form-label">分类</label>' +
        '<select class="form-select" id="input-category">' +
          CATEGORIES.filter(function (c) { return c !== '全部'; }).map(function (c) {
            return '<option value="' + c + '"' + (prefill.category === c ? ' selected' : '') + '>' + c + '</option>';
          }).join('') +
        '</select>' +
      '</div>' +
      '<div class="form-group">' +
        '<label class="form-label">ISBN</label>' +
        '<div style="display:flex;gap:8px">' +
          '<input class="form-input" id="input-isbn" placeholder="输入ISBN号（书背面条形码下方的数字）" value="' + escapeHtml(prefill.isbn || '') + '" style="flex:1">' +
          '<button class="btn btn-primary btn-sm" id="btn-lookup-isbn" style="flex-shrink:0;white-space:nowrap">🔍 查询</button>' +
        '</div>' +
        '<div class="form-hint">输入ISBN号后点击查询，自动获取书名和作者</div>' +
        '<div id="isbn-lookup-status" style="margin-top:6px"></div>' +
      '</div>' +
      '<div class="form-group">' +
        '<label class="form-label">编号</label>' +
        '<input class="form-input" type="number" id="input-number" value="' + (prefill.number || nextNumber || '') + '" min="1">' +
        '<div class="form-hint">自动按入库顺序生成，可手动修改</div>' +
        '<div class="form-error" id="number-error" style="display:none"></div>' +
      '</div>' +
      '<button class="btn btn-success btn-block" id="btn-save">💾 保存到书架</button>';

    document.getElementById('input-number').addEventListener('input', function () {
      var num = parseInt(this.value);
      if (!num || num < 1) return;
      isNumberUsed(num, prefill._excludeId || null).then(function (used) {
        var err = document.getElementById('number-error');
        if (used) { err.textContent = '编号 ' + num + ' 已被使用，请换一个'; err.style.display = 'block'; }
        else { err.style.display = 'none'; }
      });
    });

    document.getElementById('btn-lookup-isbn').addEventListener('click', function () {
      var isbnVal = document.getElementById('input-isbn').value.trim();
      if (!isbnVal || isbnVal.length < 10) { showToast('请输入完整的ISBN号（10位或13位）', 'warning'); return; }
      var statusEl = document.getElementById('isbn-lookup-status');
      var btn = document.getElementById('btn-lookup-isbn');
      statusEl.innerHTML = '<span style="color:var(--color-text-light);font-size:0.85rem">🔍 正在查询...</span>';
      btn.disabled = true; btn.textContent = '查询中...';
      lookupISBN(isbnVal).then(function (info) {
        btn.disabled = false; btn.textContent = '🔍 查询';
        if (info && info.title) {
          document.getElementById('input-title').value = info.title;
          document.getElementById('input-author').value = info.author || '';
          scanResultData = info;
          statusEl.innerHTML = '<span style="color:var(--color-crayon-green);font-size:0.85rem">✅ 已找到！书名和作者已自动填入</span>' +
            (info.coverUrl ? '<br><img src="' + escapeHtml(info.coverUrl) + '" style="max-height:80px;margin-top:6px;border-radius:8px;border:2px dashed var(--color-sketch-line)" onerror="this.style.display=\'none\'">' : '');
        } else {
          statusEl.innerHTML = '<span style="color:var(--color-crayon-orange);font-size:0.85rem">📚 未找到该书ISBN信息</span>' +
            '<br><span style="font-size:0.75rem;color:var(--color-text-light)">请手动填写书名和作者，或检查ISBN是否正确</span>';
        }
      }).catch(function () {
        btn.disabled = false; btn.textContent = '🔍 查询';
        statusEl.innerHTML = '<span style="color:var(--color-crayon-orange);font-size:0.85rem">📚 查询失败，请检查网络或手动填写</span>';
      });
    });

    document.getElementById('btn-save').addEventListener('click', function () {
      var title = document.getElementById('input-title').value.trim();
      var author = document.getElementById('input-author').value.trim();
      var category = document.getElementById('input-category').value;
      var isbnVal = document.getElementById('input-isbn').value.trim();
      var number = parseInt(document.getElementById('input-number').value) || nextNumber || 1;
      if (!title) { showToast('请输入书名', 'warning'); return; }
      if (!author) { showToast('请输入作者', 'warning'); return; }
      isNumberUsed(number, prefill._excludeId || null).then(function (used) {
        if (used) { showToast('编号 ' + number + ' 已被使用', 'warning'); return; }
        addBook({
          title: title, author: author, category: category,
          isbn: isbnVal || null, number: number,
          coverUrl: scanResultData ? scanResultData.coverUrl : null
        }).then(function (book) {
          showToast('《' + book.title + '》已添加到书架！', 'success');
          location.hash = '#detail/' + book.id;
        }).catch(function (err) { showToast('保存失败: ' + err.message, 'error'); });
      });
    });

    // ===== OCR/扫描按钮（在 renderForm 内绑定，确保元素已创建） =====
    var _ocrResult = null;
    var _titleLines = [];
    var _authorLines = [];
    var _selectMode = 'title';

    document.getElementById('btn-ocr-cover').addEventListener('click', function () {
      document.getElementById('ocr-photo-input').click();
    });
    document.getElementById('ocr-photo-input').addEventListener('change', function (e) {
      var file = e.target.files[0];
      if (!file) return;
      var statusEl = document.getElementById('scan-status');
      statusEl.innerHTML = '<span style="color:var(--color-text-light);font-size:0.85rem">🔍 正在识别封面文字...</span>';
      _titleLines = []; _authorLines = []; _selectMode = 'title';
      recognizeCover(file, function (result) {
        if (!result || !result.title) {
          statusEl.innerHTML = '<span style="color:var(--color-crayon-orange);font-size:0.85rem">⚠️ 未能识别，请尝试ISBN条码扫描或手动输入</span>';
          return;
        }
        _ocrResult = result;
        if (result.title) {
          result.lines.forEach(function (l) { if (result.title.indexOf(l) !== -1) _titleLines.push(l); });
        }
        if (result.author && result.lines.indexOf(result.author) !== -1) {
          _authorLines.push(result.author);
        }
        renderLineSelector(statusEl);
      });
    });

    document.getElementById('btn-scan-isbn').addEventListener('click', function () {
      document.getElementById('barcode-photo-input').click();
    });
    document.getElementById('barcode-photo-input').addEventListener('change', function (e) {
      var file = e.target.files[0];
      if (!file) return;
      var statusEl = document.getElementById('scan-status');
      statusEl.innerHTML = '<span style="color:var(--color-text-light);font-size:0.85rem">🔍 正在识别ISBN条码...</span>';
      compressForBarcode(file, 1200).then(function (blob) {
        var reader = new FileReader();
        reader.onload = function () {
          var base64 = reader.result.split(',')[1];
          fetch('/api/barcode', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image: base64 }) })
            .then(function (r) { return r.json(); }).then(function (data) {
              if (data && data.codes && data.codes.length > 0) { processISBN(data.codes[0], statusEl); return; }
              tryClientBarcode(blob, statusEl);
            }).catch(function () { tryClientBarcode(blob, statusEl); });
        };
        reader.onerror = function () { statusEl.innerHTML = '<span style="color:var(--color-crayon-orange);font-size:0.85rem">⚠️ 图片读取失败，请重试</span>'; };
        reader.readAsDataURL(blob);
      });
    });

    function tryClientBarcode(blob, statusEl) {
      var f = new File([blob], 'scan.jpg', { type: 'image/jpeg' });
      statusEl.innerHTML = '<span style="color:var(--color-text-light);font-size:0.85rem">🔍 百度未识别到，尝试本地解码...</span>';
      scanBarcodeFromPhoto(f, function (isbn) {
        if (isbn && isbn.length >= 10) { processISBN(isbn, statusEl); }
        else { statusEl.innerHTML = '<span style="color:var(--color-crayon-orange);font-size:0.85rem">⚠️ 未识别到ISBN条码。请确保条码完整清晰、光线均匀无反光、占画面1/3以上</span>'; }
      });
    }

    function processISBN(isbn, statusEl) {
      statusEl.innerHTML = '<span style="color:var(--color-text-light);font-size:0.85rem">📖 已识别ISBN: ' + escapeHtml(isbn) + '，正在查询...</span>';
      lookupISBN(isbn).then(function (info) {
        if (info && info.title) {
          document.getElementById('input-title').value = info.title;
          document.getElementById('input-author').value = info.author || '';
          document.getElementById('input-isbn').value = isbn;
          scanResultData = info;
          statusEl.innerHTML = '<span style="color:var(--color-crayon-green);font-size:0.85rem">✅ ISBN条码 → 豆瓣查书，书名作者已自动填入</span>' +
            (info.coverUrl ? '<br><img src="' + escapeHtml(info.coverUrl) + '" style="max-height:80px;margin-top:6px;border-radius:8px;border:2px dashed var(--color-sketch-line)" onerror="this.style.display=\'none\'">' : '');
        } else {
          statusEl.innerHTML = '<span style="color:var(--color-crayon-orange);font-size:0.85rem">📚 ISBN: ' + escapeHtml(isbn) + ' 豆瓣未收录，请手动填写书名作者</span>';
        }
      });
    }

    function renderLineSelector(statusEl) {
      var lines = (_ocrResult && _ocrResult.lines) || [];
      var titleDisplay = _titleLines.length > 0 ? _titleLines.join('') : '点击选择→';
      var authorDisplay = _authorLines.length > 0 ? _authorLines.join('') : '点击选择→';
      var modeLabel = _selectMode === 'title' ? '📖 正在选【书名】' : '✏️ 正在选【作者】';
      var modeColor = _selectMode === 'title' ? 'var(--color-crayon-blue)' : 'var(--color-crayon-green)';

      statusEl.innerHTML =
        '<div style="font-size:0.8rem;margin-bottom:4px">📖 <b>书名</b>: <span style="color:var(--color-crayon-blue)">' + escapeHtml(titleDisplay) + '</span></div>' +
        '<div style="font-size:0.8rem;margin-bottom:8px">✏️ <b>作者</b>: <span style="color:var(--color-crayon-green)">' + escapeHtml(authorDisplay) + '</span></div>' +
        '<div style="display:flex;gap:6px;margin-bottom:8px;align-items:center">' +
          '<span style="font-size:0.75rem;color:' + modeColor + '">' + modeLabel + '</span>' +
          '<button class="btn btn-sm" id="btn-switch-mode" style="font-size:0.7rem;padding:4px 10px;background:' + (_selectMode === 'title' ? 'var(--color-crayon-green)' : 'var(--color-crayon-blue)') + ';color:#fff;border:none;border-radius:10px">切换到选' + (_selectMode === 'title' ? '作者' : '书名') + '</button>' +
        '</div>' +
        '<div style="display:flex;flex-wrap:wrap;gap:6px" id="line-chips">' +
          lines.map(function (l) {
            var cls = 'line-chip';
            if (_titleLines.indexOf(l) !== -1) cls += ' line-chip-title';
            if (_authorLines.indexOf(l) !== -1) cls += ' line-chip-author';
            return '<span class="line-chip ' + cls + '" data-line="' + escapeHtml(l) + '">' + escapeHtml(l) + '</span>';
          }).join('') +
        '</div>' +
        '<div style="display:flex;gap:8px;margin-top:10px">' +
          '<button class="btn btn-outline btn-block btn-sm" id="btn-clear-lines">🔄 清空重选</button>' +
          '<button class="btn btn-success btn-block btn-sm" id="btn-confirm-lines">✅ 确认填入</button>' +
        '</div>';

      statusEl.querySelector('#btn-switch-mode').addEventListener('click', function () {
        _selectMode = _selectMode === 'title' ? 'author' : 'title';
        renderLineSelector(statusEl);
      });
      statusEl.querySelector('#btn-clear-lines').addEventListener('click', function () { _titleLines = []; _authorLines = []; renderLineSelector(statusEl); });
      statusEl.querySelectorAll('.line-chip').forEach(function (chip) {
        chip.addEventListener('click', function () {
          var line = chip.dataset.line;
          var target = _selectMode === 'title' ? _titleLines : _authorLines;
          var other = _selectMode === 'title' ? _authorLines : _titleLines;
          var idx = target.indexOf(line);
          if (idx !== -1) { target.splice(idx, 1); }
          else { var oi = other.indexOf(line); if (oi !== -1) other.splice(oi, 1); target.push(line); }
          renderLineSelector(statusEl);
        });
      });
      statusEl.querySelector('#btn-confirm-lines').addEventListener('click', function () {
        if (_titleLines.length > 0) document.getElementById('input-title').value = _titleLines.join('');
        if (_authorLines.length > 0) document.getElementById('input-author').value = _authorLines.join('');
        statusEl.innerHTML = '<span style="color:var(--color-crayon-green);font-size:0.85rem">✅ 已填入: ' + escapeHtml(_titleLines.join('') || '(未选)') + '</span>';
      });
    }
  }
}

/* ===== 借阅 ===== */

function renderBorrow(main) {
  main.innerHTML =
    '<div class="search-box">' +
      '<span class="search-icon">🔍</span>' +
      '<input type="search" id="borrow-search" placeholder="搜索要借阅的书名、作者或编号...">' +
      '<button class="btn btn-primary btn-sm" id="borrow-search-btn" style="flex-shrink:0;padding:8px 14px">搜索</button>' +
    '</div>' +
    '<div class="section-title">📖 在库图书（点击借出）</div>' +
    '<div id="borrow-book-list"></div>';

  loadAvailableBooks();

  function loadAvailableBooks() {
    getAllBooks({ status: '在库' }).then(function (books) {
      var list = document.getElementById('borrow-book-list');
      if (!list) return;
      books.sort(function (a, b) { return a.number - b.number; });
      if (books.length === 0) {
        list.innerHTML = '<div class="empty-state"><span class="empty-icon">🎉</span><span class="empty-text">所有书都在馆，或还没有图书~</span></div>';
        return;
      }
      list.innerHTML = books.map(function (b) {
        return '<div class="card book-card" style="cursor:pointer" data-book-id="' + b.id + '">' +
          '<div class="book-number-badge">' + b.number + '</div>' +
          '<div class="book-info"><div class="book-title">' + escapeHtml(b.title) + '</div>' +
          '<div class="book-author">' + escapeHtml(b.author || '') + '</div></div>' +
          '<div class="book-status status-available">在库</div></div>';
      }).join('');
      list.querySelectorAll('.book-card').forEach(function (card) {
        card.addEventListener('click', function () { showBorrowDialog(parseInt(card.dataset.bookId)); });
      });
    });
  }

  function showBorrowDialog(bookId) {
    getBook(bookId).then(function (book) {
      if (!book) return;
      getBorrowerNames().then(function (names) {
        // 弹窗遮罩层
        var overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        var html = '<div class="modal-box" style="max-width:340px;text-align:center">' +
          '<div class="book-number-large" style="margin:0 auto 12px">' + book.number + '</div>' +
          '<div style="font-size:1rem;margin-bottom:2px">' + escapeHtml(book.title) + '</div>' +
          '<div style="font-size:0.85rem;color:var(--color-text-light);margin-bottom:14px">' + escapeHtml(book.author || '') + '</div>' +
          '<div class="form-group"><label class="form-label" style="text-align:left">借阅人姓名</label>' +
          '<input class="form-input" id="borrower-name" placeholder="输入借阅人姓名" autocomplete="off">';
        if (names.length > 0) {
          html += '<div class="borrower-quick" style="margin-top:8px;justify-content:center">' +
            names.map(function (n) { return '<span class="borrower-chip" data-name="' + escapeHtml(n) + '">' + escapeHtml(n) + '</span>'; }).join('') +
            '</div>';
        }
        html += '</div>' +
          '<div style="display:flex;gap:10px;margin-top:14px">' +
            '<button class="btn btn-outline btn-block btn-sm" id="btn-cancel-borrow">取消</button>' +
            '<button class="btn btn-warning btn-block btn-sm" id="btn-confirm-borrow">📖 确认借阅</button>' +
          '</div></div>';
        overlay.innerHTML = html;
        document.body.appendChild(overlay);

        overlay.querySelectorAll('.borrower-chip').forEach(function (chip) {
          chip.addEventListener('click', function () {
            overlay.querySelectorAll('.borrower-chip').forEach(function (c) { c.classList.remove('selected'); });
            chip.classList.add('selected');
            document.getElementById('borrower-name').value = chip.dataset.name;
          });
        });

        overlay.querySelector('#btn-cancel-borrow').addEventListener('click', function () { overlay.remove(); });
        overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });
        overlay.querySelector('#btn-confirm-borrow').addEventListener('click', function () {
          var name = document.getElementById('borrower-name').value.trim();
          if (!name) { showToast('请输入借阅人姓名', 'warning'); return; }
          addBorrowRecord(bookId, name).then(function (r) {
            if (r && r.error) { showToast(r.error, 'error'); return; }
            showToast('《' + book.title + '》已借给 ' + name, 'success');
            overlay.remove();
            renderBorrow(main);
          }).catch(function (err) { showToast('借阅失败: ' + (err.message || '网络错误'), 'error'); });
        });
      });
    });
  }

  function doBorrowSearch() {
    var q = document.getElementById('borrow-search').value.trim();
    if (!q) { loadAvailableBooks(); return; }
    var promise;
    if (/^\d+$/.test(q)) {
      promise = getBookByNumber(parseInt(q)).then(function (book) {
        if (book && book.status === '在库') return [book];
        return searchBooks(q, '全部').then(function (books) { return books.filter(function (b) { return b.status === '在库'; }); });
      });
    } else {
      promise = searchBooks(q, '全部').then(function (books) { return books.filter(function (b) { return b.status === '在库'; }); });
    }
    promise.then(function (inStock) {
      var list = document.getElementById('borrow-book-list');
      if (!list) return;
      if (inStock.length === 0) {
        list.innerHTML = '<div class="empty-state"><span class="empty-icon">🔍</span><span class="empty-text">没有在库的匹配图书</span></div>';
      } else {
        inStock.sort(function (a, b) { return a.number - b.number; });
        list.innerHTML = inStock.map(function (b) {
          return '<div class="card book-card" style="cursor:pointer" data-book-id="' + b.id + '">' +
            '<div class="book-number-badge">' + b.number + '</div>' +
            '<div class="book-info"><div class="book-title">' + escapeHtml(b.title) + '</div>' +
            '<div class="book-author">' + escapeHtml(b.author || '') + '</div></div>' +
            '<div class="book-status status-available">在库</div></div>';
        }).join('');
        list.querySelectorAll('.book-card').forEach(function (card) {
          card.addEventListener('click', function () { showBorrowDialog(parseInt(card.dataset.bookId)); });
        });
      }
    });
  }
  document.getElementById('borrow-search-btn').addEventListener('click', doBorrowSearch);
  document.getElementById('borrow-search').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); doBorrowSearch(); } });
  document.getElementById('borrow-search').addEventListener('input', debounce(doBorrowSearch, 400));
}

/* ===== 归还 ===== */

function renderReturn(main) {
  main.innerHTML =
    '<div class="search-box">' +
      '<span class="search-icon">🔍</span>' +
      '<input type="search" id="return-search" placeholder="搜索要归还的书名、作者或编号...">' +
      '<button class="btn btn-primary btn-sm" id="return-search-btn" style="flex-shrink:0;padding:8px 14px">搜索</button>' +
    '</div>' +
    '<div class="section-title">📚 已借出图书（点击归还）</div>' +
    '<div id="return-book-list"></div>';

  loadBorrowedBooks();

  function loadBorrowedBooks() {
    getAllBooks({ status: '借出' }).then(function (books) {
      var list = document.getElementById('return-book-list');
      if (!list) return;
      books.sort(function (a, b) { return a.number - b.number; });
      if (books.length === 0) {
        list.innerHTML = '<div class="empty-state"><span class="empty-icon">🎉</span><span class="empty-text">当前没有借出的书~</span></div>';
        return;
      }
      list.innerHTML = books.map(function (b) {
        return '<div class="card book-card" style="cursor:pointer" data-book-id="' + b.id + '">' +
          '<div class="book-number-badge borrowed">' + b.number + '</div>' +
          '<div class="book-info"><div class="book-title">' + escapeHtml(b.title) + '</div>' +
          '<div class="book-author">借阅人: ' + escapeHtml(b.currentBorrower || '') + '</div></div>' +
          '<div class="book-status status-borrowed">借出</div></div>';
      }).join('');
      list.querySelectorAll('.book-card').forEach(function (card) {
        card.addEventListener('click', function () { showReturnDialog(parseInt(card.dataset.bookId)); });
      });
    });
  }

  function showReturnDialog(bookId) {
    getBook(bookId).then(function (book) {
      if (!book) return;
      getBorrowHistory(bookId).then(function (records) {
        var activeRecord = records.find(function (r) { return !r.returnTime; });
        // 弹窗遮罩层
        var overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        var html = '<div class="modal-box" style="max-width:340px;text-align:center">' +
          '<div class="book-number-large borrowed" style="margin:0 auto 12px">' + book.number + '</div>' +
          '<div style="font-size:1rem">' + escapeHtml(book.title) + '</div>';
        if (activeRecord) {
          html += '<div class="detail-row"><span class="detail-row-label">借阅人</span><span class="detail-row-value">' + escapeHtml(activeRecord.borrowerName) + '</span></div>' +
            '<div class="detail-row"><span class="detail-row-label">借出时间</span><span class="detail-row-value">' + formatDate(activeRecord.borrowTime) + '</span></div>' +
            '<div style="display:flex;gap:10px;margin-top:14px">' +
              '<button class="btn btn-outline btn-block btn-sm" id="btn-cancel-return">取消</button>' +
              '<button class="btn btn-success btn-block btn-sm" id="btn-confirm-return">📚 确认归还</button>' +
            '</div>';
        } else {
          html += '<div class="timeline-badge returned" style="display:block;margin:8px 0">该书当前未被借出</div>' +
            '<button class="btn btn-outline btn-block btn-sm" id="btn-cancel-return">关闭</button>';
        }
        html += '</div>';
        overlay.innerHTML = html;
        document.body.appendChild(overlay);

        overlay.querySelector('#btn-cancel-return').addEventListener('click', function () { overlay.remove(); });
        overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });
        var confirmBtn = overlay.querySelector('#btn-confirm-return');
        if (confirmBtn) {
          confirmBtn.addEventListener('click', function () {
            returnBook(bookId).then(function (r) {
              if (r && r.error) { showToast(r.error, 'error'); return; }
              showToast('《' + book.title + '》已归还！', 'success');
              overlay.remove();
              renderReturn(main);
            }).catch(function (err) { showToast('归还失败: ' + (err.message || '网络错误'), 'error'); });
          });
        }
      });
    });
  }

  function doReturnSearch() {
    var q = document.getElementById('return-search').value.trim();
    if (!q) { loadBorrowedBooks(); return; }
    var promise;
    if (/^\d+$/.test(q)) {
      promise = getBookByNumber(parseInt(q)).then(function (book) {
        if (book && book.status === '借出') return [book];
        return searchBooks(q, '全部').then(function (books) { return books.filter(function (b) { return b.status === '借出'; }); });
      });
    } else {
      promise = searchBooks(q, '全部').then(function (books) { return books.filter(function (b) { return b.status === '借出'; }); });
    }
    promise.then(function (borrowed) {
      var list = document.getElementById('return-book-list');
      if (!list) return;
      if (borrowed.length === 0) {
        list.innerHTML = '<div class="empty-state"><span class="empty-icon">🔍</span><span class="empty-text">没有匹配的已借出图书</span></div>';
      } else {
        borrowed.sort(function (a, b) { return a.number - b.number; });
        list.innerHTML = borrowed.map(function (b) {
          return '<div class="card book-card" style="cursor:pointer" data-book-id="' + b.id + '">' +
            '<div class="book-number-badge borrowed">' + b.number + '</div>' +
            '<div class="book-info"><div class="book-title">' + escapeHtml(b.title) + '</div>' +
            '<div class="book-author">借阅人: ' + escapeHtml(b.currentBorrower || '') + '</div></div>' +
            '<div class="book-status status-borrowed">借出</div></div>';
        }).join('');
        list.querySelectorAll('.book-card').forEach(function (card) {
          card.addEventListener('click', function () { showReturnDialog(parseInt(card.dataset.bookId)); });
        });
      }
    });
  }
  document.getElementById('return-search-btn').addEventListener('click', doReturnSearch);
  document.getElementById('return-search').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); doReturnSearch(); } });
  document.getElementById('return-search').addEventListener('input', debounce(doReturnSearch, 400));
}

/* ===== 图书详情 ===== */

function renderDetail(main, bookId) {
  if (!bookId) { location.hash = '#browse'; return; }

  main.innerHTML = '<div id="detail-loading" class="empty-state"><span class="empty-icon">📖</span><span class="empty-text">加载中...</span></div>';

  getBook(bookId).then(function (book) {
    if (!book) { main.innerHTML = '<div class="empty-state"><span class="empty-icon">🔎</span><span class="empty-text">图书不存在</span></div>'; return; }
    getBorrowHistory(bookId).then(function (records) {
      var isBorrowed = book.status === '借出';
      main.innerHTML =
        '<div class="detail-header">' +
          '<button class="btn-back" onclick="location.hash=\'#browse\'">←</button>' +
          '<span style="flex:1;text-align:right">' +
            '<button class="btn btn-outline btn-sm" id="btn-edit">✏️ 编辑</button>' +
          '</span>' +
        '</div>' +
        '<div class="book-number-large' + (isBorrowed ? ' borrowed' : '') + '">' + book.number + '</div>' +
        (book.coverUrl ? '<div style="text-align:center;margin-bottom:12px"><img src="' + escapeHtml(book.coverUrl) + '" style="max-height:160px;border-radius:8px;border:2px dashed var(--color-sketch-line)" onerror="this.style.display=\'none\'"></div>' : '') +
        '<div class="card detail-info" id="detail-info">' +
          '<div class="detail-row"><span class="detail-row-label">书名</span><span class="detail-row-value" data-field="title">' + escapeHtml(book.title) + '</span></div>' +
          '<div class="detail-row"><span class="detail-row-label">作者</span><span class="detail-row-value" data-field="author">' + escapeHtml(book.author || '') + '</span></div>' +
          '<div class="detail-row"><span class="detail-row-label">分类</span><span class="detail-row-value" data-field="category">' + escapeHtml(book.category) + '</span></div>' +
          '<div class="detail-row"><span class="detail-row-label">ISBN</span><span class="detail-row-value" data-field="isbn">' + escapeHtml(book.isbn || '无') + '</span></div>' +
          '<div class="detail-row"><span class="detail-row-label">编号</span><span class="detail-row-value" data-field="number">' + book.number + '</span></div>' +
          '<div class="detail-row"><span class="detail-row-label">入库时间</span><span class="detail-row-value">' + formatDate(book.entryTime) + '</span></div>' +
          '<div class="detail-row"><span class="detail-row-label">状态</span><span class="detail-row-value">' +
            (isBorrowed ? '<span style="color:var(--color-crayon-orange)">借出 (' + escapeHtml(book.currentBorrower || '') + ')</span>' : '<span style="color:var(--color-crayon-green)">在库</span>') +
          '</span></div>' +
        '</div>' +
        '<div class="detail-actions" id="detail-actions">' +
          (isBorrowed
            ? '<button class="btn btn-success btn-block btn-sm" id="btn-quick-return">📚 归还此书</button>'
            : '<button class="btn btn-warning btn-block btn-sm" id="btn-quick-borrow">📖 借出此书</button>') +
          '<button class="btn btn-danger btn-block btn-sm" id="btn-delete">🗑 删除</button>' +
        '</div>' +
        '<div class="section-title">📋 借阅记录 (' + records.length + ')</div>' +
        '<div class="card" id="borrow-history">' +
          (records.length === 0
            ? '<div class="empty-state"><span class="empty-icon">✏️</span><span class="empty-text">暂无借阅记录</span></div>'
            : '<div class="timeline">' + records.map(function (r) {
                return '<div class="timeline-item' + (r.returnTime ? '' : ' active') + '">' +
                  '<div class="timeline-borrower">' + escapeHtml(r.borrowerName) + '</div>' +
                  '<div class="timeline-time">借出: ' + formatDate(r.borrowTime) + '</div>' +
                  (r.returnTime
                    ? '<div class="timeline-time">归还: ' + formatDate(r.returnTime) + '</div>' +
                      '<span class="timeline-badge returned">已归还</span>'
                    : '<span class="timeline-badge borrowing">借阅中</span>') +
                '</div>';
              }).join('') + '</div>'
          ) +
        '</div>';

      var quickBorrowBtn = document.getElementById('btn-quick-borrow');
      if (quickBorrowBtn) {
        quickBorrowBtn.addEventListener('click', function () {
          var name = prompt('请输入借阅人姓名:');
          if (name && name.trim()) {
            addBorrowRecord(bookId, name.trim()).then(function (r) {
              if (r && r.error) { showToast(r.error, 'error'); return; }
              showToast('《' + book.title + '》已借给 ' + name.trim(), 'success');
              renderDetail(main, bookId);
            }).catch(function (err) { showToast('借阅失败', 'error'); });
          }
        });
      }

      var quickReturnBtn = document.getElementById('btn-quick-return');
      if (quickReturnBtn) {
        quickReturnBtn.addEventListener('click', function () {
          returnBook(bookId).then(function (r) {
            if (r && r.error) { showToast(r.error, 'error'); return; }
            showToast('《' + book.title + '》已归还！', 'success');
            renderDetail(main, bookId);
          }).catch(function (err) { showToast('归还失败', 'error'); });
        });
      }

      document.getElementById('btn-edit').addEventListener('click', function () { enterEditMode(book, main); });

      document.getElementById('btn-delete').addEventListener('click', function () {
        showConfirm('确定要删除《' + book.title + '》吗？相关的借阅记录也会一并删除。', '删除确认').then(function (confirmed) {
          if (confirmed) {
            deleteBook(bookId).then(function () {
              showToast('已删除《' + book.title + '》', 'info');
              location.hash = '#browse';
            });
          }
        });
      });
    });
  });
}

function enterEditMode(book, main) {
  main.innerHTML =
    '<div class="detail-header">' +
      '<button class="btn-back" id="btn-cancel-edit">←</button>' +
      '<span style="flex:1;text-align:center;font-size:1rem">编辑图书</span>' +
    '</div>' +
    '<div class="card" style="margin-top:16px">' +
      '<div class="form-group"><label class="form-label">书名</label>' +
        '<input class="form-input" id="edit-title" value="' + escapeHtml(book.title) + '"></div>' +
      '<div class="form-group"><label class="form-label">作者</label>' +
        '<input class="form-input" id="edit-author" value="' + escapeHtml(book.author || '') + '"></div>' +
      '<div class="form-group"><label class="form-label">分类</label>' +
        '<select class="form-select" id="edit-category">' +
          CATEGORIES.filter(function (c) { return c !== '全部'; }).map(function (c) {
            return '<option value="' + c + '"' + (book.category === c ? ' selected' : '') + '>' + c + '</option>';
          }).join('') +
        '</select></div>' +
      '<div class="form-group"><label class="form-label">ISBN</label>' +
        '<input class="form-input" id="edit-isbn" value="' + escapeHtml(book.isbn || '') + '"></div>' +
      '<div class="form-group"><label class="form-label">编号</label>' +
        '<input class="form-input" type="number" id="edit-number" value="' + book.number + '" min="1">' +
        '<div class="form-error" id="edit-number-error" style="display:none"></div></div>' +
      '<button class="btn btn-success btn-block" id="btn-save-edit">💾 保存修改</button>' +
    '</div>';

  document.getElementById('btn-cancel-edit').addEventListener('click', function () { renderDetail(main, book.id); });

  document.getElementById('edit-number').addEventListener('input', function () {
    var num = parseInt(this.value);
    if (!num || num < 1) return;
    isNumberUsed(num, book.id).then(function (used) {
      var err = document.getElementById('edit-number-error');
      if (used) { err.textContent = '编号 ' + num + ' 已被使用'; err.style.display = 'block'; }
      else { err.style.display = 'none'; }
    });
  });

  document.getElementById('btn-save-edit').addEventListener('click', function () {
    var title = document.getElementById('edit-title').value.trim();
    var author = document.getElementById('edit-author').value.trim();
    var category = document.getElementById('edit-category').value;
    var isbn = document.getElementById('edit-isbn').value.trim();
    var number = parseInt(document.getElementById('edit-number').value) || book.number;
    if (!title) { showToast('请输入书名', 'warning'); return; }
    if (!author) { showToast('请输入作者', 'warning'); return; }
    isNumberUsed(number, book.id).then(function (used) {
      if (used) { showToast('编号 ' + number + ' 已被使用', 'warning'); return; }
      updateBook(book.id, { title: title, author: author, category: category, isbn: isbn || null, number: number }).then(function () {
        showToast('修改已保存', 'success');
        renderDetail(main, book.id);
      }).catch(function (err) { showToast('保存失败: ' + err.message, 'error'); });
    });
  });
}

/* ===== PWA 安装提示 ===== */

function showInstallBanner() {
  var banner = document.getElementById('install-banner');
  if (!banner) return;
  banner.classList.add('show');
  var btn = document.getElementById('install-btn');
  if (btn) {
    btn.onclick = function () {
      if (_deferredPrompt) {
        _deferredPrompt.prompt();
        _deferredPrompt.userChoice.then(function () {
          _deferredPrompt = null;
          banner.classList.remove('show');
        });
      }
    };
  }
}

/* ===== 启动 ===== */

document.addEventListener('DOMContentLoaded', init);
