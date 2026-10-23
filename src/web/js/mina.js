// Mina, the interviewer: the KPOP_Mina character from LKZ's human project (https://gitee.com/LKZ1999/human,
// Apache-2.0; see web/models/mina/SOURCE.md and LICENSE), as loaded in the browser by HoloHuman
// (OLGTX303/human-multiplatform, holohuman/web/src/mina.js), cut down to what a seated interviewer needs: her own
// skin, hair, lashes, eyes and teeth (textures shrunk for the web), her outfit retextured as a wool suit on its own
// UVs (scripts/build_mina_suit.py), her ARKit face morphs (blinks, smile, jaw) and procedural body motion in the
// spirit of HoloHuman's behaviour.js: breathing and sway, leaning in to listen, and talking hand gestures.
// No animation clips, hair or skirt physics.
import * as THREE from "../vendor/three.module.js";
import { FBXLoader } from "../vendor/addons/loaders/FBXLoader.js";

const DIR = "models/mina/";
// garment tints over the neutral grey suit atlas; jewellery and anything unlisted keeps the atlas colours
const SUIT = { JACKET: 0x2c3a58, TOP: 0xf1ece4, SKIRT: 0x3b3e46, SOCKS: 0x2a2c32, SHOES: 0x1d1e22 };

/** Loads Mina; resolves to { root, head, set(pose) } once the model and every texture are in, so she never shows
 *  half-dressed. onProgress(0..1): the model download is most of it, then the textures. */
