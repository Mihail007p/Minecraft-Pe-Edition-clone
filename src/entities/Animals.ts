import { BoxGeometry, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial, type Scene } from 'three';
import { BLOCKS } from '../world/Blocks.ts';
import { Animal, animalRayDistance, canSpawnAnimal, type AnimalKind } from './Animal.ts';
import type { World } from '../world/World.ts';

interface AnimalView { animal: Animal; root: Group; body: Group; head: Group; legs: Group[]; }

/** Small, bounded herd. Shared GPU resources; no textures or external models. */
export class Animals {
  readonly animals: Animal[] = [];
  private views: AnimalView[] = [];
  private geometry = new BoxGeometry(1, 1, 1);
  private materials = new Map<number, MeshBasicMaterial>();
  private scene: Scene;
  private world: World;
  private spawnTimer = 0;
  private random: () => number;

  constructor(scene: Scene, world: World) {
    this.scene = scene; this.world = world;
    let seed = world.seed ^ 0x51ac7;
    this.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; return (seed >>> 0) / 4294967296; };
    const normals = this.geometry.getAttribute('normal');
    const colors: number[] = [];
    for (let i = 0; i < normals.count; i++) {
      const shade = normals.getY(i) > 0 ? 1 : normals.getY(i) < 0 ? 0.55 : normals.getX(i) ? 0.75 : 0.88;
      colors.push(shade, shade, shade);
    }
    this.geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  }

  private box(parent: Group, color: number, size: number[], pos: number[]): Mesh {
    if (!this.materials.has(color)) this.materials.set(color, new MeshBasicMaterial({ color, vertexColors: true }));
    const mesh = new Mesh(this.geometry, this.materials.get(color));
    mesh.scale.set(size[0], size[1], size[2]); mesh.position.set(pos[0], pos[1], pos[2]);
    parent.add(mesh); return mesh;
  }

  private add(a: Animal): void {
    const root = new Group(), body = new Group(), head = new Group();
    root.add(body); body.add(head);
    const cow = a.kind === 'cow', pig = a.kind === 'pig';
    const color = cow ? 0xe4ded0 : pig ? 0xeaa0a0 : 0xf2eee1;
    const legHeight = pig ? 0.28 : 0.48;
    const bodyY = legHeight + 0.3;
    const width = cow ? 0.8 : 0.7, length = cow ? 1.15 : 0.95;
    this.box(body, color, [width, 0.65, length], [0, bodyY, 0]);
    if (cow) {
      for (const side of [-1, 1]) {
        this.box(body, 0x463a31, [0.018, 0.4, 0.45], [side * 0.407, bodyY + 0.08, -0.22]);
        this.box(body, 0x463a31, [0.018, 0.25, 0.23], [side * 0.407, bodyY - 0.1, 0.3]);
      }
    }
    head.position.set(0, bodyY + 0.12, length / 2);
    this.box(head, pig ? color : cow ? 0x615044 : 0xb5a18a, [0.48, 0.48, 0.43], [0, 0.05, 0.13]);
    this.box(head, pig ? 0xcf808a : 0xbda38c, [0.32, 0.2, 0.12], [0, -0.08, 0.38]);
    for (const side of [-1, 1]) {
      this.box(head, 0xfaf6eb, [0.08, 0.12, 0.025], [side * 0.16, 0.13, 0.351]);
      this.box(head, 0x20201c, [0.045, 0.07, 0.026], [side * 0.16, 0.13, 0.369]);
      this.box(head, color, [0.18, 0.12, 0.18], [side * 0.29, 0.24, 0.08]);
      if (cow) this.box(head, 0xc6b58e, [0.1, 0.22, 0.1], [side * 0.21, 0.39, 0.08]);
      if (pig) this.box(head, 0x8f5660, [0.045, 0.05, 0.015], [side * 0.08, -0.08, 0.45]);
    }
    const legs: Group[] = [];
    for (const x of [-1, 1]) for (const z of [-1, 1]) {
      const leg = new Group(); leg.position.set(x * width * 0.32, legHeight, z * length * 0.32);
      this.box(leg, pig ? color : 0x796655, [0.19, legHeight, 0.2], [0, -legHeight / 2, 0]);
      this.box(leg, 0x463d36, [0.2, 0.1, 0.21], [0, -legHeight + 0.05, 0]);
      body.add(leg); legs.push(leg);
    }
    this.box(body, color, [0.1, 0.28, 0.1], [0, bodyY - 0.1, -length / 2 - 0.04]);
    root.position.set(a.x, a.y, a.z);
    this.scene.add(root); this.animals.push(a); this.views.push({ animal: a, root, body, head, legs });
  }

  populate(px: number, pz: number): void {
    for (let attempt = 0; attempt < 120 && this.animals.length < 12; attempt++) {
      const angle = this.random() * Math.PI * 2, radius = 7 + this.random() * 30;
      const x = Math.floor(px + Math.sin(angle) * radius) + 0.5, z = Math.floor(pz + Math.cos(angle) * radius) + 0.5;
      let y = this.world.surfaceHeight(Math.floor(x), Math.floor(z)) + 1;
      // Tall grass and flowers are not the ground; leaves/tree crowns are.
      while (y > 1 && BLOCKS[this.world.getBlock(Math.floor(x), y - 1, Math.floor(z))].shape === 'cross') y--;
      if (!canSpawnAnimal(this.world, x, y, z) || this.animals.some(a => Math.hypot(a.x - x, a.z - z) < 3)) continue;
      const kind: AnimalKind = (['cow', 'pig', 'sheep'] as const)[this.animals.length % 3];
      const a = new Animal(kind, x, y, z, this.random);
      if (a.ground(this.world, x, z) === y) this.add(a);
    }
  }

  update(dt: number, px: number, pz: number): void {
    for (const view of [...this.views]) {
      const a = view.animal;
      if (Math.hypot(a.x - px, a.z - pz) > 65 || a.y < 0) { this.remove(a); continue; }
      a.update(dt, this.world, this.animals);
      view.root.position.x = a.x; view.root.position.z = a.z;
      view.root.position.y += (a.y - view.root.position.y) * (1 - Math.exp(-12 * dt));
      view.root.rotation.y = a.yaw;
      const stride = Math.min(1, a.speed) * 0.6;
      view.legs.forEach((leg, i) => { leg.rotation.x = Math.sin(a.gait + (i === 0 || i === 3 ? 0 : Math.PI)) * stride; });
      view.body.position.y = Math.abs(Math.sin(a.gait)) * stride * 0.04;
      view.head.rotation.x = a.grazing && !a.panic ? 0.55 : Math.sin(a.gait * 0.5) * 0.05;
      view.body.rotation.z = a.hurt > 0 ? Math.sin(a.hurt * 45) * 0.09 : 0;
    }
    this.spawnTimer += dt;
    if (this.spawnTimer > 15) { this.spawnTimer = 0; this.populate(px, pz); }
  }

  target(origin: readonly number[], dir: readonly number[], reach: number): Animal | null {
    let target: Animal | null = null;
    for (const a of this.animals) {
      const distance = animalRayDistance(a, origin, dir, reach);
      if (distance !== null) { target = a; reach = distance; }
    }
    return target;
  }
  remove(a: Animal): void {
    const i = this.animals.indexOf(a);
    if (i < 0) return;
    this.scene.remove(this.views[i].root); this.views.splice(i, 1); this.animals.splice(i, 1);
  }
  intersectsBlock(x: number, y: number, z: number): boolean {
    return this.animals.some(a => x + 1 > a.x - 0.8 && x < a.x + 0.8 && z + 1 > a.z - 0.8 && z < a.z + 0.8 && y + 1 > a.y && y < a.y + 1.5);
  }
  dispose(): void {
    for (const view of this.views) this.scene.remove(view.root);
    this.views = []; this.animals.length = 0;
    this.geometry.dispose(); for (const material of this.materials.values()) material.dispose();
    this.materials.clear();
  }
}
