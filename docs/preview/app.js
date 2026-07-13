/* Nestling docs preview — тема, подсветка, навигация. Zero deps. */
(function () {
  'use strict';

  /* ---------- Theme ---------- */
  var root = document.documentElement;
  var saved = null;
  try { saved = localStorage.getItem('nestling-theme'); } catch (e) {}
  if (saved) root.setAttribute('data-theme', saved);

  function currentTheme() {
    var t = root.getAttribute('data-theme');
    if (t) return t;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  function applyThemeIcon() {
    var btn = document.getElementById('theme-btn');
    if (btn) btn.textContent = currentTheme() === 'dark' ? '☀' : '☾';
  }
  window.__toggleTheme = function () {
    var next = currentTheme() === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    try { localStorage.setItem('nestling-theme', next); } catch (e) {}
    applyThemeIcon();
  };

  /* ---------- Mobile sidebar ---------- */
  window.__toggleMenu = function () {
    var sb = document.querySelector('.sidebar');
    var bd = document.querySelector('.backdrop');
    if (!sb) return;
    var open = sb.classList.toggle('open');
    if (bd) bd.classList.toggle('show', open);
  };
  window.__closeMenu = function () {
    var sb = document.querySelector('.sidebar');
    var bd = document.querySelector('.backdrop');
    if (sb) sb.classList.remove('open');
    if (bd) bd.classList.remove('show');
  };

  /* ---------- Syntax highlight (lightweight TS/JS) ---------- */
  var KW = ('const|let|var|function|return|await|async|new|class|interface|type|import|export|' +
    'from|extends|implements|if|else|for|of|in|while|switch|case|default|break|continue|throw|' +
    'try|catch|finally|typeof|instanceof|as|void|this|super|yield|enum|public|private|protected|' +
    'readonly|static|declare|namespace|true|false|null|undefined|infer|keyof|satisfies');

  var RE = new RegExp(
    '(\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/)' +          // 1 comment
    '|(`(?:\\\\.|[^`\\\\])*`|\'(?:\\\\.|[^\'\\\\])*\'|"(?:\\\\.|[^"\\\\])*")' + // 2 string
    '|(@[A-Za-z_]\\w*)' +                               // 3 decorator
    '|\\b(\\d[\\d_]*\\.?\\d*)\\b' +                     // 4 number
    '|\\b(' + KW + ')\\b' +                             // 5 keyword
    '|\\b([A-Z][A-Za-z0-9_]*)\\b' +                     // 6 Type
    '|\\b([a-z_$][\\w$]*)(?=\\s*\\()',                  // 7 fn call
    'g');

  function esc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function highlight(src) {
    var out = '', last = 0, m;
    RE.lastIndex = 0;
    while ((m = RE.exec(src)) !== null) {
      if (m.index > last) out += esc(src.slice(last, m.index));
      var cls, txt = m[0];
      if (m[1]) cls = 'tok-com';
      else if (m[2]) cls = 'tok-str';
      else if (m[3]) cls = 'tok-deco';
      else if (m[4]) cls = 'tok-num';
      else if (m[5]) cls = 'tok-key';
      else if (m[6]) cls = 'tok-type';
      else cls = 'tok-fn';
      out += '<span class="' + cls + '">' + esc(txt) + '</span>';
      last = m.index + txt.length;
    }
    out += esc(src.slice(last));
    return out;
  }

  function decorateCode() {
    var blocks = document.querySelectorAll('.code');
    blocks.forEach(function (block) {
      var code = block.querySelector('code');
      if (!code || block.dataset.done) return;
      block.dataset.done = '1';

      var fname = block.getAttribute('data-file') || '';
      var lang = block.getAttribute('data-lang') || 'ts';

      var head = document.createElement('div');
      head.className = 'code-head';
      head.innerHTML =
        '<span class="dot"></span><span class="dot"></span><span class="dot"></span>' +
        (fname ? '<span class="fname">' + esc(fname) + '</span>' : '') +
        '<span class="lang">' + esc(lang) + '</span>';
      block.insertBefore(head, block.firstChild);

      code.innerHTML = highlight(code.textContent);
    });
  }

  /* ---------- Active anchor on scroll ---------- */
  function initScrollSpy() {
    var subs = document.querySelectorAll('.nav-sub a[href^="#"]');
    if (!subs.length) return;
    var map = {};
    subs.forEach(function (a) {
      var id = a.getAttribute('href').slice(1);
      map[id] = a;
    });
    var heads = [];
    Object.keys(map).forEach(function (id) {
      var el = document.getElementById(id);
      if (el) heads.push(el);
    });
    if (!heads.length) return;

    function onScroll() {
      var top = window.scrollY + parseInt(getComputedStyle(document.documentElement).scrollPaddingTop || '80') + 4;
      var cur = heads[0];
      for (var i = 0; i < heads.length; i++) {
        if (heads[i].offsetTop <= top) cur = heads[i]; else break;
      }
      subs.forEach(function (a) { a.classList.remove('active'); });
      if (cur && map[cur.id]) map[cur.id].classList.add('active');
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  /* ---------- Anchor links on headings ---------- */
  function addHeadingAnchors() {
    document.querySelectorAll('.article h2[id], .article h3[id]').forEach(function (h) {
      var a = document.createElement('a');
      a.className = 'anchor';
      a.href = '#' + h.id;
      a.textContent = '#';
      a.setAttribute('aria-hidden', 'true');
      h.appendChild(a);
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    applyThemeIcon();
    decorateCode();
    addHeadingAnchors();
    initScrollSpy();
  });
})();
