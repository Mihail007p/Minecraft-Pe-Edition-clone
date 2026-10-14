import { Crafting } from '../crafting/Crafting.ts';
import { ITEMS, ITEM_BY_ID, type Category, type Slot } from '../crafting/Items.ts';
import { fits, RECIPES, type Recipe } from '../crafting/Recipes.ts';
import { itemIconURL } from '../render/ItemIcons.ts';
import { button, el, show } from './dom.ts';

const categories: Record<Category | 'all', string> = {
  all: 'Все', building: 'Строительство', equipment: 'Снаряжение', materials: 'Материалы',
};

/** Общий инвентарь и верстак: одинаковые операции мышью и касанием. */
export class Inventory {
  readonly root: HTMLElement;
  readonly model: Crafting;
  onPick: ((itemId: number) => void) | null = null;
  onClose: (() => void) | null = null;
  onChange: (() => void) | null = null;
  private title: HTMLElement;
  private content: HTMLElement;
  private status: HTMLElement;
  private search: HTMLInputElement;
  private category: HTMLSelectElement;
  private available: HTMLInputElement;
  private tabs: HTMLElement;
  private tab: 'creative' | 'craft' = 'creative';
  private single = false;
  private selectedRecipe: Recipe | null = null;
  private focusBefore: HTMLElement | null = null;

  constructor(parent: HTMLElement, model = new Crafting()) {
    this.model = model;
    this.title = el('span', { class: 'panel-title', id: 'inventory-title' }, ['Инвентарь']);
    this.content = el('div', { class: 'inventory-content' });
    this.status = el('div', { class: 'craft-status', role: 'status', 'aria-live': 'polite' });
    this.search = el('input', { class: 'mc-input recipe-search', type: 'search', placeholder: 'Поиск предметов…',
      'aria-label': 'Поиск предметов и рецептов', input: () => this.render() });
    this.category = el('select', { class: 'recipe-category', 'aria-label': 'Категория', change: () => this.render() },
      Object.entries(categories).map(([value, label]) => el('option', { value }, [label])));
    this.available = el('input', { type: 'checkbox', change: () => this.render() });
    this.tabs = el('div', { class: 'inventory-tabs', role: 'tablist', 'aria-label': 'Раздел инвентаря' });
    this.root = el('div', { class: 'overlay inventory hidden' }, [
      el('div', { class: 'panel crafting-panel', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'inventory-title' }, [
        el('div', { class: 'panel-header' }, [this.title, button('✕', () => this.onClose?.(), 'small inventory-close')]),
        this.tabs,
        el('div', { class: 'recipe-filters' }, [this.search, this.category,
          el('label', { class: 'available-filter' }, [this.available, ' Доступные'])]),
        this.content, this.status,
      ]),
    ]);
    this.root.addEventListener('click', e => { if (e.target === this.root) this.onClose?.(); });
    this.root.addEventListener('keydown', e => {
      if (e.code === 'Escape' || (e.code === 'KeyE' && !(e.target as HTMLElement).closest('input, select'))) {
        e.preventDefault(); e.stopPropagation(); this.onClose?.();
      }
      if (e.code === 'Tab') {
        const focusable = [...this.root.querySelectorAll<HTMLElement>('button:not(:disabled), input, select')];
        const index = focusable.indexOf(document.activeElement as HTMLElement);
        if (e.shiftKey && index <= 0) { e.preventDefault(); focusable.at(-1)?.focus(); }
        else if (!e.shiftKey && index === focusable.length - 1) { e.preventDefault(); focusable[0]?.focus(); }
      }
    });
    parent.appendChild(this.root);
  }

  open(workbench = false): void {
    if (!this.model.setSize(workbench ? 3 : 2)) return;
    this.focusBefore = document.activeElement as HTMLElement;
    if (workbench) this.tab = 'craft';
    this.selectedRecipe = null;
    this.title.textContent = workbench ? 'Верстак · 3 × 3' : 'Инвентарь · 2 × 2';
    this.status.textContent = '';
    show(this.root, true);
    this.render();
    this.root.querySelector<HTMLButtonElement>('.inventory-close')!.focus();
  }

  close(): boolean {
    if (!this.model.returnAll()) {
      this.status.textContent = 'Инвентарь полон. Освободите место для предметов из сетки и руки.';
      return false;
    }
    show(this.root, false);
    this.onChange?.();
    this.focusBefore?.focus();
    return true;
  }

