// Tiny DOM helpers.
export function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.appendChild(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}
export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}
export function stars(rating) {
  const n = Math.max(0, Math.min(5, rating / 20));
  let s = '';
  for (let i = 1; i <= 5; i++) s += n >= i - 0.25 ? '★' : n >= i - 0.75 ? '⯪' : '☆';
  return s;
}
