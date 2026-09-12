/* Документация Nestling — тема, меню, ведение по прокрутке, поиск. Zero deps. */
(function () {
  'use strict';

  function list(selector) {
    return Array.prototype.slice.call(document.querySelectorAll(selector));
  }

  /* Форма вывода: 'tree' — страница дерева, 'single' — вся документация файлом */
  var mode = document.body.getAttribute('data-mode') || 'tree';
  /* Путь до корня своего языка: там лежат индекс поиска и разделы, на которые
     он ссылается. У языка по умолчанию этот корень совпадает с корнем сайта. */
  var langRoot = document.body.getAttribute('data-lang-root') || '';
  /* Подписи оформления на языке страницы: их печатает сборка */
  var ui = window.NESTLING_UI || {};

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

  /* Пункт сайдбара в одном файле ведёт якорем внутрь того же документа: смена
     страницы меню не закрывает, поэтому закрываем его сами. */
  function closeMenuOnNav() {
    var sb = document.querySelector('.sidebar');
    if (!sb) return;
    sb.addEventListener('click', function (e) {
      if (e.target.closest('a[href^="#"]')) window.__closeMenu();
    });
  }

  /* Открытый пункт сайдбара виден без прокрутки меню */
  function revealActive() {
    var sb = document.querySelector('.sidebar');
    var active = sb && sb.querySelector('a.active');
    if (!active) return;
    var top = active.offsetTop - sb.clientHeight / 2;
    if (top > 0) sb.scrollTop = top;
  }

  /* ---------- Scroll spy: читаемый раздел и его заголовок ---------- */

  /* Положение элемента от начала документа: сумма смещений по цепочке */
  function docTop(el) {
    var y = 0;
    while (el) { y += el.offsetTop; el = el.offsetParent; }
    return y;
  }

  /* Строка, по которой считается «читаемое место»: под фиксированной шапкой */
  function readingLine() {
    var pad = getComputedStyle(root).scrollPaddingTop || '80';
    return window.scrollY + (parseInt(pad, 10) || 80) + 4;
  }

  /* В одном файле читаемый раздел ищется прокруткой, в дереве он известен
     из адреса страницы и отмечен сборкой. */
  function initScrollSpy() {
    var chapters = list('.chapter');
    if (!chapters.length) return;

    var navs = {};   /* id раздела   → его пункт сайдбара */
    var subs = {};   /* id раздела   → список его заголовков */
    var marks = {};  /* id заголовка → его подпункт */

    list('.sidebar a[data-chapter]').forEach(function (a) {
      navs[a.getAttribute('data-chapter')] = a;
    });
    list('.nav-sub[data-for]').forEach(function (ul) {
      subs[ul.getAttribute('data-for')] = ul;
    });
    list('.nav-sub a[href^="#"]').forEach(function (a) {
      marks[a.getAttribute('href').slice(1)] = a;
    });

    var heads = list('.chapter h2[id]');
    var chapterTops = [];
    var headTops = [];
    var openId = null;
    var markedId = null;

    function measure() {
      chapterTops = chapters.map(docTop);
      headTops = heads.map(docTop);
    }

    function showChapter(id) {
      if (id === openId) return;
      if (navs[openId]) navs[openId].classList.remove('active');
      if (subs[openId]) subs[openId].classList.remove('open');
      if (navs[id]) navs[id].classList.add('active');
      if (subs[id]) subs[id].classList.add('open');
      openId = id;
    }

    function markSection(id) {
      if (id === markedId) return;
      if (marks[markedId]) marks[markedId].classList.remove('active');
      if (marks[id]) marks[id].classList.add('active');
      markedId = id;
    }

    function onScroll() {
      var line = readingLine();

      var i = 0;
      while (i + 1 < chapterTops.length && chapterTops[i + 1] <= line) i++;
      var id = chapters[i].id;
      showChapter(id);

      /* Заголовок ищется в читаемом разделе: его имя стоит приставкой в id */
      var prefix = id + '--';
      var current = null;
      for (var j = 0; j < heads.length; j++) {
        if (headTops[j] > line) break;
        if (heads[j].id.indexOf(prefix) === 0) current = heads[j].id;
      }
      markSection(current);
    }

    var ticking = false;
    function schedule() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () { ticking = false; onScroll(); });
    }

    measure();
    onScroll();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', function () { measure(); onScroll(); });
    window.addEventListener('load', function () { measure(); onScroll(); });
  }

  /* Страница дерева: подсвечивается заголовок, до которого дочитали */
  function initHeadingSpy() {
    var heads = list('.article h2[id]');
    var open = document.querySelector('.nav-sub.open');
    if (!heads.length || !open) return;

    var marks = {};
    list('.nav-sub.open a[href]').forEach(function (a) {
      var href = a.getAttribute('href');
      var hash = href.indexOf('#');
      if (hash !== -1) marks[href.slice(hash + 1)] = a;
    });

    var tops = [];
    var markedId = null;

    function measure() { tops = heads.map(docTop); }

    function onScroll() {
      var line = readingLine();
      var current = null;
      for (var i = 0; i < heads.length; i++) {
        if (tops[i] > line) break;
        current = heads[i].id;
      }
      if (current === markedId) return;
      if (marks[markedId]) marks[markedId].classList.remove('active');
      if (marks[current]) marks[current].classList.add('active');
      markedId = current;
    }

    var ticking = false;
    function schedule() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () { ticking = false; onScroll(); });
    }

    measure();
    onScroll();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', function () { measure(); onScroll(); });
    window.addEventListener('load', function () { measure(); onScroll(); });
  }

  /* ---------- Поиск ---------- */

  /* Индекс весит сотни килобайт и нужен не каждому читателю, поэтому
     запрашивается при первом обращении к полю, а не при загрузке страницы. */
  function initSearch() {
    var input = document.getElementById('q');
    var box = document.getElementById('results');
    if (!input || !box) return;

    var index = null;
    var pending = null;

    function load() {
      if (index || pending) return pending;
      pending = fetch(langRoot + 'search-index.json')
        .then(function (r) { return r.json(); })
        .then(function (data) { index = data; return data; })
        .catch(function () { index = []; return index; });
      return pending;
    }

    /* Ранг по месту совпадения: заголовок раздела, заголовок второго
       уровня, текст. Морфология не разбирается: совпадение — подстрока. */
    function search(query) {
      var q = query.toLowerCase();
      var found = [];

      for (var i = 0; i < index.length; i++) {
        var page = index[i];
        var rank = -1;
        var anchor = '';

        if (page.title.toLowerCase().indexOf(q) !== -1) {
          rank = 0;
        } else {
          for (var j = 0; j < page.heads.length; j++) {
            if (page.heads[j].label.toLowerCase().indexOf(q) !== -1) {
              rank = 1;
              anchor = page.heads[j].anchor;
              break;
            }
          }
          if (rank === -1 && page.text.toLowerCase().indexOf(q) !== -1) rank = 2;
        }

        if (rank !== -1) found.push({ page: page, rank: rank, anchor: anchor, at: i });
      }

      found.sort(function (a, b) { return a.rank - b.rank || a.at - b.at; });
      return found.slice(0, 20);
    }

    function render(found, query) {
      if (!found.length) {
        box.innerHTML = '<p class="empty">' + (ui.empty || 'Nothing found for') +
          ' «' + query.replace(/[<>&]/g, '') + '»</p>';
        box.hidden = false;
        return;
      }

      box.innerHTML = found.map(function (hit) {
        var href = langRoot + hit.page.path + (hit.anchor ? '#' + hit.anchor : '');
        return '<a href="' + href + '"><span class="r-t">' + hit.page.title +
          '</span><span class="r-g">' + hit.page.group + '</span></a>';
      }).join('');
      box.hidden = false;
    }

    function run() {
      var query = input.value.trim();
      if (query.length < 2) { box.hidden = true; return; }
      load().then(function () { render(search(query), query); });
    }

    input.addEventListener('focus', load);
    input.addEventListener('input', run);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { input.value = ''; box.hidden = true; input.blur(); }
    });
    document.addEventListener('click', function (e) {
      if (!e.target.closest('.search')) box.hidden = true;
    });
  }

  /* ---------- Anchor links on headings ---------- */
  function addHeadingAnchors() {
    list('.article h2[id], .article h3[id]').forEach(function (h) {
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
    closeMenuOnNav();
    addHeadingAnchors();
    initSearch();
    if (mode === 'single') {
      initScrollSpy();
    } else {
      revealActive();
      initHeadingSpy();
    }
  });
})();