  get isOpen(): boolean { return !this.root.classList.contains('hidden'); }

  private changed(message = ''): void {
    this.onChange?.();
    this.status.textContent = message;
    this.render();
  }

  private icon(stack: Slot): Node[] {
    if (!stack) return [];
    return [el('img', { src: itemIconURL(stack.id), alt: '', draggable: 'false' }),
      ...(stack.count > 1 ? [el('span', { class: 'stack-count' }, [String(stack.count)])] : [])];
  }

  private stackLabel(stack: Slot): string {
    return stack ? `${ITEM_BY_ID.get(stack.id)!.name} × ${stack.count}` : 'Пусто';
  }

  private slot(area: 'grid' | 'slots', index: number): HTMLButtonElement {
    const stack = this.model[area][index];
    const label = `${area === 'grid' ? 'Крафт' : index < 9 ? 'Хотбар' : 'Сумка'} ${index + 1}: ${this.stackLabel(stack)}`;
    const cell = el('button', { class: `craft-slot ${area === 'slots' && index < 9 ? 'bag-hotbar' : ''}`,
      type: 'button', title: label, 'aria-label': label, 'data-area': area, 'data-index': String(index),
      click: () => { this.model.click(area, index, this.single); this.changed(); },
      contextmenu: e => { e.preventDefault(); this.model.click(area, index, true); this.changed(); },
    }, this.icon(stack));
    return cell;
  }

