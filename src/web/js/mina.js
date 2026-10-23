// Mina, the interviewer: the KPOP_Mina character from HoloHuman (OLGTX303/human-multiplatform, holohuman/web/src/
// mina.js), cut down to what a seated interviewer needs: the casual outfit, her own skin, hair, lashes, eyes and
// teeth (textures shrunk for the web), arms posed onto the desk, and her ARKit face morphs for blinks, a smile and
// the jaw while speaking. No animation clips, hair or skirt physics.
import * as THREE from "../vendor/three.module.js";
import { FBXLoader } from "../vendor/addons/loaders/FBXLoader.js";

const DIR = "models/mina/";

/** Loads Mina; resolves to { root, head, set(pose) } once the FBX is in. Textures stream in after. */
export async function loadMina({ envMap, height = 1.6 } = {}) {
  const loader = new THREE.TextureLoader();
  const T = (file, srgb = true, flipY = true) => {
    const t = loader.load(DIR + file);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.flipY = flipY; t.anisotropy = 4;
    return t;
  };
  const mk = (name, opts) => new THREE.MeshPhysicalMaterial({ name, roughness: 0.55, metalness: 0, ior: 1.45,
    envMap, envMapIntensity: 0.55, ...opts });
  // the same surfaces as HoloHuman's materialFor(), with fewer maps
  const materialFor = (name, old) => {
    const n = name.toUpperCase();
    if (n.includes("HAIR")) return mk(name, { map: T("hair.png"), color: 0x2a221f, transparent: true, opacity: 0.98,
      alphaTest: 0.1, depthWrite: false, side: THREE.DoubleSide, roughness: 0.66, envMapIntensity: 0.35 });
    if (n.includes("LASH")) return mk(name, { map: T("lashes.png"), transparent: true, alphaTest: 0.3, side: THREE.DoubleSide, roughness: 0.9 });
    if (n.includes("EYE")) return mk(name, { map: T("eyes.jpg"), emissiveMap: T("eyes-glint.jpg"), emissive: 0xffffff,
      emissiveIntensity: 0.18, roughness: 0.02, ior: 1.38, clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 1.6 });
    if (n.includes("TEETH") || n.includes("TOOTH")) return mk(name, { map: T("teeth.jpg"), roughness: 0.18, clearcoat: 0.6, clearcoatRoughness: 0.2 });
    if (n.includes("CASUAL")) return mk(name, { map: T("outfit.jpg", true, false), roughness: 0.5, sheen: 0.22,
      sheenRoughness: 0.35, sheenColor: 0xffe0d4, envMapIntensity: 0.8, side: THREE.DoubleSide });
    if (n.includes("HEAD") || n.includes("FACE")) return mk(name, { map: T("head.jpg"), normalMap: T("head-normal.jpg", false),
      roughness: 0.42, ior: 1.4, sheen: 0.18, sheenRoughness: 0.55, sheenColor: 0xffd9c8, clearcoat: 0.22, clearcoatRoughness: 0.42, envMapIntensity: 0.72 });
    if (n.includes("BODY")) return mk(name, { map: T("body.jpg"), roughness: 0.6, ior: 1.4, sheen: 0.18, sheenRoughness: 0.55,
      sheenColor: 0xffd9c8, clearcoat: 0.18, clearcoatRoughness: 0.45, envMapIntensity: 0.68 });
    if (n.includes("TEAR") || n.includes("CENSOR")) return null;
    return old;
  };

  const fbx = await new FBXLoader().loadAsync(DIR + "mina.fbx");
  const morphMeshes = [], seen = new Set();
  fbx.traverse((o) => {
    if (!o.isMesh) return;
    if (seen.has(o.name)) { o.visible = false; return; }  // stacked LOD copies share a name: keep LOD0
    seen.add(o.name);
    o.frustumCulled = false;
    o.castShadow = !/HAIR|TEAR|CENSOR|LASH|EYE/i.test(o.name); o.receiveShadow = true;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const mapped = mats.map((m) => materialFor(m?.name || o.name, m) ?? new THREE.MeshBasicMaterial({ visible: false }));
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
  for (const b of fingers) b.rotation.z += b.name.startsWith("thumb") ? 0.08 : 0.18;  // relaxed fingers
  for (const b of Object.values(bones)) b.userData.rest = b.rotation.clone();

  const morph = (re) => {
    const targets = [];
    for (const m of morphMeshes) for (const [name, i] of Object.entries(m.morphTargetDictionary)) if (re.test(name)) targets.push([m, i]);
    return (value) => targets.forEach(([m, i]) => { m.morphTargetInfluences[i] = value; });
  };
  const blink = morph(/eyeBlink/i), jaw = morph(/jawOpen/i), smile = morph(/mouthSmile(Left|Right)/i);
  const turn = (bone, x, y, z) => { if (bone) bone.rotation.set(bone.userData.rest.x + x, bone.userData.rest.y + y, bone.userData.rest.z + z); };

  return {
    root: fbx, head: bones.head,
    /** pose: { blink, jaw, smile, headX, headY, headZ, breath } — the room's own avatar drives these each frame */
    set(p) {
      blink(p.blink); jaw(p.jaw); smile(p.smile);
      turn(bones.head, p.headX * 0.6, p.headY * 0.6, p.headZ * 0.6);
      turn(bones.neck, p.headX * 0.4, p.headY * 0.4, p.headZ * 0.4);
      turn(bones.chest, p.breath * 0.012, 0, 0);
    },
  };
}
