import {
  Color, DataTexture, DoubleSide, Fog, Mesh, MeshBasicMaterial, NearestFilter, PlaneGeometry,
  RepeatWrapping, RGBAFormat, type Camera, type Scene,
} from 'three';
import { CHUNK_HEIGHT, CHUNK_SIZE } from '../config.ts';
import { generateCloudTexture } from './textures.ts';

export const SKY_COLOR = new Color(0x79a6ff);
export const UNDERWATER_COLOR = new Color(0x1c3f8f);

const CLOUD_HEIGHT = CHUNK_HEIGHT + 24;
const CLOUD_PLANE = 1536;
const CLOUD_TEX = 64;
const CLOUD_PIXEL = 12; // размер одного «пикселя» облака в блоках
const CLOUD_PERIOD = CLOUD_TEX * CLOUD_PIXEL;

/** Небо: цвет фона, туман и слой пиксельных облаков. */
export class Sky {
  readonly fog: Fog;
  private clouds: Mesh;
  private cloudTexture: DataTexture;
  private scene: Scene;

  constructor(scene: Scene) {
    this.scene = scene;
    scene.background = SKY_COLOR.clone();
    this.fog = new Fog(SKY_COLOR.clone(), 60, 90);
    scene.fog = this.fog;

    const data = generateCloudTexture(CLOUD_TEX, 4242);
    this.cloudTexture = new DataTexture(new Uint8Array(data.buffer), CLOUD_TEX, CLOUD_TEX, RGBAFormat);
    this.cloudTexture.magFilter = NearestFilter;
    this.cloudTexture.minFilter = NearestFilter;
    this.cloudTexture.wrapS = RepeatWrapping;
    this.cloudTexture.wrapT = RepeatWrapping;
    this.cloudTexture.repeat.set(CLOUD_PLANE / CLOUD_PERIOD, CLOUD_PLANE / CLOUD_PERIOD);
    this.cloudTexture.needsUpdate = true;

    const material = new MeshBasicMaterial({
      map: this.cloudTexture,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      side: DoubleSide,
      fog: false, // облака видны и за пределами тумана рельефа, как в оригинале
    });
    this.clouds = new Mesh(new PlaneGeometry(CLOUD_PLANE, CLOUD_PLANE), material);
    this.clouds.rotation.x = -Math.PI / 2;
    this.clouds.position.y = CLOUD_HEIGHT;
    this.clouds.renderOrder = 3;
    this.clouds.frustumCulled = false;
    scene.add(this.clouds);
  }

  /** Дальность тумана подстраивается под дальность прорисовки. */
  setRenderDistance(chunks: number): void {
    const far = chunks * CHUNK_SIZE;
    this.fog.near = Math.max(16, far - CHUNK_SIZE * 2.5);
    this.fog.far = far - 4;
  }

  setUnderwater(underwater: boolean, renderDistance: number): void {
    if (underwater) {
      this.fog.color.copy(UNDERWATER_COLOR);
      (this.scene.background as Color).copy(UNDERWATER_COLOR);
      this.fog.near = 2;
      this.fog.far = 24;
    } else {
      this.fog.color.copy(SKY_COLOR);
      (this.scene.background as Color).copy(SKY_COLOR);
      this.setRenderDistance(renderDistance);
    }
  }

  update(camera: Camera, timeSec: number): void {
    const x = camera.position.x;
    const z = camera.position.z;
    this.clouds.position.x = x;
    this.clouds.position.z = z;
    const drift = timeSec * 0.6;
    this.cloudTexture.offset.set((x + drift) / CLOUD_PERIOD, -z / CLOUD_PERIOD);
  }

  dispose(): void {
    this.clouds.geometry.dispose();
    (this.clouds.material as MeshBasicMaterial).dispose();
    this.cloudTexture.dispose();
    this.scene.remove(this.clouds);
  }
}
