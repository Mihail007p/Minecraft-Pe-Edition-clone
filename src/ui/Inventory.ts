import { CREATIVE_BLOCKS } from '../world/Blocks.ts';
import { blockIconURL } from '../render/BlockIcons.ts';
import { button, el, show } from './dom.ts';

/** Креативный инвентарь: сетка всех блоков, тап кладёт блок в выбранный слот хотбара. */
export class Inventory {
  readonly root: HTMLElement;
  onPick: ((blockId: number) => void) | null = null;
  onClose: (() => void) | null = null;
  private built = false;
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

  open(): void {
    if (!this.built) this.build();
    show(this.root, true);
  }

  close(): void {
    show(this.root, false);
  }

  get isOpen(): boolean {
    return !this.root.classList.contains('hidden');
  }

  private build(): void {
    this.built = true;
    for (const def of CREATIVE_BLOCKS) {
      const img = el('img', { src: blockIconURL(def.id), alt: def.name, draggable: 'false' });
      const cell = el('button', {
        class: 'inv-cell', type: 'button', title: def.name,
        click: () => this.onPick?.(def.id),
      }, [img]);
      this.grid.appendChild(cell);
    }
  }
}
