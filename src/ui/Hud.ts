import type { GameMode, Survival } from '../player/Survival.ts';
import { ITEM_BY_ID } from '../crafting/Items.ts';
import { itemIconURL } from '../render/ItemIcons.ts';
import { el, show } from './dom.ts';

/** Игровой HUD: прицел, хотбар, кнопки паузы и инвентаря, отладочная панель, эффект под водой. */
export class Hud {
  readonly root: HTMLElement;
  private slotsEl: HTMLElement[] = [];
  private slotImgs: HTMLImageElement[] = [];
  private debugEl: HTMLElement;
  private underwaterEl: HTMLElement;
  private flyEl: HTMLElement;
  private toastEl: HTMLElement;
  private toastTimer: number | null = null;
  private selected = 0;
  private vitalsEl: HTMLElement;
  private eatBtn: HTMLButtonElement;
  private miningEl: HTMLProgressElement;
  private targetEl: HTMLElement;
  private counts: HTMLElement[] = [];
  onEat: (() => void) | null = null;

  onSelectSlot: ((index: number) => void) | null = null;
  onOpenInventory: (() => void) | null = null;
  onPause: (() => void) | null = null;
  onCycleCamera: (() => void) | null = null;

  constructor(parent: HTMLElement) {
    // Без Pointer Events оставляем стандартный click (включая тап) для Android WebView.
    const press = typeof window.PointerEvent === 'function' ? 'pointerdown' : 'click';
    const hotbar = el('div', { class: 'hotbar' });
    for (let i = 0; i < 9; i++) {
      const img = el('img', { class: 'slot-icon', alt: '', draggable: 'false' });
      const slot = el('div', { class: 'slot', [press]: (e) => { e.preventDefault(); e.stopPropagation(); this.onSelectSlot?.(i); } }, [img]);
      const count = el('span', { class: 'item-count' });
      slot.appendChild(count); this.counts.push(count);
      hotbar.appendChild(slot);
      this.slotsEl.push(slot);
      this.slotImgs.push(img as HTMLImageElement);
    }
    const invBtn = el('button', {
      class: 'icon-btn inv-btn', type: 'button', 'aria-label': 'Инвентарь',
      [press]: (e) => { e.preventDefault(); e.stopPropagation(); this.onOpenInventory?.(); },
    }, ['•••']);
    const pauseBtn = el('button', {
      class: 'icon-btn pause-btn', type: 'button', 'aria-label': 'Пауза',
      [press]: (e) => { e.preventDefault(); e.stopPropagation(); this.onPause?.(); },
    }, ['❚❚']);
    const cameraBtn = el('button', {
      class: 'icon-btn camera-btn', type: 'button', 'aria-label': 'Сменить вид камеры',
      title: 'Вид камеры: первое лицо / третье лицо (V)',
      [press]: (e) => { e.preventDefault(); e.stopPropagation(); this.onCycleCamera?.(); },
    }, ['📷']);

    this.debugEl = el('div', { class: 'debug' });
    this.underwaterEl = el('div', { class: 'underwater hidden' });
    this.flyEl = el('div', { class: 'fly-indicator hidden' }, ['Полёт']);
    this.toastEl = el('div', { class: 'toast hidden' });

    this.vitalsEl = el('div', { class: 'vitals' });
    this.eatBtn = el('button', { class: 'mc-btn eat-btn', type: 'button', click: () => this.onEat?.() }, ['Есть · R']);
    this.miningEl = el('progress', { class: 'mining-progress hidden', max: '1', value: '0', 'aria-label': 'Добыча блока' });
    this.targetEl = el('div', { class: 'target-label' });
    this.root = el('div', { class: 'hud hidden' }, [
      this.underwaterEl,
      this.vitalsEl, this.eatBtn, this.miningEl, this.targetEl,
      el('div', { class: 'crosshair' }),
      this.debugEl,
      this.flyEl,
      this.toastEl,
      pauseBtn,
      cameraBtn,
      el('div', { class: 'hotbar-wrap' }, [hotbar, invBtn]),
    ]);
    parent.appendChild(this.root);
  }

  setSurvival(mode: GameMode, stats: Survival, _slots: readonly number[]): void {
    const survival = mode === 'survival';
    this.vitalsEl.textContent = survival
      ? `♥ ${Math.ceil(stats.health)}/20 · Сытость ${Math.ceil(stats.hunger)}/20${stats.air < 10 ? `   ◌ ${Math.ceil(stats.air)}` : ''}`
      : 'Творческий режим';
    this.vitalsEl.classList.toggle('danger', survival && stats.health <= 6);
    show(this.eatBtn, survival);
    this.eatBtn.textContent = `Есть (${stats.food}) · R`;
    this.eatBtn.disabled = stats.food < 1 || stats.hunger >= 20;
  }

  setMining(progress: number): void {
    this.miningEl.value = progress;
    show(this.miningEl, progress > 0);
  }

  setTarget(text: string): void { this.targetEl.textContent = text; }

  setVisible(visible: boolean): void {
    show(this.root, visible);
  }

  setHotbar(slots: readonly number[], counts: readonly number[] = []): void {
    slots.forEach((id, i) => {
      const img = this.slotImgs[i];
      if (id === 0) {
        img.removeAttribute('src');
        img.style.visibility = 'hidden';
      } else {
        img.src = itemIconURL(id);
        img.style.visibility = 'visible';
      }
      this.slotsEl[i].title = ITEM_BY_ID.get(id)?.name ?? '';
      this.counts[i].textContent = counts[i] ? String(counts[i]) : '';
    });
  }

  setSelected(index: number, blockId: number): void {
    this.slotsEl[this.selected]?.classList.remove('selected');
    this.selected = index;
    this.slotsEl[index]?.classList.add('selected');
    if (blockId !== 0) this.toast(ITEM_BY_ID.get(blockId)?.name ?? '');
  }

  setDebug(text: string): void {
    this.debugEl.textContent = text;
  }

  setDebugVisible(visible: boolean): void {
    show(this.debugEl, visible);
  }

  setUnderwater(under: boolean): void {
    show(this.underwaterEl, under);
  }

  setFlying(flying: boolean): void {
    show(this.flyEl, flying);
  }

  /** Короткое всплывающее сообщение над хотбаром (название выбранного блока и т. п.). */
  toast(text: string): void {
    this.toastEl.textContent = text;
    this.toastEl.classList.remove('hidden');
    this.toastEl.classList.remove('fade');
    if (this.toastTimer !== null) window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      this.toastEl.classList.add('fade');
      this.toastTimer = window.setTimeout(() => this.toastEl.classList.add('hidden'), 400);
    }, 1200);
  }
}
