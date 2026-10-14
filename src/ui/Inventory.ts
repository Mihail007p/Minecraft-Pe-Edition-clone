import { CREATIVE_BLOCKS } from '../world/Blocks.ts';
import { blockIconURL } from '../render/BlockIcons.ts';
import { button, el, show } from './dom.ts';

/** Каталог творческого режима или добытые блоки; хотбар ссылается на общий запас. */
export class Inventory {
  readonly root: HTMLElement;
  onPick: ((blockId: number) => void) | null = null;
  onClose: (() => void) | null = null;

  private grid: HTMLElement;

  constructor(parent: HTMLElement) {
    this.grid = el('div', { class: 'inv-grid' });
    this.root = el('div', { class: 'overlay inventory hidden' }, [
      el('div', { class: 'panel' }, [
        el('div', { class: 'panel-header' }, [
          el('span', { class: 'panel-title' }, ['Блоки']),
          button('✕', () => this.onClose?.(), 'small'),
        ]),
        this.grid,
        el('div', { class: 'hint' }, ['Нажмите на блок, чтобы положить его в выбранный слот хотбара']),
      ]),
    ]);
    this.root.addEventListener(typeof window.PointerEvent === 'function' ? 'pointerdown' : 'click', (e) => {
      if (e.target === this.root) this.onClose?.();
    });
    parent.appendChild(this.root);
  }

  open(counts?: ReadonlyMap<number, number>): void {
    this.build(counts);
    show(this.root, true);
  }

  close(): void {
    show(this.root, false);
  }

  get isOpen(): boolean {
    return !this.root.classList.contains('hidden');
  }

  private build(counts?: ReadonlyMap<number, number>): void {
    this.grid.replaceChildren();
    this.root.querySelector('.panel-title')!.textContent = counts ? 'Добытые блоки' : 'Все блоки';
    if (counts && ![...counts.values()].some(n => n > 0)) {
      this.grid.append(el('p', { class: 'hint' }, ['Пока пусто. Удерживайте «Сломать» или ЛКМ, чтобы добыть блок.']));
    }
    for (const def of CREATIVE_BLOCKS) {
      if (counts && !counts.get(def.id)) continue;
      const img = el('img', { src: blockIconURL(def.id), alt: def.name, draggable: 'false' });
      const cell = el('button', {
        class: 'inv-cell', type: 'button', title: def.name,
        click: () => this.onPick?.(def.id),
      }, counts ? [img, el('span', { class: 'item-count' }, [String(counts.get(def.id))])] : [img]);
      this.grid.appendChild(cell);
    }
  }
}
