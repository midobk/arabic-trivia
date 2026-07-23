// Theme controller — runs in every page (host, player, admin).
// Choice persists in localStorage as 'trivia-theme' = "dark" | "light" | "system".
// "system" follows the OS preference via prefers-color-scheme.
// The data-theme attribute is set on <html> and a CSS rule overrides
// :root variables accordingly.

(function () {
  'use strict';

  var STORAGE_KEY = 'trivia-theme';
  var VALID = ['dark', 'light', 'system'];

  function readChoice() {
    try {
      var v = localStorage.getItem(STORAGE_KEY);
      if (VALID.indexOf(v) !== -1) return v;
    } catch (_) {}
    return 'system';
  }

  function systemPrefersDark() {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  function resolve(choice) {
    return choice === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : choice;
  }

  function apply(choice) {
    var resolved = resolve(choice);
    document.documentElement.setAttribute('data-theme', resolved);
    document.documentElement.setAttribute('data-theme-choice', choice);
  }

  function setChoice(choice) {
    if (VALID.indexOf(choice) === -1) choice = 'system';
    try { localStorage.setItem(STORAGE_KEY, choice); } catch (_) {}
    apply(choice);
    // Let other code (analytics, future per-page UI) react.
    document.dispatchEvent(new CustomEvent('trivia:themechange', { detail: { choice: choice } }));
  }

  // Public API
  window.TriviaTheme = {
    get: readChoice,
    set: setChoice,
    cycle: function () {
      var cur = readChoice();
      var idx = VALID.indexOf(cur);
      setChoice(VALID[(idx + 1) % VALID.length]);
    },
    apply: apply,  // re-resolve (e.g. after a system pref change)
  };

  // Initial apply — must happen before <body> paints to avoid flash.
  apply(readChoice());

  // React to OS-level changes when in "system" mode.
  if (window.matchMedia) {
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    var listener = function () { if (readChoice() === 'system') apply('system'); };
    if (mq.addEventListener) mq.addEventListener('change', listener);
    else if (mq.addListener) mq.addListener(listener);
  }
})();
