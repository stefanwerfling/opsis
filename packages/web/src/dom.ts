/**
 * Minimal DOM builder. Text is always inserted as text nodes – there is deliberately no
 * innerHTML path, so user and agent supplied strings can never become markup.
 */

type EventHandlers = {
  [K in keyof HTMLElementEventMap as `on${Capitalize<K>}`]?: (event: HTMLElementEventMap[K]) => void;
};

export type Attributes = EventHandlers & {
  class?: string | undefined;
  /** Additional attributes (aria-*, type, href, …). `false`/`undefined` omit the attribute. */
  attrs?: Record<string, string | number | boolean | undefined>;
  dataset?: Record<string, string>;
  /** Element properties such as `value`, `checked`, `disabled`. */
  props?: Record<string, unknown>;
};

export type Child = Node | string | number | false | null | undefined;

export const h = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Attributes = {},
  ...children: (Child | Child[])[]
): HTMLElementTagNameMap[K] => {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined) continue;
    if (key === 'class') {
      element.className = value as string;
    } else if (key === 'attrs') {
      for (const [name, attr] of Object.entries(value as NonNullable<Attributes['attrs']>)) {
        if (attr === undefined || attr === false) continue;
        element.setAttribute(name, attr === true ? '' : String(attr));
      }
    } else if (key === 'dataset') {
      Object.assign(element.dataset, value);
    } else if (key === 'props') {
      Object.assign(element, value);
    } else if (key.startsWith('on') && typeof value === 'function') {
      element.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    }
  }
  append(element, children);
  return element;
};

export const append = (parent: Node, children: (Child | Child[])[]): void => {
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  }
};

/** Replaces all children of `parent`. */
export const replaceChildren = (parent: Element, ...children: (Child | Child[])[]): void => {
  parent.replaceChildren();
  append(parent, children);
};

/** Reads a named form control as trimmed string ('' when missing). */
export const formValue = (form: HTMLFormElement, name: string): string => {
  const value = new FormData(form).get(name);
  return typeof value === 'string' ? value.trim() : '';
};
