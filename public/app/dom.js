/**
 * A tiny hyperscript helper.
 *
 * Everything in the UI is built from `el()`, which means user data always
 * reaches the DOM through textContent or setAttribute — never innerHTML — so
 * a routine titled `<img onerror=…>` is just a title.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';
const SVG_TAGS = new Set([
  'svg', 'g', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon',
  'text', 'defs', 'linearGradient', 'stop', 'use', 'tspan', 'ellipse', 'clipPath',
]);

export function el(tag, props = null, ...children) {
  const node = SVG_TAGS.has(tag)
    ? document.createElementNS(SVG_NS, tag)
    : document.createElement(tag);

  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value === null || value === undefined || value === false) continue;

      if (key === 'class' || key === 'className') {
        node.setAttribute('class', Array.isArray(value) ? value.filter(Boolean).join(' ') : value);
      } else if (key === 'style' && typeof value === 'object') {
        for (const [prop, val] of Object.entries(value)) {
          if (val !== null && val !== undefined) node.style.setProperty(prop, String(val));
        }
      } else if (key === 'dataset') {
        for (const [prop, val] of Object.entries(value)) node.dataset[prop] = val;
      } else if (key.startsWith('on') && typeof value === 'function') {
        node.addEventListener(key.slice(2).toLowerCase(), value);
      } else if (key === 'html') {
        // Only ever used with strings this module builds itself.
        node.innerHTML = value;
      } else if (key === 'ref' && typeof value === 'function') {
        value(node);
      } else if (key in node && !SVG_TAGS.has(tag) && typeof value !== 'object') {
        try { node[key] = value; } catch { node.setAttribute(key, String(value)); }
      } else {
        node.setAttribute(key, value === true ? '' : String(value));
      }
    }
  }

  append(node, children);
  return node;
}

function append(parent, children) {
  for (const child of children) {
    if (child === null || child === undefined || child === false || child === true) continue;
    if (Array.isArray(child)) { append(parent, child); continue; }
    parent.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export function frag(...children) {
  const f = document.createDocumentFragment();
  append(f, children);
  return f;
}

/** Replace a container's content in one operation. */
export function mount(container, ...children) {
  container.replaceChildren();
  append(container, children);
  return container;
}

export const $ = (selector, scope = document) => scope.querySelector(selector);
export const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];

/** Delegated event listener: one handler for a whole list. */
export function delegate(root, event, selector, handler) {
  root.addEventListener(event, (e) => {
    const match = e.target.closest(selector);
    if (match && root.contains(match)) handler(e, match);
  });
}