export async function loadMina({ envMap, height = 1.6, onProgress } = {}) {
  const loader = new THREE.TextureLoader();
  const textures = [];
  let texturesDone = 0;
  const T = (file, srgb = true, flipY = true) => {
    let t;
    textures.push(new Promise((resolve, reject) => {
      t = loader.load(DIR + file, () => { texturesDone++; onProgress?.(0.85 + 0.15 * texturesDone / textures.length); resolve(); },
        undefined, () => reject(new Error(`Mina's texture ${file} did not load.`)));
    }));
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.flipY = flipY; t.anisotropy = 4;
    return t;
  };
  const mk = (name, opts) => new THREE.MeshPhysicalMaterial({ name, roughness: 0.55, metalness: 0, ior: 1.45,
    envMap, envMapIntensity: 0.55, ...opts });
  // the same surfaces as HoloHuman's materialFor(), with fewer maps
  const materialFor = (name, mesh, old) => {
    const n = name.toUpperCase();
    if (n.includes("HAIR")) return mk(name, { map: T("hair.png"), color: 0x2a221f, transparent: true, opacity: 0.98,
      alphaTest: 0.1, depthWrite: false, side: THREE.DoubleSide, roughness: 0.66, envMapIntensity: 0.35 });
    if (n.includes("LASH")) return mk(name, { map: T("lashes.png"), transparent: true, alphaTest: 0.3, side: THREE.DoubleSide, roughness: 0.9 });
    if (n.includes("EYE")) return mk(name, { map: T("eyes.jpg"), emissiveMap: T("eyes-glint.jpg"), emissive: 0xffffff,
      emissiveIntensity: 0.18, roughness: 0.02, ior: 1.38, clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 1.6 });
    if (n.includes("TEETH") || n.includes("TOOTH")) return mk(name, { map: T("teeth.jpg"), roughness: 0.18, clearcoat: 0.6, clearcoatRoughness: 0.2 });
    if (n.includes("CASUAL")) {  // one suit atlas on the outfit's own UVs, tinted per garment; matte wool, no latex shine
      const garment = Object.entries(SUIT).find(([part]) => mesh.toUpperCase().includes(part));  // the mesh is the garment
      return mk(name, { map: T("suit.jpg", true, false), color: garment ? garment[1] : 0xffffff, roughness: 0.82,
        sheen: 0.4, sheenRoughness: 0.7, sheenColor: 0x9aa6c0, envMapIntensity: 0.35, side: THREE.DoubleSide });
    }
    if (n.includes("HEAD") || n.includes("FACE")) return mk(name, { map: T("head.jpg"), normalMap: T("head-normal.jpg", false),
      roughness: 0.42, ior: 1.4, sheen: 0.18, sheenRoughness: 0.55, sheenColor: 0xffd9c8, clearcoat: 0.22, clearcoatRoughness: 0.42, envMapIntensity: 0.72 });
    if (n.includes("BODY")) return mk(name, { map: T("body.jpg"), roughness: 0.6, ior: 1.4, sheen: 0.18, sheenRoughness: 0.55,
      sheenColor: 0xffd9c8, clearcoat: 0.18, clearcoatRoughness: 0.45, envMapIntensity: 0.68 });
    if (n.includes("TEAR") || n.includes("CENSOR")) return null;
    return old;
  };

  const fbx = await new FBXLoader().loadAsync(DIR + "mina.fbx", (e) => { if (e.lengthComputable) onProgress?.(0.85 * e.loaded / e.total); });
  const morphMeshes = [], seen = new Set();
  fbx.traverse((o) => {
    if (!o.isMesh) return;
    if (seen.has(o.name)) { o.visible = false; return; }  // stacked LOD copies share a name: keep LOD0
    seen.add(o.name);
    o.frustumCulled = false;
    o.castShadow = !/HAIR|TEAR|CENSOR|LASH|EYE/i.test(o.name); o.receiveShadow = true;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const mapped = mats.map((m) => materialFor(m?.name || o.name, o.name, m) ?? new THREE.MeshBasicMaterial({ visible: false }));
    o.material = Array.isArray(o.material) ? mapped : mapped[0];
    // outfit and body panel UVs are bottom-origin in this FBX; the head uses its own convention
    if (/CASUAL/i.test(mats.map((m) => m?.name).join(" ") + o.name)) {
      const uv = o.geometry.attributes.uv;
      if (uv) { for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i)); uv.needsUpdate = true; }
    }
    if (o.morphTargetDictionary) morphMeshes.push(o);
  });

  const bones = {}, fingers = [];
  fbx.traverse((o) => {
    if (!o.isBone) return;
    const n = o.name.toLowerCase();
    if (/^(thumb|index|middle|ring|pinky)_0[1-3]_(l|r)$/.test(n)) fingers.push(o);
    for (const [key, re] of [["head", /head/], ["neck", /^neck/], ["chest", /(chest|spine2|spine_02)/], ["spine", /(^spine_?0?1$|^spine$)/],
      ["clavicleL", /^clavicle_l$/], ["clavicleR", /^clavicle_r$/],
      ["upperArmL", /^upperarm_l$/], ["upperArmR", /^upperarm_r$/], ["lowerArmL", /^lowerarm_l$/], ["lowerArmR", /^lowerarm_r$/],
      ["handL", /^hand_l$/], ["handR", /^hand_r$/]]) if (!bones[key] && re.test(n)) bones[key] = o;
  });

  // height in scene units (1.6 = life size); the head bone sits at ~92% of it
  fbx.updateMatrixWorld(true);
  const headY = bones.head ? bones.head.getWorldPosition(new THREE.Vector3()).y : new THREE.Box3().setFromObject(fbx).max.y;
  fbx.scale.setScalar((height * 0.92) / headY);

  // Arms forward onto the desk, aimed in world space so the FBX's own bone axes don't matter (HoloHuman's aim()).
  const v = () => new THREE.Vector3();
  const aim = (bone, child, dir) => {
    if (!bone || !child) return;
    fbx.updateMatrixWorld(true);
    const from = child.getWorldPosition(v()).sub(bone.getWorldPosition(v()));
    if (from.lengthSq() < 1e-10) return;
    const dq = new THREE.Quaternion().setFromUnitVectors(from.normalize(), dir.clone().normalize());
    const pq = bone.parent.getWorldQuaternion(new THREE.Quaternion());
    bone.quaternion.premultiply(pq.clone().invert().multiply(dq).multiply(pq));
  };
  fbx.updateMatrixWorld(true);
  const chestX = (bones.chest || fbx).getWorldPosition(v()).x;
  for (const [up, lo, hand] of [["upperArmL", "lowerArmL", "handL"], ["upperArmR", "lowerArmR", "handR"]]) {
    const out = Math.sign((bones[up]?.getWorldPosition(v()).x ?? 0) - chestX) || 1;
    aim(bones[up], bones[lo], new THREE.Vector3(out * 0.22, -1, 0.3));   // upper arm hangs, a little forward
    aim(bones[lo], bones[hand], new THREE.Vector3(-out * 0.28, -0.12, 1));  // forearm along the desk, hands in
  }
  for (const b of fingers) { b.rotation.z += b.name.startsWith("thumb") ? 0.08 : 0.18; b.userData.curl = b.rotation.z; }  // relaxed
  const rest = new Map(Object.values(bones).map((b) => [b, b.quaternion.clone()]));

  const morph = (re) => {
    const targets = [];
    for (const m of morphMeshes) for (const [name, i] of Object.entries(m.morphTargetDictionary)) if (re.test(name)) targets.push([m, i]);
    return (value) => targets.forEach(([m, i]) => { m.morphTargetInfluences[i] = value; });
  };
  const blink = morph(/eyeBlink/i), jaw = morph(/jawOpen/i), smile = morph(/mouthSmile(Left|Right)/i),
    brows = morph(/browInnerUp/i);

  // Body motion, as small world-space turns on top of the rest pose (parents first), so the FBX's own bone axes never
  // matter: the same trick as aim(). X tips forward (+) / back, Y turns, Z leans toward her left (+).
  const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
  const pq = new THREE.Quaternion(), dq = new THREE.Quaternion();
  const pose = (bone, ...turns) => {
    if (!bone) return;
    bone.quaternion.copy(rest.get(bone));
    bone.parent.getWorldQuaternion(pq);
    for (const [axis, angle] of turns) if (angle) {
      dq.setFromAxisAngle(axis, angle);
      bone.quaternion.premultiply(pq.clone().invert().multiply(dq).multiply(pq));
    }
  };
  // layered sines read as organic, never a metronome (HoloHuman's wobble)
  const wobble = (t, f) => (Math.sin(t * f) + Math.sin(t * f * 2.7 + 1.3) * 0.5 + Math.sin(t * f * 0.31 + 4.1) * 0.8) / 2.3;
  let talk = 0, attend = 0, last = 0;

  await Promise.all(textures);
  return {
    root: fbx, head: bones.head,
    /** pose: { time, speaking, listening, blink, jaw, smile, headX, headY, headZ, breath }, from the room each frame */
    set(p) {
      const t = p.time ?? performance.now() / 1000;
      const dt = Math.min(0.1, Math.max(0, t - last)); last = t;
      // ease in and out of talking / listening so gestures never snap
      talk += ((p.speaking ? 1 : 0) - talk) * Math.min(1, dt * 3);
      attend += ((p.listening ? 1 : 0) - attend) * Math.min(1, dt * 2);
      blink(p.blink); jaw(p.jaw); smile(p.smile); brows(talk * Math.max(0, Math.sin(t * 2.3)) * 0.35 + attend * 0.12);

      const breath = p.breath, sway = wobble(t, 0.13);
      // torso: breathing, a slow weight shift, leaning in a little while listening
      pose(bones.spine, [X, 0.02 + attend * 0.045 + breath * 0.006], [Z, sway * 0.018], [Y, wobble(t + 3, 0.09) * 0.02]);
      pose(bones.chest, [X, breath * 0.014 + talk * Math.sin(t * 1.9) * 0.012], [Y, talk * wobble(t, 0.7) * 0.03]);
      pose(bones.neck, [X, p.headX * 0.4], [Y, p.headY * 0.4], [Z, p.headZ * 0.4]);
      pose(bones.head, [X, p.headX * 0.6 + talk * Math.sin(t * 3.1) * 0.02], [Y, p.headY * 0.6], [Z, p.headZ * 0.6 + sway * 0.02]);

      // arms: shoulders rise with each breath; while talking the hands lift and open in turn, on the beat of speech
      for (const [side, clav, up, lo, hand, phase] of [[1, "clavicleL", "upperArmL", "lowerArmL", "handL", 0],
        [-1, "clavicleR", "upperArmR", "lowerArmR", "handR", 2.1]]) {
        const beat = Math.max(0, Math.sin(t * 1.7 + phase)), g = talk * beat * beat * (0.65 + 0.35 * wobble(t + phase, 0.8));
        const idle = wobble(t + phase * 5, 0.35);
        pose(bones[clav], [Z, side * (breath * 0.012 + g * 0.05)]);
        pose(bones[up], [X, -g * 0.22 - attend * 0.04], [Z, side * g * 0.12]);
        pose(bones[lo], [X, -g * 0.55 + idle * 0.02], [Y, side * g * 0.35]);
        pose(bones[hand], [Z, side * (g * 0.5 + idle * 0.04)], [X, -g * 0.2]);
        for (const f of fingers) if (f.name.endsWith(side > 0 ? "_l" : "_r")) f.rotation.z = f.userData.curl * (1 - g * 0.7) + idle * 0.03;
      }
    },
  };
}
