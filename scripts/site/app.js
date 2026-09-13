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

  var MOON =
    '<path d="M13.4 9.6A5.8 5.8 0 0 1 6.4 2.6a5.8 5.8 0 1 0 7 7Z" ' +
    'stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>';
  var SUN =
    '<circle cx="8" cy="8" r="3.2" stroke="currentColor" stroke-width="1.4"/>' +
    '<path d="M8 1v1.6M8 13.4V15M1 8h1.6M13.4 8H15M3 3l1.2 1.2M11.8 11.8 13 13' +
    'M13 3l-1.2 1.2M4.2 11.8 3 13" stroke="currentColor" stroke-width="1.4" ' +
    'stroke-linecap="round"/>';

  function applyThemeIcon() {
    var svg = document.querySelector('#theme-btn svg');
    if (svg) svg.innerHTML = currentTheme() === 'dark' ? SUN : MOON;
  }
  window.__toggleTheme = function () {
    var next = currentTheme() === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    try { localStorage.setItem('nestling-theme', next); } catch (e) {}
    applyThemeIcon();
  };

  /* ---------- Меню на узком экране ---------- */
  /* Панель сайдбара и затемнение показывает один класс на body: затемнение
     лежит вне сетки страницы, и общего родителя у них нет. */
  window.__toggleMenu = function () {
    document.body.classList.toggle('menu-open');
  };
  window.__closeMenu = function () {
    document.body.classList.remove('menu-open');
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

  /* ---------- Копирование кода ---------- */

  /* В буфер попадает текст блока: подпись файла и разметка подсветки лежат
     вне `pre`, поэтому копируется ровно то, что читатель видит кодом.
     Файл, открытый с диска, — не защищённый источник, и `navigator.clipboard`
     там недоступен: текст кладётся полем ввода. */
  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }

    var area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();

    try {
      document.execCommand('copy');
    } catch (e) {
      /* браузер запретил копирование: кнопка просто не отметится */
    }

    document.body.removeChild(area);

    return Promise.resolve();
  }

  function initCopy() {
    list('.code .copy').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var block = btn.closest('.code');
        var code = block && block.querySelector('pre');
        if (!code) return;

        copyText(code.textContent).then(function () {
          btn.textContent = ui.copied || 'copied';
          setTimeout(function () {
            btn.textContent = ui.copy || 'copy';
          }, 1400);
        });
      });
    });
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

    /* На узком экране поле свёрнуто в лупу и разворачивается по нажатию:
       место в шапке занимают марка, меню и переключатели. */
    var panel = input.closest('.search');

    function open() {
      panel.classList.add('open');
      load();
      input.focus();
    }

    function close() {
      input.value = '';
      box.hidden = true;
      panel.classList.remove('open');
      input.blur();
    }

    input.addEventListener('focus', load);
    input.addEventListener('input', run);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') close();
    });

    panel.addEventListener('click', function (e) {
      if (!e.target.closest('input')) open();
    });

    document.addEventListener('click', function (e) {
      if (!e.target.closest('.search')) { box.hidden = true; panel.classList.remove('open'); }
    });

    /* Поиск открывается с любой страницы: `⌘K` у Apple, `Ctrl+K` у прочих */
    document.addEventListener('keydown', function (e) {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        open();
      }
    });

    var hint = document.querySelector('.search kbd');
    if (hint && !/Mac|iPhone|iPad/.test(navigator.platform)) hint.textContent = 'Ctrl K';
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
    initCopy();
    initSearch();
    if (mode === 'single') {
      initScrollSpy();
    } else {
      revealActive();
      initHeadingSpy();
    }
  });
})();