  private render(): void {
    const active = document.activeElement as HTMLElement | null;
    const focusArea = active?.dataset.area;
    const focusIndex = active?.dataset.index;
    const scroll = this.content.querySelector('.recipe-list, .inv-grid')?.scrollTop ?? 0;
    this.tabs.replaceChildren(...(['creative', 'craft'] as const).map(tab => {
      const btn = button(tab === 'creative' ? 'Творчество' : 'Создание', () => {
        this.tab = tab; this.status.textContent = ''; this.render();
      }, this.tab === tab ? 'active' : '');
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-selected', String(this.tab === tab));
      return btn;
    }));
    this.available.parentElement!.classList.toggle('hidden', this.tab !== 'craft');
    const query = this.search.value.trim().toLocaleLowerCase('ru');
    const category = this.category.value;
    const matches = (id: number) => {
      const item = ITEM_BY_ID.get(id)!;
      return (item.name.toLocaleLowerCase('ru').includes(query) || item.key.includes(query)) &&
        (category === 'all' || item.category === category);
    };
    if (this.tab === 'creative') {
      const grid = el('div', { class: 'inv-grid' });
      for (const def of ITEMS.filter(item => matches(item.id))) {
        grid.append(el('button', { class: 'inv-cell', type: 'button', title: def.name, 'aria-label': def.name,
          click: () => this.onPick?.(def.id) }, this.icon({ id: def.id, count: 1 })));
      }
      if (!grid.childElementCount) grid.append(el('p', {}, ['Ничего не найдено']));
      this.content.replaceChildren(grid, el('p', { class: 'hint' }, [
        'Творческий режим: выберите предмет — получите полный стек в выбранном слоте. Во вкладке «Создание» материалы расходуются.',
      ]));
    } else {
      const list = el('div', { class: 'recipe-list' });
      let shown = 0;
      for (const recipe of RECIPES) {
        if (!matches(recipe.result.id)) continue;
        const possible = this.model.canFill(recipe);
        if (this.available.checked && !possible) continue;
        shown++;
        const needsTable = !fits(recipe, this.model.size);
        const name = ITEM_BY_ID.get(recipe.result.id)!.name;
        list.append(el('button', { class: `recipe-card ${possible ? 'craftable' : 'unavailable'} ${this.selectedRecipe === recipe ? 'chosen' : ''}`,
          type: 'button', 'data-recipe': recipe.id, 'aria-label': `${name} × ${recipe.result.count}${needsTable ? ', нужен верстак' : possible ? ', доступно' : ', не хватает материалов'}`,
          click: () => {
            this.selectedRecipe = recipe;
            const ok = this.model.fill(recipe);
            this.changed(ok ? 'Рецепт разложен. Заберите результат справа.' : needsTable
              ? 'Нужен верстак 3 × 3: поставьте его и нажмите «Поставить» / ПКМ.'
              : this.model.cursor ? 'Сначала положите предмет из руки в инвентарь.' : 'Не хватает материалов или места. Ниже показан рецепт.');
          },
        }, [el('span', { class: 'recipe-icon' }, this.icon(recipe.result)),
          el('span', {}, [name, el('small', {}, [needsTable ? 'Верстак 3 × 3' : possible ? 'Можно создать' : 'Нет материалов'])])]));
      }
      if (!shown) list.append(el('p', {}, ['Рецепты не найдены']));
      const book = el('section', { class: 'recipe-book' }, [el('h3', {}, [`Рецепты · ${shown}`]), list]);
      const grid = el('div', { class: 'craft-grid', style: `--grid-size:${this.model.size}` },
        this.model.grid.map((_, i) => this.slot('grid', i)));
      const result = this.model.result;
      const output = el('button', { class: 'craft-slot craft-output', type: 'button', disabled: !result,
        'aria-label': `Результат: ${this.stackLabel(result?.result ?? null)}`, title: 'Забрать результат; Shift — создать всё',
        click: e => {
          const n = this.model.craft((e as MouseEvent).shiftKey);
          this.changed(n ? `Создано: ${n}.` : 'Нет места для результата.');
        },
      }, this.icon(result?.result ?? null));
      const single = button(this.single ? 'По одному: вкл.' : 'По одному: выкл.', () => {
        this.single = !this.single; this.render();
      }, 'small split-toggle');
      single.setAttribute('aria-pressed', String(this.single));
      const all = button('Создать всё', () => {
        const n = this.model.craft(true);
        this.changed(n ? `В инвентарь добавлено: ${n}.` : 'Нет места для результата.');
      }, 'small craft-all');
      all.disabled = !result;
      const discard = button('Удалить из руки', () => {
        this.model.cursor = null; this.changed('Предмет из руки удалён (творческий режим).');
      }, 'small');
      discard.disabled = !this.model.cursor;
      const cursor = el('div', { class: 'cursor-stack' }, [el('span', { class: 'craft-slot' }, this.icon(this.model.cursor)),
        el('span', {}, [`В руке: ${this.stackLabel(this.model.cursor)}`]), discard]);
      const workspace = el('section', { class: 'craft-workspace' }, [
        el('h3', {}, [`Создание · ${this.model.size} × ${this.model.size}`]),
        el('div', { class: 'craft-row' }, [grid, el('span', { class: 'craft-arrow', 'aria-hidden': 'true' }, ['→']), output]),
        el('div', { class: 'craft-actions' }, [single, all]), cursor,
        el('h3', {}, ['Инвентарь · 36 слотов']),
        el('div', { class: 'bag-grid' }, Array.from({ length: 36 }, (_, i) => this.slot('slots', i < 27 ? i + 9 : i - 27))),
        el('p', { class: 'hint' }, ['Тап — взять / положить стек. «По одному» или ПКМ — взять половину / положить один. Нижний ряд — хотбар.']),
      ]);
      if (this.selectedRecipe) workspace.append(this.recipePreview(this.selectedRecipe));
      this.content.replaceChildren(el('div', { class: 'craft-layout' }, [book, workspace]));
    }
    const list = this.content.querySelector('.recipe-list, .inv-grid');
    if (list) list.scrollTop = scroll;
    if (focusArea && focusIndex) this.content.querySelector<HTMLElement>(`[data-area="${focusArea}"][data-index="${focusIndex}"]`)?.focus();
    else if (active && !active.isConnected && this.isOpen) this.root.querySelector<HTMLButtonElement>('.inventory-close')!.focus();
  }

  private recipePreview(recipe: Recipe): HTMLElement {
    const size = recipe.shapeless ? Math.ceil(Math.sqrt(recipe.ingredients.length)) : recipe.width;
    return el('div', { class: 'recipe-preview' }, [
      el('h3', {}, [`${ITEM_BY_ID.get(recipe.result.id)!.name} × ${recipe.result.count}`]),
      el('div', { class: 'recipe-pattern', style: `--grid-size:${size}` }, recipe.ingredients.map(ingredient =>
        el('span', { class: 'craft-slot', title: ingredient?.map(id => ITEM_BY_ID.get(id)!.name).join(' / ') ?? 'Пусто' },
          this.icon(ingredient ? { id: ingredient[0], count: 1 } : null)))),
      el('p', { class: 'hint' }, [recipe.shapeless ? 'Ингредиенты в любом порядке.' : 'Соблюдайте форму. Допустимы сдвиг и зеркальное отражение.']),
    ]);
  }
}
