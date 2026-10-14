// Эмуляция браузера для дымовых тестов: jsdom + фиктивный WebGL2-контекст.
// Рендер ничего не рисует, но весь путь three.js (программы, буферы, uniform'ы) исполняется,
// а DOM/UI-логика игры проверяется по-настоящему.
import { JSDOM } from 'jsdom';

export interface FakeBrowser {
  window: Window & typeof globalThis;
  glCalls: Map<string, number>;
  /** Прокрутить N кадров requestAnimationFrame. */
  frames(n: number): Promise<void>;
  /** Нажать и отпустить клавишу. */
  key(code: string, down: boolean): void;
  /** Остановить таймеры jsdom, чтобы процесс тестов мог завершиться. */
  close(): void;
}

export function createFakeBrowser(): FakeBrowser {
  const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', {
    pretendToBeVisual: true,
    url: 'http://localhost/',
  });
  const win = dom.window as unknown as Window & typeof globalThis;
  const glCalls = new Map<string, number>();

  // ---- фиктивный WebGL2 ----
  const constants = new Map<string, number>([['NO_ERROR', 0], ['FRAMEBUFFER_COMPLETE', 36053]]);
  const names = new Map<number, string>([[0, 'NO_ERROR'], [36053, 'FRAMEBUFFER_COMPLETE']]);
  let nextConst = 1000;
  const constOf = (name: string): number => {
    let v = constants.get(name);
    if (v === undefined) {
      v = nextConst++;
      constants.set(name, v);
      names.set(v, name);
    }
    return v;
  };
  const makeGL = (canvas: HTMLCanvasElement) => {
    const target = { canvas, drawingBufferWidth: 800, drawingBufferHeight: 600 };
    return new Proxy(target, {
      get(t, prop: string | symbol) {
        if (typeof prop !== 'string') return undefined;
        if (prop in t) return (t as Record<string, unknown>)[prop];
        if (/^[A-Z0-9_]+$/.test(prop)) return constOf(prop);
        return (...args: unknown[]) => {
          glCalls.set(prop, (glCalls.get(prop) ?? 0) + 1);
          switch (prop) {
            case 'getParameter': {
              const name = names.get(args[0] as number) ?? '';
              if (name === 'VERSION') return 'WebGL 2.0 (fake)';
              if (name === 'SHADING_LANGUAGE_VERSION') return 'WebGL GLSL ES 3.00';
              if (name === 'VENDOR' || name === 'RENDERER') return 'fake';
              if (name === 'VIEWPORT' || name === 'SCISSOR_BOX') return [0, 0, 800, 600];
              if (name === 'MAX_TEXTURE_MAX_ANISOTROPY_EXT') return 16;
              return 16;
            }
            case 'getExtension':
              return null;
            case 'getSupportedExtensions':
              return [];
            case 'getContextAttributes':
              return { alpha: false, antialias: false, premultipliedAlpha: true, preserveDrawingBuffer: false, stencil: false, depth: true };
            case 'getShaderPrecisionFormat':
              return { rangeMin: 127, rangeMax: 127, precision: 23 };
            case 'getShaderParameter':
            case 'getProgramParameter': {
              const name = names.get(args[1] as number) ?? '';
              if (name === 'ACTIVE_UNIFORMS' || name === 'ACTIVE_ATTRIBUTES') return 0;
              return true;
            }
            case 'getShaderInfoLog':
            case 'getProgramInfoLog':
              return '';
            case 'getError':
              return 0;
            case 'checkFramebufferStatus':
              return 36053;
            case 'isContextLost':
              return false;
            case 'getUniformLocation':
              return null;
            case 'getAttribLocation':
              return -1;
            case 'createBuffer': case 'createTexture': case 'createProgram': case 'createShader':
            case 'createVertexArray': case 'createFramebuffer': case 'createRenderbuffer': case 'createQuery':
              return {};
            case 'fenceSync':
              return {};
            case 'clientWaitSync':
              return 0;
            default:
              return undefined;
          }
        };
      },
    });
  };

  // ---- фиктивный Canvas 2D (иконки блоков) ----
  const make2D = (canvas: HTMLCanvasElement) => ({
    canvas,
    imageSmoothingEnabled: true,
    fillStyle: '',
    createImageData: (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    putImageData: () => undefined,
    drawImage: () => undefined,
    setTransform: () => undefined,
    fillRect: () => undefined,
    getImageData: (_x: number, _y: number, w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
  });

  const proto = win.HTMLCanvasElement.prototype as unknown as {
    getContext: (type: string) => unknown;
    toDataURL: () => string;
  };
  proto.getContext = function (this: HTMLCanvasElement, type: string) {
    return type.startsWith('webgl') ? makeGL(this) : make2D(this);
  };
  proto.toDataURL = () => 'data:image/png;base64,';

  // ---- глобали для кода игры ----
  const define = (name: string, value: unknown) =>
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  define('window', win);
  define('document', win.document);
  define('navigator', win.navigator);
  define('localStorage', win.localStorage);
  define('screen', win.screen);
  define('requestAnimationFrame', win.requestAnimationFrame.bind(win));
  define('cancelAnimationFrame', win.cancelAnimationFrame.bind(win));
  for (const name of ['HTMLElement', 'HTMLCanvasElement', 'HTMLInputElement', 'HTMLImageElement', 'Element', 'Node', 'Event',
    'KeyboardEvent', 'MouseEvent', 'CustomEvent', 'Image', 'ImageData', 'getComputedStyle', 'matchMedia'] as const) {
    if ((win as unknown as Record<string, unknown>)[name] !== undefined) define(name, (win as unknown as Record<string, unknown>)[name]);
  }
  if (typeof win.PointerEvent !== 'function') {
    // jsdom без PointerEvent — наследуем от MouseEvent с нужными полями
    class PointerEventPolyfill extends win.MouseEvent {
      pointerId: number;
      pointerType: string;
      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 1;
        this.pointerType = init.pointerType ?? 'touch';
      }
    }
    define('PointerEvent', PointerEventPolyfill);
    (win as unknown as Record<string, unknown>).PointerEvent = PointerEventPolyfill;
  }
  (win.Element.prototype as unknown as { setPointerCapture: () => void }).setPointerCapture = () => undefined;
  (win.Element.prototype as unknown as { releasePointerCapture: () => void }).releasePointerCapture = () => undefined;

  return {
    window: win,
    glCalls,
    frames: (n: number) => new Promise<void>((resolve) => {
      let left = n;
      const tick = () => {
        if (--left <= 0) resolve();
        else win.requestAnimationFrame(tick);
      };
      win.requestAnimationFrame(tick);
    }),
    key: (code: string, down: boolean) => {
      win.dispatchEvent(new win.KeyboardEvent(down ? 'keydown' : 'keyup', { code, bubbles: true }));
    },
    close: () => dom.window.close(),
  };
}
