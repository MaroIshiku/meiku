/*
 * Start-up guard (classic script, deliberately ES5 so it runs on every browser).
 * If the app module fails to load, throws during start-up or hangs, this shows
 * the actual error instead of a blank screen, plus a "Repair app" button that
 * removes the offline copy (service workers and caches) and reloads. Browser
 * storage (PIN, remembered name) and the vault on the server are not touched.
 */
(function () {
  'use strict';
  var ready = false;
  var START_TIMEOUT_MS = 12000;

  function show(message) {
    if (ready) return;
    var box = document.getElementById('bootError');
    var text = document.getElementById('bootErrorText');
    var body = document.getElementById('authBody');
    if (!box || !text) return;
    text.textContent = message;
    box.hidden = false;
    if (body) body.hidden = true;
    var subtitle = document.getElementById('authSubtitle');
    if (subtitle) subtitle.textContent = 'Something went wrong while starting.';
  }

  window.__meikuReady = function () {
    ready = true;
    var box = document.getElementById('bootError');
    var body = document.getElementById('authBody');
    if (box) box.hidden = true;
    if (body) body.hidden = false;
  };
  window.__meikuFail = function (error) {
    show(String((error && (error.message || error)) || 'Unknown error'));
  };

  if (!('noModule' in document.createElement('script'))) {
    show('This browser is too old for Meiku. Update the browser or the operating system.');
    return;
  }

  window.addEventListener('error', function (event) {
    if (ready) return;
    var target = event.target;
    if (target && target !== window && (target.src || target.href)) {
      show('Could not load ' + String(target.src || target.href).split('/').pop() + '. Check the connection and try again.');
      return;
    }
    var where = event.filename ? ' (' + String(event.filename).split('/').pop().split('?')[0] + ':' + event.lineno + ')' : '';
    show((event.message || 'Script error') + where);
  }, true);

  window.addEventListener('unhandledrejection', function (event) {
    var reason = event.reason;
    show(String((reason && (reason.message || reason)) || 'Unknown error'));
  });

  setTimeout(function () {
    show('Meiku is taking unusually long to start. The server may be unreachable from this device.');
  }, START_TIMEOUT_MS);

  function repair() {
    var tasks = [];
    if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
      tasks.push(navigator.serviceWorker.getRegistrations().then(function (list) {
        return Promise.all(list.map(function (registration) { return registration.unregister(); }));
      }));
    }
    if (window.caches && caches.keys) {
      tasks.push(caches.keys().then(function (keys) {
        return Promise.all(keys.map(function (key) { return caches.delete(key); }));
      }));
    }
    Promise.all(tasks).then(reload, reload);
  }
  function reload() { location.replace(location.pathname + '?repaired=' + Date.now()); }

  document.addEventListener('click', function (event) {
    var id = event.target && event.target.closest ? (event.target.closest('button') || {}).id : event.target.id;
    if (id === 'bootRepair') repair();
    if (id === 'bootReload') location.reload();
  });
})();
