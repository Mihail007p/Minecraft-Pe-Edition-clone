// Глобальные константы игры.
// Всё, что влияет на баланс/производительность, собрано здесь, чтобы было удобно подстраивать.

export const GAME_TITLE = 'Minecraft PE Clone';
export const GAME_VERSION = '0.4.0';

// --- Мир ---
export const CHUNK_SIZE = 16; // ширина/глубина чанка в блоках
export const CHUNK_HEIGHT = 96; // высота мира в блоках
export const SEA_LEVEL = 32; // уровень моря (y, где заканчивается вода)

// --- Игрок (единицы: блоки, секунды) ---
export const PLAYER_WIDTH = 0.6;
export const PLAYER_HEIGHT = 1.8;
export const PLAYER_EYE_HEIGHT = 1.62;
export const WALK_SPEED = 4.3;
export const SPRINT_SPEED = 5.6;
export const FLY_SPEED = 10.0;
export const FLY_VERTICAL_SPEED = 7.0;
export const JUMP_VELOCITY = 8.6;
export const GRAVITY = 28.0;
export const TERMINAL_VELOCITY = 60.0;
export const WATER_SWIM_SPEED = 3.0;
export const WATER_DRAG = 0.8;
export const WATER_ACCEL = 6.0; // скорость набора вертикальной скорости в воде
export const WATER_RISE_SPEED = 1.6; // плавучесть под водой: всплытие без управления
export const WATER_FLOAT_SPEED = 0.25; // дрейф у поверхности (голова над водой)
export const WATER_JUMP_VELOCITY = 7.2; // выпрыгивание из воды у поверхности
export const WATER_EXIT_VELOCITY = 9.0; // подтягивание на берег/блок при выходе из воды
export const REACH_DISTANCE = 5.5; // дальность взаимодействия с блоками

// --- Камера от третьего лица ---
export type CameraView = 'first' | 'third-back' | 'third-front';
export const CAMERA_VIEW_ORDER: readonly CameraView[] = ['first', 'third-back', 'third-front'];
export const THIRD_PERSON_DISTANCE = 4.2; // дистанция камеры от глаз игрока в блоках
export const THIRD_PERSON_HEIGHT = 0.35; // подъём камеры над линией взгляда (вид сзади)

// --- Управление ---
export const HOLD_TO_BREAK_MS = 220; // удержание тача, после которого начинается ломание
export const BREAK_REPEAT_MS = 260; // интервал действия при удержании (добыча / удар)
export const TAP_MAX_MOVE_PX = 12; // максимальное смещение пальца, чтобы это считалось «тапом»
export const DOUBLE_TAP_MS = 300; // окно для двойного нажатия прыжка (полёт)

// --- Рендер ---
export const MAX_PIXEL_RATIO = 2;
export const FIXED_TIMESTEP = 1 / 60;
export const MAX_SUBSTEPS = 5;

// --- Растекание воды ---
export const WATER_PULSE_INTERVAL = 0.1; // секунд между импульсами симуляции воды
export const WATER_CELLS_PER_PULSE = 4; // ячеек обрабатывается за импульс

// --- Настройки по умолчанию (сохраняются в localStorage) ---
export interface GameSettings {
  renderDistance: number; // в чанках
  sensitivity: number; // множитель чувствительности камеры
  fov: number;
  autoJump: boolean;
  showCoords: boolean;
  invertY: boolean;
  touchGestures: boolean; // тап/удержание на зоне обзора вместо отдельных кнопок
  touchButtonSize: number; // диаметр сенсорных кнопок в CSS-пикселях
  cameraView: CameraView; // первое лицо / третье лицо сзади / третье лицо спереди
}

export const DEFAULT_SETTINGS: GameSettings = {
  renderDistance: 5,
  sensitivity: 1.0,
  fov: 70,
  autoJump: true,
  showCoords: true,
  invertY: false,
  touchGestures: false,
  touchButtonSize: 64,
  cameraView: 'first',
};

export const SETTINGS_STORAGE_KEY = 'mcpe-clone.settings.v1';

export const IS_TOUCH_DEVICE =
  typeof window !== 'undefined' &&
  ('ontouchstart' in window || (navigator.maxTouchPoints ?? 0) > 0 ||
    window.matchMedia?.('(any-pointer: coarse)').matches === true);
