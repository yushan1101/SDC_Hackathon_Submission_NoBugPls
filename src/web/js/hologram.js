// Hologram mode for the interview scene: Mina projected above a light table instead of seated in an office.
// She keeps her own textures, face morphs and motion; holoSkin() layers a projection look on each material
// (blue rim light, rolling scan lines, a faint flicker), and holoStage() builds the projector, light cone,
// grid floor and drifting motes. No post-processing: the glow is additive sprites and emissive lines.
import * as THREE from "../vendor/three.module.js";

const HOLO = new THREE.Color("#6fa8ff");

/** Shared uniforms: time drives the scan lines and flicker, level brightens her while she speaks. */
export const holoUniforms = { uTime: { value: 0 }, uLevel: { value: 0 } };

/** Turn one of Mina's materials into a projection of itself. Opaque on purpose: a see-through skinned body shows
 *  teeth and eyes through the face, which reads as a glitch, not a hologram. */
export function holoSkin(material) {
  if (!material || material.userData.holo) return;
  material.userData.holo = true;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, holoUniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uTime;\nuniform float uLevel;")
      .replace("#include <dithering_fragment>", `#include <dithering_fragment>
        vec3 holoN = normalize(normal);
        float rim = pow(1.0 - clamp(abs(dot(holoN, normalize(vViewPosition))), 0.0, 1.0), 2.2);
        float scan = 0.9 + 0.1 * sin(gl_FragCoord.y * 1.6 - uTime * 9.0);
        float band = smoothstep(0.0, 0.04, abs(fract(gl_FragCoord.y * 0.004 - uTime * 0.18) - 0.5)) * 0.12 + 0.88;
        float flicker = 0.96 + 0.04 * sin(uTime * 37.0) * sin(uTime * 3.1);
        vec3 tint = vec3(${HOLO.r.toFixed(3)}, ${HOLO.g.toFixed(3)}, ${HOLO.b.toFixed(3)});
        vec3 base = mix(gl_FragColor.rgb, dot(gl_FragColor.rgb, vec3(0.3, 0.55, 0.15)) * tint * 1.6, 0.42);
        gl_FragColor.rgb = (base * scan * band + tint * rim * (0.85 + uLevel * 0.6)) * flicker;`);
  };
  material.needsUpdate = true;
}

const glowTexture = () => {
  const c = document.createElement("canvas"); c.width = c.height = 128;
  const g = c.getContext("2d"), r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, "rgba(255,255,255,1)"); r.addColorStop(0.35, "rgba(255,255,255,0.35)"); r.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = r; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
};

/** The projector stage around (0, 0, z). Returns { group, tick(time, level), dispose() }. */
export function holoStage(scene, { z = 0.34, deskY = 0.92 } = {}) {
  const group = new THREE.Group(); scene.add(group);
  const disposables = [];
  const keep = (x) => { disposables.push(x); return x; };
  const add = (geometry, material, position = [0, 0, 0], rotation = [0, 0, 0]) => {
    const m = new THREE.Mesh(keep(geometry), keep(material)); m.position.set(...position); m.rotation.set(...rotation); group.add(m); return m;
  };
  const additive = (opts) => new THREE.MeshBasicMaterial({ color: HOLO, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, ...opts });

  // floor grid fading into the dark
  const grid = new THREE.GridHelper(14, 56, HOLO, HOLO);
  for (const m of [grid.material].flat()) { m.transparent = true; m.opacity = 0.12; m.depthWrite = false; keep(m); }
  keep(grid.geometry); group.add(grid);

  // projector: a dark puck with two glowing rings, under where she is projected
  add(new THREE.CylinderGeometry(0.95, 1.05, 0.12, 64), new THREE.MeshStandardMaterial({ color: "#0d1526", roughness: 0.4, metalness: 0.6 }), [0, 0.06, z]);
  const ringA = add(new THREE.TorusGeometry(0.9, 0.012, 8, 96), additive({ opacity: 0.9 }), [0, 0.13, z], [Math.PI / 2, 0, 0]);
  const ringB = add(new THREE.TorusGeometry(0.62, 0.008, 8, 96), additive({ opacity: 0.6 }), [0, 0.13, z], [Math.PI / 2, 0, 0]);
  // the light cone she stands in
  const cone = add(new THREE.CylinderGeometry(0.62, 0.92, 3.1, 64, 1, true), additive({ opacity: 0.07, side: THREE.DoubleSide }), [0, 1.67, z]);

  // a glass light-table in front of her (her arms rest on it), drawn as edges and a faint pane
  const table = new THREE.BoxGeometry(2.2, 0.05, 0.8);
  add(table, additive({ opacity: 0.06 }), [0, deskY, z + 0.95]);
  const edges = new THREE.LineSegments(keep(new THREE.EdgesGeometry(table)), keep(new THREE.LineBasicMaterial({ color: HOLO, transparent: true, opacity: 0.7 })));
  edges.position.set(0, deskY, z + 0.95); group.add(edges);

  // soft glows (fake bloom) and motes rising through the cone
  const glowMap = keep(glowTexture());
  const sprite = (scale, opacity, position) => {
    const s = new THREE.Sprite(keep(new THREE.SpriteMaterial({ map: glowMap, color: HOLO, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false })));
    s.scale.set(scale, scale, 1); s.position.set(...position); group.add(s); return s;
  };
  const baseGlow = sprite(3.2, 0.55, [0, 0.2, z]);
  sprite(6, 0.12, [0, 1.8, z - 0.6]);
  const count = 160, pos = new Float32Array(count * 3), speed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * 0.85;
    pos.set([Math.cos(a) * r, Math.random() * 3.1 + 0.15, z + Math.sin(a) * r], i * 3); speed[i] = 0.08 + Math.random() * 0.22;
  }
  const motesGeo = keep(new THREE.BufferGeometry()); motesGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const motes = new THREE.Points(motesGeo, keep(new THREE.PointsMaterial({ map: glowMap, color: HOLO, size: 0.05, transparent: true,
    opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false })));
  group.add(motes);

  let last = 0;
  const tick = (time, level = 0) => {
    const dt = last ? Math.min(0.1, time - last) : 0; last = time;
    holoUniforms.uTime.value = time; holoUniforms.uLevel.value += (level - holoUniforms.uLevel.value) * 0.2;
    ringA.rotation.z = time * 0.25; ringB.rotation.z = -time * 0.4;
    cone.material.opacity = 0.06 + 0.03 * Math.sin(time * 2.3) + holoUniforms.uLevel.value * 0.05;
    baseGlow.material.opacity = 0.5 + 0.1 * Math.sin(time * 3.7) + holoUniforms.uLevel.value * 0.25;
    const p = motesGeo.attributes.position;
    for (let i = 0; i < count; i++) { let y = p.getY(i) + speed[i] * dt; if (y > 3.3) y = 0.15; p.setY(i, y); }
    p.needsUpdate = true;
  };
  return { group, tick, dispose: () => { scene.remove(group); disposables.forEach((d) => d.dispose?.()); } };
}
