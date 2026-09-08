/* Basket Builder — split the detail line at its separator.

   Markup is a single node:  27 pieces · 10" Round Basket
   Left to wrap on its own it orphans the last word ("...Round
   / Basket"). This breaks it at the "·" instead, so it always reads:

       27 pieces
       10" Round Basket

   Phones only — on wider screens the line fits and is left alone. */
(function () {
  var MQ = '(max-width: 749px)';

  function split(el) {
    if (el.dataset.bbSplit === '1') return;
    var raw = (el.textContent || '').trim();
    var i = raw.indexOf('·');            // ·
    if (i === -1) return;
    var head = raw.slice(0, i).trim();
    var tail = raw.slice(i + 1).trim();
    if (!head || !tail) return;
    el.textContent = '';
    el.appendChild(document.createTextNode(head));
    el.appendChild(document.createElement('br'));
    el.appendChild(document.createTextNode(tail));
    el.dataset.bbSplit = '1';
  }

  function run() {
    if (!window.matchMedia || !window.matchMedia(MQ).matches) return;
    document.querySelectorAll('.basket-card .basket-details').forEach(split);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
  window.addEventListener('resize', run);
})();
