/* ===== ISBN 查询（通过服务端代理 → 豆瓣/Open Library） ===== */

function lookupISBN(isbn) {
  var clean = stripISBN(isbn);
  if (!clean || clean.length < 10) return Promise.resolve(null);

  return fetch('/api/book?isbn=' + encodeURIComponent(clean))
    .then(function (res) {
      if (!res.ok) return null;
      return res.json();
    })
    .then(function (data) {
      if (!data || data.error) return null;
      return {
        title: data.title || '',
        author: data.author || '',
        isbn: clean,
        coverUrl: data.coverUrl || null,
        publisher: data.publisher || '',
        publishDate: data.publishDate || ''
      };
    })
    .catch(function () { return null; });
}
