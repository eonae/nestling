/* Гайд Nestling — тема, меню, ведение по прокрутке. Zero deps. */
(function () {
  'use strict';

  function list(selector) {
    return Array.prototype.slice.call(document.querySelectorAll(selector));
  }

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

  /* Пункт сайдбара ведёт якорем внутрь того же файла: смена страницы меню
     больше не закрывает, поэтому закрываем его сами. */
  function closeMenuOnNav() {
    var sb = document.querySelector('.sidebar');
    if (!sb) return;
    sb.addEventListener('click', function (e) {
      if (e.target.closest('a[href^="#"]')) window.__closeMenu();
    });
  }

  /* ---------- Scroll spy: читаемая глава и её раздел ---------- */

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

  function initScrollSpy() {
    var chapters = list('.chapter');
    if (!chapters.length) return;

    var navs = {};   /* slug главы  → её пункт сайдбара */
    var subs = {};   /* slug главы  → список её разделов */
    var marks = {};  /* id раздела  → его подпункт */

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
    var openSlug = null;
    var markedId = null;

    function measure() {
      chapterTops = chapters.map(docTop);
      headTops = heads.map(docTop);
    }

    function showChapter(slug) {
      if (slug === openSlug) return;
      if (navs[openSlug]) navs[openSlug].classList.remove('active');
      if (subs[openSlug]) subs[openSlug].classList.remove('open');
      if (navs[slug]) navs[slug].classList.add('active');
      if (subs[slug]) subs[slug].classList.add('open');
      openSlug = slug;
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
      var slug = chapters[i].id;
      showChapter(slug);

      /* Раздел ищется в читаемой главе: её имя стоит приставкой в id */
      var prefix = slug + '--';
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

  /* ---------- Anchor links on headings ---------- */
  function addHeadingAnchors() {
    list('.chapter h2[id], .chapter h3[id]').forEach(function (h) {
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
    initScrollSpy();
  });
})();
