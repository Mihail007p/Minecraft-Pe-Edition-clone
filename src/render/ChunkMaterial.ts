import { Color, DoubleSide, FrontSide, ShaderMaterial, type DataArrayTexture } from 'three';

const vertexShader = /* glsl */ `
attribute float layer;
attribute float light;

varying vec2 vUv;
varying float vLayer;
varying float vLight;
varying float vFogDepth;

void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  vUv = uv;
  vLayer = layer;
  vLight = light;
  vFogDepth = -mvPosition.z;
}
`;

const fragmentShader = /* glsl */ `
precision highp sampler2DArray;

uniform sampler2DArray uAtlas;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
uniform float uAlphaTest;
uniform float uOpacity;
uniform float uAmbient;

varying vec2 vUv;
varying float vLayer;
varying float vLight;
varying float vFogDepth;

void main() {
  vec4 tex = texture(uAtlas, vec3(vUv, vLayer));
  if (tex.a < uAlphaTest) discard;
  vec3 col = tex.rgb * (vLight * uAmbient);
  float fog = smoothstep(uFogNear, uFogFar, vFogDepth);
  col = mix(col, uFogColor, fog);
  gl_FragColor = vec4(col, tex.a * uOpacity);
}
`;

export interface ChunkMaterials {
  opaque: ShaderMaterial;
  cutout: ShaderMaterial;
  water: ShaderMaterial;
  /** Обновить параметры тумана у всех материалов. */
  setFog(color: Color, near: number, far: number): void;
  /** Общая яркость (день/ночь, под водой). */
  setAmbient(value: number): void;
  dispose(): void;
}

export function createChunkMaterials(atlas: DataArrayTexture): ChunkMaterials {
  const make = (
    alphaTest: number, opacity: number, transparent: boolean, doubleSide: boolean, depthWrite = !transparent,
  ) =>
    // three.js сам компилирует под GLSL ES 3.00 (WebGL2), поэтому sampler2DArray доступен,
    // а gl_FragColor отображается на выходную переменную.
    new ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uAtlas: { value: atlas },
        uFogColor: { value: new Color(0x9fc4ff) },
        uFogNear: { value: 60 },
        uFogFar: { value: 90 },
        uAlphaTest: { value: alphaTest },
        uOpacity: { value: opacity },
        uAmbient: { value: 1 },
      },
      transparent,
      depthWrite,
      side: doubleSide ? DoubleSide : FrontSide,
    });

  const opaque = make(0, 1, false, false);
  const cutout = make(0.5, 1, true, true, true);
  const water = make(0, 1, true, true);
  const all = [opaque, cutout, water];

  return {
    opaque,
    cutout,
    water,
    setFog(color, near, far) {
      for (const m of all) {
        (m.uniforms.uFogColor.value as Color).copy(color);
        m.uniforms.uFogNear.value = near;
        m.uniforms.uFogFar.value = far;
      }
    },
    setAmbient(value) {
      for (const m of all) m.uniforms.uAmbient.value = value;
    },
    dispose() {
      for (const m of all) m.dispose();
    },
  };
}
