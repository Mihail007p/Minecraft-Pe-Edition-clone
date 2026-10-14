import { DEFAULT_SETTINGS, SETTINGS_STORAGE_KEY, type GameSettings } from '../config.ts';

type Listener = (settings: GameSettings) => void;

/** Хранилище настроек с сохранением в localStorage и подпиской на изменения. */
export class Settings {
  private values: GameSettings;
  private listeners = new Set<Listener>();

  constructor() {
    this.values = { ...DEFAULT_SETTINGS, ...Settings.load() };
  }

  get(): Readonly<GameSettings> {
    return this.values;
  }

  set<K extends keyof GameSettings>(key: K, value: GameSettings[K]): void {
    if (this.values[key] === value) return;
    this.values = { ...this.values, [key]: value };
    this.save();
    for (const l of this.listeners) l(this.values);
  }

  reset(): void {
    this.values = { ...DEFAULT_SETTINGS };
    this.save();
    for (const l of this.listeners) l(this.values);
  }

  onChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private save(): void {
    try {
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(this.values));
    } catch {
      /* приватный режим / нет доступа — игнорируем */
    }
  }

  private static load(): Partial<GameSettings> {
    try {
      const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
      if (!raw) return {};
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null) return {};
      const out: Partial<GameSettings> = {};
      const src = parsed as Record<string, unknown>;
      for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof GameSettings)[]) {
        const v = src[key];
        if (typeof v === typeof DEFAULT_SETTINGS[key]) {
          (out as Record<string, unknown>)[key] = v;
        }
      }
      return out;
    } catch {
      return {};
    }
  }
}
