(function () {
  if (localStorage.getItem('admin-density') === 'compact') {
    document.body.classList.add('density-compact');
  }
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.classList) return;
    if (t.classList.contains('density-toggle')) {
      var compact = document.body.classList.toggle('density-compact');
      localStorage.setItem('admin-density', compact ? 'compact' : 'cozy');
    } else if (t.classList.contains('kv-add')) {
      e.preventDefault();
      var list = document.querySelector('.kv-list');
      var tmpl = document.querySelector('.kv-row-template');
      if (list && tmpl && tmpl.content && tmpl.content.firstElementChild) {
        list.appendChild(tmpl.content.firstElementChild.cloneNode(true));
      }
    } else if (t.classList.contains('kv-remove')) {
      e.preventDefault();
      var row = t.closest('.kv-row');
      if (row) row.remove();
    }
  });

  document.addEventListener('change', function (e) {
    var t = e.target;
    if (t && t.classList && t.classList.contains('schema-auto-submit') && t.form) {
      t.form.submit();
    }
  });

  function widthStorageKey(tableKey) { return 'admin-colwidths:' + tableKey; }

  function loadWidths(tableKey) {
    try {
      return JSON.parse(localStorage.getItem(widthStorageKey(tableKey)) || '{}');
    } catch (_) { return {}; }
  }

  function saveWidths(tableKey, map) {
    localStorage.setItem(widthStorageKey(tableKey), JSON.stringify(map));
  }

  function applyWidths(scrollEl) {
    var tableKey = scrollEl.dataset.tableKey;
    if (!tableKey) return;
    var widths = loadWidths(tableKey);
    scrollEl.querySelectorAll('th[data-col-name]').forEach(function (th) {
      var w = widths[th.dataset.colName];
      if (w) th.style.width = w + 'px';
    });
  }

  function attachResizers(scrollEl) {
    var tableKey = scrollEl.dataset.tableKey;
    if (!tableKey) return;
    scrollEl.querySelectorAll('th .col-resizer').forEach(function (handle) {
      handle.addEventListener('mousedown', function (e) {
        e.preventDefault();
        var th = handle.parentElement;
        var startX = e.clientX;
        var startW = th.offsetWidth;
        var colName = handle.dataset.col;
        document.body.style.userSelect = 'none';

        function onMove(ev) {
          var w = Math.max(48, startW + (ev.clientX - startX));
          th.style.width = w + 'px';
        }
        function onUp() {
          document.body.style.userSelect = '';
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          var widths = loadWidths(tableKey);
          widths[colName] = th.offsetWidth;
          saveWidths(tableKey, widths);
        }
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });
    });
  }

  function initTable(scrollEl) {
    if (!scrollEl) return;
    scrollEl.querySelectorAll('th').forEach(function (th, idx) {
      var sortLink = th.querySelector('.col-sort');
      if (sortLink) th.dataset.colName = sortLink.textContent.trim().split(/\s/)[0];
    });
    applyWidths(scrollEl);
    attachResizers(scrollEl);
  }

  function initAllTables(root) {
    (root || document).querySelectorAll('.table-scroll[data-table-key]').forEach(initTable);
  }

  document.addEventListener('DOMContentLoaded', function () { initAllTables(document); });
  document.body.addEventListener('htmx:afterSwap', function (evt) {
    initAllTables(evt.target);
    if (evt.target && evt.target.querySelector) {
      var focusEl = evt.target.querySelector('[autofocus]');
      if (focusEl) focusEl.focus();
    }
  });
})();
