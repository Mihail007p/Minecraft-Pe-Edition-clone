import {
  BoxGeometry, Color, EdgesGeometry, LineBasicMaterial, LineSegments, PerspectiveCamera, Scene,
  WebGLRenderer, type DataArrayTexture,
} from 'three';
import {
  CHUNK_HEIGHT, DEFAULT_SETTINGS, FIXED_TIMESTEP, IS_TOUCH_DEVICE, MAX_PIXEL_RATIO, MAX_SUBSTEPS,
  REACH_DISTANCE, type GameSettings,
} from '../config.ts';
import { InputState, type InputActions } from '../input/InputState.ts';
import { KeyboardMouse } from '../input/KeyboardMouse.ts';
import { TouchControls } from '../input/TouchControls.ts';
import { Player } from '../player/Player.ts';
import { createChunkMaterials, type ChunkMaterials } from '../render/ChunkMaterial.ts';
import { ChunkRenderer } from '../render/ChunkRenderer.ts';
import { Sky } from '../render/Sky.ts';
import { createBlockTextureArray } from '../render/TextureAtlas.ts';
import { Hud } from '../ui/Hud.ts';
import { Inventory } from '../ui/Inventory.ts';
import { LoadingScreen, MainMenu, PauseMenu, SettingsPanel } from '../ui/Menus.ts';
import { AIR, BLOCKS, BLOCK_REPLACEABLE, DEFAULT_HOTBAR } from '../world/Blocks.ts';
import { hashString } from '../world/Noise.ts';
import { raycastBlocks, type RaycastHit } from '../world/Raycast.ts';
import { World } from '../world/World.ts';
import { BIOME_NAMES } from '../world/WorldGen.ts';
import type { Settings } from './Settings.ts';

type GameState = 'menu' | 'loading' | 'playing' | 'paused';

const MOUSE_LOOK_SPEED = 0.0022; // радиан на пиксель при чувствительности 100 %
const TOUCH_LOOK_SPEED = 0.0045;

export class Game {
  private container: HTMLElement;
  private settings: Settings;
  private renderer: WebGLRenderer;
  private scene = new Scene();
  private camera: PerspectiveCamera;
  private atlas: DataArrayTexture;
  private materials: ChunkMaterials;
  private sky: Sky;
  private selectionBox: LineSegments;

  private world: World | null = null;
  private chunkRenderer: ChunkRenderer | null = null;
  private player: Player | null = null;
  private currentHit: RaycastHit | null = null;

  private input = new InputState();
  private touch: TouchControls;
  private keyboard: KeyboardMouse;

  private hud: Hud;
  private inventory: Inventory;
  private mainMenu: MainMenu;
  private pauseMenu: PauseMenu;
  private settingsPanel: SettingsPanel;
  private loading: LoadingScreen;
  private settingsReturnTo: GameState = 'menu';

  private state: GameState = 'menu';
  private hotbar: number[] = [...DEFAULT_HOTBAR];
  private selectedSlot = 0;

  private lastFrame = performance.now();
  private accumulator = 0;
  private startTime = performance.now();
  private fpsFrames = 0;
  private fpsTime = 0;
  private fps = 0;
  private debugTimer = 0;
  private wasUnderwater = false;
  private wasFlying = false;
  private loadTotalGen = 1;
  private loadTotalMesh = 1;

