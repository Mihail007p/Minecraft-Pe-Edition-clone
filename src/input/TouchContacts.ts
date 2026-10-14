/** Единый поток касаний: Pointer Events или Touch Events для старых Android WebView. */
export interface TouchContact {
  pointerId: number;
  clientX: number;
  clientY: number;
}

interface ContactHandlers {
  down(contact: TouchContact): boolean;
  move(contact: TouchContact): void;
  up(contact: TouchContact, cancelled: boolean): void;
}

export function bindTouchContacts(element: HTMLElement, handlers: ContactHandlers) {
  const active = new Set<number>();
  const listeners: (() => void)[] = [];
  const usePointer = typeof window.PointerEvent === 'function';
  const listen = (target: EventTarget, type: string, handler: (event: Event) => void) => {
    target.addEventListener(type, handler, { passive: false });
    listeners.push(() => target.removeEventListener(type, handler));
  };
  const prevent = (event: Event) => {
    if (event.cancelable) event.preventDefault();
  };
  const release = (id: number) => {
    // Некоторые Android WebView не поддерживают capture или бросают NotFoundError.
    try { element.releasePointerCapture?.(id); } catch { /* контакт уже потерян */ }
  };
  const down = (contact: TouchContact, event: Event) => {
    if (active.has(contact.pointerId) || !handlers.down(contact)) return;
    active.add(contact.pointerId);
    prevent(event); // Не порождать совместимые события мыши / выделение / прокрутку.
    if (usePointer) {
      try { element.setPointerCapture?.(contact.pointerId); } catch { /* слушаем window и без capture */ }
    }
  };
  const move = (contact: TouchContact, event: Event) => {
    if (!active.has(contact.pointerId)) return;
    prevent(event);
    handlers.move(contact);
  };
  const up = (contact: TouchContact, event: Event, cancelled: boolean) => {
    if (!active.delete(contact.pointerId)) return;
    prevent(event);
    handlers.up(contact, cancelled);
    if (usePointer) release(contact.pointerId);
  };

  if (usePointer) {
    listen(element, 'pointerdown', (event) => {
      const e = event as PointerEvent;
      if (e.pointerType !== 'mouse') down(e, e);
    });
    // Окончание жеста приходит и за пределами элемента, даже если capture недоступен.
    listen(window, 'pointermove', (e) => move(e as PointerEvent, e));
    listen(window, 'pointerup', (e) => up(e as PointerEvent, e, false));
    listen(window, 'pointercancel', (e) => up(e as PointerEvent, e, true));
    listen(element, 'lostpointercapture', (e) => up(e as PointerEvent, e, true));
  } else {
    const contacts = (event: Event, handler: (contact: TouchContact, event: Event) => void) => {
      const touches = (event as TouchEvent).changedTouches;
      for (let i = 0; i < touches.length; i++) {
        const touch = touches[i];
        handler({ pointerId: touch.identifier, clientX: touch.clientX, clientY: touch.clientY }, event);
      }
    };
    listen(element, 'touchstart', (e) => contacts(e, down));
    listen(window, 'touchmove', (e) => contacts(e, move));
    listen(window, 'touchend', (e) => contacts(e, (c, event) => up(c, event, false)));
    listen(window, 'touchcancel', (e) => contacts(e, (c, event) => up(c, event, true)));
  }
  listen(element, 'contextmenu', (e) => e.preventDefault());

  const reset = () => {
    const ids = [...active];
    active.clear(); // lostpointercapture при release не должен завершать жест повторно.
    if (usePointer) ids.forEach(release);
  };
  return {
    reset,
    dispose() {
      reset();
      listeners.forEach((remove) => remove());
    },
  };
}
