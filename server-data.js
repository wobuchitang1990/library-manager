/* 服务端数据层 —— JSON 文件存储 */
var fs = require('fs');
var path = require('path');

var DATA_FILE = path.join(__dirname, 'data.json');

function readData() {
  try {
    if (!fs.existsSync(DATA_FILE)) return newData();
    var raw = fs.readFileSync(DATA_FILE, 'utf8');
    var data = JSON.parse(raw);
    if (!data.books) data.books = [];
    if (!data.borrowRecords) data.borrowRecords = [];
    if (!data.nextId) data.nextId = { books: 1, borrowRecords: 1 };
    return data;
  } catch (e) {
    return newData();
  }
}

function newData() {
  return { books: [], borrowRecords: [], nextId: { books: 1, borrowRecords: 1 } };
}

function writeData(data) {
  var tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, DATA_FILE);
}

function getNextBookId(data) {
  return data.nextId.books++;
}

function getNextBorrowId(data) {
  return data.nextId.borrowRecords++;
}

/* 书 CRUD */
function getAllBooks() {
  var data = readData();
  var books = data.books;
  var borrowed = {};
  data.borrowRecords.forEach(function (r) {
    if (!r.returnTime) borrowed[r.bookId] = r.borrowerName;
  });
  return books.map(function (b) {
    return {
      id: b.id, number: b.number, title: b.title, author: b.author,
      category: b.category, isbn: b.isbn || null, coverUrl: b.coverUrl || null,
      entryTime: b.entryTime,
      status: borrowed[b.id] ? '借出' : '在库',
      currentBorrower: borrowed[b.id] || null
    };
  });
}

function getBook(id) {
  var books = getAllBooks();
  return books.find(function (b) { return b.id === id; }) || null;
}

function getBookByIsbn(isbn) {
  var clean = (isbn || '').replace(/[-\s]/g, '');
  if (!clean) return null;
  var books = getAllBooks();
  return books.find(function (b) { return b.isbn === clean; }) || null;
}

function getBookByNumber(number) {
  var books = getAllBooks();
  return books.find(function (b) { return b.number === number; }) || null;
}

function addBook(bookData) {
  var data = readData();
  var id = getNextBookId(data);
  var entryTime = bookData.entryTime || new Date().toISOString();
  var book = {
    id: id,
    number: bookData.number || id,
    title: bookData.title || '',
    author: bookData.author || '',
    category: bookData.category || '其他',
    isbn: bookData.isbn ? bookData.isbn.replace(/[-\s]/g, '') : null,
    coverUrl: bookData.coverUrl || null,
    entryTime: entryTime
  };

  // 编号查重
  if (data.books.some(function (b) { return b.number === book.number; })) {
    return { error: '编号 ' + book.number + ' 已被使用' };
  }
  data.books.push(book);
  writeData(data);
  return { book: getBook(id) };
}

function updateBook(id, updates) {
  var data = readData();
  var idx = data.books.findIndex(function (b) { return b.id === id; });
  if (idx === -1) return { error: '图书不存在' };
  var book = data.books[idx];
  if (updates.title !== undefined) book.title = updates.title;
  if (updates.author !== undefined) book.author = updates.author;
  if (updates.category !== undefined) book.category = updates.category;
  if (updates.isbn !== undefined) book.isbn = updates.isbn ? updates.isbn.replace(/[-\s]/g, '') : null;
  if (updates.coverUrl !== undefined) book.coverUrl = updates.coverUrl;
  if (updates.number !== undefined) {
    var numConflict = data.books.some(function (b) { return b.id !== id && b.number === updates.number; });
    if (numConflict) return { error: '编号 ' + updates.number + ' 已被使用' };
    book.number = updates.number;
  }
  writeData(data);
  return { book: getBook(id) };
}

function deleteBook(id) {
  var data = readData();
  data.books = data.books.filter(function (b) { return b.id !== id; });
  data.borrowRecords = data.borrowRecords.filter(function (r) { return r.bookId !== id; });
  writeData(data);
  return { success: true };
}

/* 借阅 CRUD */
function addBorrowRecord(bookId, borrowerName) {
  var data = readData();
  var id = getNextBorrowId(data);
  var record = {
    id: id, bookId: bookId, borrowerName: borrowerName,
    borrowTime: new Date().toISOString(), returnTime: null
  };
  data.borrowRecords.push(record);

  // 保留最近10条
  var bookRecords = data.borrowRecords.filter(function (r) { return r.bookId === bookId; });
  if (bookRecords.length > 10) {
    bookRecords.sort(function (a, b) { return new Date(a.borrowTime) - new Date(b.borrowTime); });
    var toDelete = bookRecords.slice(0, bookRecords.length - 10);
    toDelete.forEach(function (r) {
      data.borrowRecords = data.borrowRecords.filter(function (x) { return x.id !== r.id; });
    });
  }
  writeData(data);
  return { record: record };
}

function returnBook(bookId) {
  var data = readData();
  var returnTime = new Date().toISOString();
  var activeIdx = -1;
  for (var i = data.borrowRecords.length - 1; i >= 0; i--) {
    if (data.borrowRecords[i].bookId === bookId && !data.borrowRecords[i].returnTime) {
      activeIdx = i; break;
    }
  }
  if (activeIdx === -1) return { isAlreadyReturned: true };
  data.borrowRecords[activeIdx].returnTime = returnTime;
  writeData(data);
  return { record: data.borrowRecords[activeIdx], isAlreadyReturned: false };
}

function getBorrowHistory(bookId) {
  var data = readData();
  return data.borrowRecords
    .filter(function (r) { return r.bookId === bookId; })
    .sort(function (a, b) { return new Date(b.borrowTime) - new Date(a.borrowTime); })
    .slice(0, 10);
}

function getAllBorrowRecords() {
  var data = readData();
  return data.borrowRecords.sort(function (a, b) { return new Date(b.borrowTime) - new Date(a.borrowTime); });
}

function getStats() {
  var books = getAllBooks();
  var records = readData().borrowRecords;
  var borrowed = 0;
  records.forEach(function (r) { if (!r.returnTime) borrowed++; });
  return { total: books.length, borrowed: borrowed };
}

function getBorrowerNames() {
  var data = readData();
  var names = [];
  var seen = {};
  data.borrowRecords.forEach(function (r) {
    if (r.borrowerName && !seen[r.borrowerName]) {
      seen[r.borrowerName] = true;
      names.push(r.borrowerName);
    }
  });
  return names.sort();
}

module.exports = {
  getAllBooks: getAllBooks, getBook: getBook, getBookByIsbn: getBookByIsbn,
  getBookByNumber: getBookByNumber, addBook: addBook, updateBook: updateBook,
  deleteBook: deleteBook,
  addBorrowRecord: addBorrowRecord, returnBook: returnBook,
  getBorrowHistory: getBorrowHistory, getAllBorrowRecords: getAllBorrowRecords,
  getStats: getStats, getBorrowerNames: getBorrowerNames
};