  constructor(container: HTMLElement, settings: Settings) {
    this.container = container;
    this.settings = settings;

    this.renderer = new WebGLRenderer({ antialias: false, powerPreference: 'high-performance', alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.domElement.className = 'game-canvas';
    container.appendChild(this.renderer.domElement);

    this.camera = new PerspectiveCamera(settings.get().fov, window.innerWidth / window.innerHeight, 0.08, 1500);
    this.camera.rotation.order = 'YXZ';

    this.atlas = createBlockTextureArray(this.renderer.capabilities.getMaxAnisotropy());
    this.materials = createChunkMaterials(this.atlas);
    this.sky = new Sky(this.scene);

    this.selectionBox = new LineSegments(
      new EdgesGeometry(new BoxGeometry(1.004, 1.004, 1.004)),
      new LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.6 }),
    );
    this.selectionBox.visible = false;
    this.selectionBox.renderOrder = 5;
    this.scene.add(this.selectionBox);

    // --- UI ---
    this.hud = new Hud(container);
    this.inventory = new Inventory(container);
    this.mainMenu = new MainMenu(container);
    this.pauseMenu = new PauseMenu(container);
    this.settingsPanel = new SettingsPanel(container, settings);
    this.loading = new LoadingScreen(container);

    // --- Ввод ---
    const actions: InputActions = {
      breakBlock: () => this.breakBlock(),
      placeBlock: () => this.placeBlock(),
      selectHotbar: (i) => this.selectSlot(i),
      scrollHotbar: (d) => this.selectSlot((this.selectedSlot + d + 9) % 9),
      toggleFly: () => this.toggleFly(),
      togglePause: () => (this.state === 'playing' ? this.pause() : this.state === 'paused' ? this.resume() : undefined),
      toggleInventory: () => (this.inventory.isOpen ? this.closeInventory() : this.openInventory()),
    };
    this.touch = new TouchControls(container, this.input, actions);
    this.touch.setEnabled(false);
    this.keyboard = new KeyboardMouse(this.renderer.domElement, container, this.input, actions);
    this.keyboard.onPointerLockLost = () => {
      if (this.state === 'playing' && !this.inventory.isOpen) this.pause();
    };

    this.hud.onSelectSlot = (i) => this.selectSlot(i);
    this.hud.onOpenInventory = () => this.openInventory();
    this.hud.onPause = () => this.pause();
    this.inventory.onPick = (id) => {
      this.hotbar[this.selectedSlot] = id;
      this.hud.setHotbar(this.hotbar);
      this.hud.setSelected(this.selectedSlot, id);
      this.closeInventory();
    };
    this.inventory.onClose = () => this.closeInventory();

    this.mainMenu.onPlay = (seed) => this.startWorld(seed);
    this.mainMenu.onSettings = () => this.openSettings('menu');
    this.pauseMenu.onResume = () => this.resume();
    this.pauseMenu.onSettings = () => this.openSettings('paused');
    this.pauseMenu.onQuit = () => this.quitToMenu();
    this.settingsPanel.onBack = () => this.closeSettings();

    settings.onChange((s) => this.applySettings(s));
    this.applySettings(settings.get());
    this.hud.setHotbar(this.hotbar);
    this.hud.setSelected(0, this.hotbar[0]);

    window.addEventListener('resize', () => this.onResize());
    window.visualViewport?.addEventListener('resize', () => this.onResize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'playing') this.pause();
    });

    this.setState('menu');
    requestAnimationFrame(this.frame);
  }

  // ------------------------------------------------------------------ состояние

  private setState(state: GameState): void {
    this.state = state;
    const playing = state === 'playing';
    this.mainMenu.setVisible(state === 'menu');
    this.pauseMenu.setVisible(state === 'paused');
    this.loading.setVisible(state === 'loading');
    this.hud.setVisible(playing);
    this.touch.setEnabled(playing && IS_TOUCH_DEVICE);
    this.keyboard.setEnabled(playing);
    if (!playing) {
      this.input.reset();
      this.keyboard.exitLock();
    }
  }

  startWorld(seedText: string): void {
    this.disposeWorld();
    let seed: number;
    if (seedText.length === 0) seed = (Math.random() * 0xffffffff) >>> 0;
    else if (/^-?\d+$/.test(seedText)) seed = Number(seedText) >>> 0;
    else seed = hashString(seedText);

    this.world = new World(seed);
    this.chunkRenderer = new ChunkRenderer(this.scene, this.world, this.materials);
    this.player = new Player(this.world);
    const spawn = this.world.gen.findSpawn();
    this.player.teleport(spawn.x, spawn.y, spawn.z);
    this.player.yaw = 0;
    this.player.pitch = -0.1;
    this.hotbar = [...DEFAULT_HOTBAR];
    this.selectedSlot = 0;
    this.hud.setHotbar(this.hotbar);
    this.hud.setSelected(0, this.hotbar[0]);
    this.hud.setFlying(false);
    this.touch.setFlying(false);
    this.wasFlying = false;
    this.wasUnderwater = false;
    this.sky.setUnderwater(false, this.settings.get().renderDistance);
    this.hud.setUnderwater(false);
    this.materials.setAmbient(1);

    const r = this.settings.get().renderDistance;
    this.loadTotalGen = (2 * (r + 1) + 1) ** 2;
    this.loadTotalMesh = ChunkRenderer.chunksInRadius(r);
    this.loading.setProgress(0, `Генерация мира (сид ${seed})…`);
    this.setState('loading');

    if (IS_TOUCH_DEVICE) this.tryFullscreen();
  }

  private finishLoading(): void {
    const player = this.player!;
    const world = this.world!;
    // Уточняем точку спавна по реальным блокам (деревья, пещеры, ямы).
    const safe = world.findSafeSpawn(player.x, player.z, 40);
    if (safe) {
      player.teleport(safe.x, safe.y, safe.z);
    } else {
      let y = Math.floor(player.y);
      while (y < CHUNK_HEIGHT - 2 && player.collides(player.x, y, player.z)) y++;
      while (y > 1 && !player.collides(player.x, y - 1, player.z)) y--;
      player.teleport(player.x, y, player.z);
    }
    // Поворачиваем игрока в самую открытую сторону, чтобы не упираться взглядом в стену.
    let bestYaw = 0;
    let bestDist = -1;
    for (let i = 0; i < 16; i++) {
      const yaw = (i / 16) * Math.PI * 2;
      const dx = -Math.sin(yaw);
      const dz = -Math.cos(yaw);
      let dist = 0;
      while (dist < 12) {
        dist += 0.5;
        if (world.isSolidForPhysics(Math.floor(player.x + dx * dist), Math.floor(player.eyeY), Math.floor(player.z + dz * dist))) break;
      }
      if (dist > bestDist) { bestDist = dist; bestYaw = yaw; }
    }
    player.yaw = bestYaw;
    this.setState('playing');
    if (!IS_TOUCH_DEVICE) this.keyboard.requestLock();
  }

  pause(): void {
    if (this.state !== 'playing') return;
    this.closeInventory();
    this.setState('paused');
  }

  resume(): void {
    if (this.state !== 'paused') return;
    this.setState('playing');
    this.lastFrame = performance.now();
    if (!IS_TOUCH_DEVICE) this.keyboard.requestLock();
  }

  quitToMenu(): void {
    this.disposeWorld();
    this.setState('menu');
  }

  private openSettings(returnTo: GameState): void {
    this.settingsReturnTo = returnTo;
    this.mainMenu.setVisible(false);
    this.pauseMenu.setVisible(false);
    this.settingsPanel.setVisible(true);
  }

  private closeSettings(): void {
    this.settingsPanel.setVisible(false);
    if (this.settingsReturnTo === 'paused') this.pauseMenu.setVisible(true);
    else this.mainMenu.setVisible(true);
  }

  private openInventory(): void {
    if (this.state !== 'playing') return;
    this.inventory.open();
    this.touch.setEnabled(false);
    this.keyboard.exitLock();
  }

  private closeInventory(): void {
    if (!this.inventory.isOpen) return;
    this.inventory.close();
    if (this.state === 'playing') {
      this.touch.setEnabled(IS_TOUCH_DEVICE);
      if (!IS_TOUCH_DEVICE) this.keyboard.requestLock();
    }
  }

  private disposeWorld(): void {
    this.chunkRenderer?.dispose();
    this.chunkRenderer = null;
    this.world = null;
    this.player = null;
    this.currentHit = null;
    this.selectionBox.visible = false;
    this.closeInventory();
  }

  private tryFullscreen(): void {
    try {
      const root = document.documentElement;
      if (!document.fullscreenElement && root.requestFullscreen) {
        root.requestFullscreen({ navigationUI: 'hide' }).catch(() => undefined);
      }
      const orientation = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
      orientation.lock?.('landscape').catch(() => undefined);
    } catch {
      /* не поддерживается — не критично */
    }
  }

  // ------------------------------------------------------------------ настройки

  private applySettings(s: GameSettings): void {
    this.touch.configure(s);
    this.camera.fov = s.fov;
    this.camera.updateProjectionMatrix();
    this.sky.setRenderDistance(s.renderDistance);
    this.hud.setDebugVisible(s.showCoords);
  }

  private onResize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------------ действия

  private selectSlot(index: number): void {
    this.selectedSlot = index;
    this.hud.setSelected(index, this.hotbar[index]);
  }

  private toggleFly(): void {
    if (this.state !== 'playing' || !this.player) return;
    this.player.toggleFly();
    this.wasFlying = this.player.flying;
    this.hud.setFlying(this.player.flying);
    this.touch.setFlying(this.player.flying);
  }

  private breakBlock(): void {
    if (this.state !== 'playing' || !this.world || !this.currentHit) return;
    const hit = this.currentHit;
    if (!BLOCKS[hit.id].breakable) return;
    this.world.setBlock(hit.x, hit.y, hit.z, AIR);
    this.updateTarget();
  }

  private placeBlock(): void {
    if (this.state !== 'playing' || !this.world || !this.player || !this.currentHit) return;
    const id = this.hotbar[this.selectedSlot];
    if (id === AIR) return;
    const hit = this.currentHit;
    let x: number, y: number, z: number;
    if (BLOCK_REPLACEABLE[hit.id] === 1) {
      // Трава и подобное заменяются прямо на месте
      x = hit.x; y = hit.y; z = hit.z;
    } else {
      x = hit.x + hit.nx; y = hit.y + hit.ny; z = hit.z + hit.nz;
    }
    if (y < 0 || y >= CHUNK_HEIGHT) return;
    const existing = this.world.getBlock(x, y, z);
    if (BLOCK_REPLACEABLE[existing] !== 1) return;
    const def = BLOCKS[id];
    if (def.solid && this.player.intersectsBlock(x, y, z)) return;
    this.world.setBlock(x, y, z, id);
    this.updateTarget();
  }

  private updateTarget(): void {
    if (!this.world || !this.player) {
      this.currentHit = null;
      this.selectionBox.visible = false;
      return;
    }
    const p = this.player;
    const [dx, dy, dz] = p.lookDirection();
    const hit = raycastBlocks(this.world, p.x, p.eyeY, p.z, dx, dy, dz, REACH_DISTANCE);
    this.currentHit = hit;
    if (hit) {
      this.selectionBox.visible = true;
      this.selectionBox.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
    } else {
      this.selectionBox.visible = false;
    }
  }

  // ------------------------------------------------------------------ цикл

  private frame = (now: number): void => {
    requestAnimationFrame(this.frame);
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;

    this.fpsFrames++;
    this.fpsTime += dt;
    if (this.fpsTime >= 0.5) {
      this.fps = Math.round(this.fpsFrames / this.fpsTime);
      this.fpsFrames = 0;
      this.fpsTime = 0;
    }

    const s = this.settings.get();
    if (this.state === 'loading' && this.world && this.player && this.chunkRenderer) {
      const pendingGen = this.world.update(this.player.x, this.player.z, s.renderDistance, 14);
      this.chunkRenderer.update(this.player.x, this.player.z, s.renderDistance, 14);
      const meshed = this.chunkRenderer.stats.meshed;
      const progress = 0.5 * (1 - pendingGen / this.loadTotalGen) + 0.5 * Math.min(1, meshed / this.loadTotalMesh);
      this.loading.setProgress(progress);
      if (pendingGen === 0 && this.chunkRenderer.stats.pending === 0 && meshed >= this.loadTotalMesh) {
        this.finishLoading();
      }
    } else if (this.state === 'playing' && this.world && this.player && this.chunkRenderer) {
      this.tickPlaying(dt, s);
    }

    if (this.player) {
      this.camera.position.set(this.player.x, this.player.eyeY, this.player.z);
      this.camera.rotation.set(this.player.pitch, this.player.yaw, 0);
    }
    this.sky.update(this.camera, (now - this.startTime) / 1000);
    this.materials.setFog(this.sky.fog.color as Color, this.sky.fog.near, this.sky.fog.far);
    this.renderer.render(this.scene, this.camera);
  };

  private tickPlaying(dt: number, s: GameSettings): void {
    const world = this.world!;
    const player = this.player!;
    const chunkRenderer = this.chunkRenderer!;

    // Камера
    const [ldx, ldy] = this.input.consumeLook();
    const speed = (IS_TOUCH_DEVICE && !this.keyboard.isLocked() ? TOUCH_LOOK_SPEED : MOUSE_LOOK_SPEED) * s.sensitivity;
    const invert = s.invertY ? -1 : 1;
    if (ldx !== 0 || ldy !== 0) player.rotate(-ldx * speed, -ldy * speed * invert);

    // Физика с фиксированным шагом
    this.accumulator = Math.min(this.accumulator + dt, FIXED_TIMESTEP * MAX_SUBSTEPS);
    while (this.accumulator >= FIXED_TIMESTEP) {
      player.update(FIXED_TIMESTEP, this.input, s.autoJump);
      this.accumulator -= FIXED_TIMESTEP;
    }
    if (player.flying !== this.wasFlying) {
      // Полёт мог завершиться приземлением — синхронизируем интерфейс
      this.wasFlying = player.flying;
      this.hud.setFlying(player.flying);
      this.touch.setFlying(player.flying);
    }

    // Мир и меши
    world.update(player.x, player.z, s.renderDistance, 3);
    chunkRenderer.update(player.x, player.z, s.renderDistance, 5);

    // Цель взгляда
    this.updateTarget();

    // Под водой
    if (player.headInWater !== this.wasUnderwater) {
      this.wasUnderwater = player.headInWater;
      this.sky.setUnderwater(player.headInWater, s.renderDistance);
      this.hud.setUnderwater(player.headInWater);
      this.materials.setAmbient(player.headInWater ? 0.8 : 1);
    }

    // Отладка
    this.debugTimer += dt;
    if (this.debugTimer > 0.25 && s.showCoords) {
      this.debugTimer = 0;
      const bx = Math.floor(player.x);
      const bz = Math.floor(player.z);
      const h = world.gen.heightAt(bx, bz);
      const biome = BIOME_NAMES[world.gen.biomeAt(bx, bz, h)] ?? '';
      this.hud.setDebug(
        `${this.fps} FPS · XYZ: ${player.x.toFixed(1)} / ${player.y.toFixed(1)} / ${player.z.toFixed(1)}\n` +
        `Биом: ${biome} · Чанков: ${chunkRenderer.stats.meshed} · Треуг.: ${(chunkRenderer.stats.triangles / 1000).toFixed(0)}k` +
        (player.flying ? ' · Полёт' : ''),
      );
    }
  }

  /** Полное освобождение ресурсов (для горячей перезагрузки). */
  dispose(): void {
    this.disposeWorld();
    this.touch.dispose();
    this.sky.dispose();
    this.materials.dispose();
    this.atlas.dispose();
    this.renderer.dispose();
    this.container.innerHTML = '';
  }
}

export { DEFAULT_SETTINGS };
