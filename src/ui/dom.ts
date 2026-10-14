/** Крошечный помощник для создания DOM без фреймворков. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | boolean | ((e: Event) => void)> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (typeof value === 'function') {
      node.addEventListener(key, value);
    } else if (typeof value === 'boolean') {
      if (value) node.setAttribute(key, '');
    } else if (key === 'class') {
      node.className = value;
    } else if (key === 'text') {
      node.textContent = value;
    } else if (key === 'html') {
      node.innerHTML = value;
    } else {
      node.setAttribute(key, value);
    }
  }
  for (const child of children) node.append(child);
  return node;
}

/** Кнопка в стиле игры. */
export function button(label: string, onClick: () => void, className = ''): HTMLButtonElement {
  return el('button', { class: `mc-btn ${className}`.trim(), type: 'button', click: onClick }, [label]);
}

export function show(node: HTMLElement, visible: boolean): void {
  node.classList.toggle('hidden', !visible);
}
