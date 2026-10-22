// Phase 1 virtual interview scene. This module is imported only for an active
// interview when VIRTUAL_INTERVIEW_3D is enabled.
import * as THREE from "../vendor/three.module.js";

const makeMaterial = (color, roughness = 0.82, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, ...extra });
const makeClayMaterial = (color, roughness) => new THREE.MeshPhysicalMaterial({
  color, roughness, metalness: 0, clearcoat: 0.1, clearcoatRoughness: 0.72,
});

export function mountVirtualOffice(host, { onFailure } = {}) {
  const width = host.clientWidth;
  const height = host.clientHeight;
  if (!width || !height) throw new Error("The interview office has no visible size.");

  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#d9e3f1");
  scene.fog = new THREE.Fog("#d9e3f1", 13, 25);

  const camera = new THREE.PerspectiveCamera(48, width / height, 0.1, 30);
  camera.position.set(0, 1.15, 2.8);
  const aimCamera = () => camera.lookAt(window.innerWidth >= 1024 ? 0.34 : window.innerWidth <= 760 ? 0.12 : 0, 1.52, 0.05);
  aimCamera();

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "low-power" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setSize(width, height, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.setAttribute("aria-hidden", "true");
  host.prepend(renderer.domElement);

  const materials = {
    wall: makeMaterial("#eef2f8"), sideWall: makeMaterial("#e4eaf3"), floor: makeMaterial("#b99f82"),
    trim: makeMaterial("#f8f9fc"), wood: makeMaterial("#735b50"), woodLight: makeMaterial("#a98168"),
    darkWood: makeMaterial("#453a43"), navy: makeMaterial("#293653"), fabric: makeMaterial("#61718d"),
    metal: makeMaterial("#9aa9bc", 0.3, { metalness: 0.58 }), glass: makeMaterial("#b5d5e9", 0.22, { metalness: 0.08 }),
    leaf: makeMaterial("#66856e"), leafLight: makeMaterial("#83a080"), pot: makeMaterial("#c18d73"),
    paper: makeMaterial("#fffdf8"), screen: makeMaterial("#27344e", 0.26), accent: makeMaterial("#5b7de0", 0.32),
    skin: makeClayMaterial("#e9b895", 0.62), hair: makeClayMaterial("#342d3b", 0.8),
    hairLight: makeClayMaterial("#3d3542", 0.82),
    blazer: makeMaterial("#45587f", 0.88), shirt: makeMaterial("#f7f4ef", 0.86),
    eyes: new THREE.MeshPhysicalMaterial({ color: "#fffdf8", roughness: 0.28, metalness: 0, clearcoat: 0.24, clearcoatRoughness: 0.3 }),
    iris: makeMaterial("#46536a", 0.4),
    mouth: makeMaterial("#573b3c", 0.58, { transparent: true, opacity: 0, depthWrite: false }),
    smile: makeMaterial("#573b3c", 0.58, { transparent: true, opacity: 1, depthWrite: false }),
  };
  const addMesh = (geometry, material, parent = scene, { position = [0, 0, 0], rotation = [0, 0, 0], cast = true, receive = true } = {}) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...position); mesh.rotation.set(...rotation);
    mesh.castShadow = cast; mesh.receiveShadow = receive;
    parent.add(mesh);
    return mesh;
  };
  const box = (size, material, position, rotation, options = {}) => addMesh(new THREE.BoxGeometry(...size), material, scene, { position, rotation, ...options });
  const cylinder = (radiusTop, radiusBottom, heightValue, material, position, radialSegments = 12) =>
    addMesh(new THREE.CylinderGeometry(radiusTop, radiusBottom, heightValue, radialSegments), material, scene, { position });
  const sphere = (radius, material, position, scale = [1, 1, 1]) => {
    const mesh = addMesh(new THREE.SphereGeometry(radius, 12, 8), material, scene, { position });
    mesh.scale.set(...scale);
    return mesh;
  };

  // A shallow room sits close behind the interviewer to keep the frame intimate.
  box([7.2, 0.16, 7.8], materials.floor, [0, -0.08, -0.05]);
  box([7.2, 4.7, 0.18], materials.wall, [0, 2.28, -2.68]);
  box([0.18, 4.7, 5.6], materials.sideWall, [-3.6, 2.28, 0.1]);
  box([0.18, 4.7, 5.6], materials.wall, [3.6, 2.28, 0.1]);
  box([7.2, 0.12, 0.18], materials.trim, [0, 0.12, -2.56]);

  // Back window with simple blue panes and slim frames (no image textures).
  box([2.35, 1.3, 0.08], materials.glass, [-1.55, 2.45, -2.55]);
  box([2.48, 0.08, 0.12], materials.trim, [-1.55, 1.77, -2.48]);
  box([2.48, 0.08, 0.12], materials.trim, [-1.55, 3.13, -2.48]);
  box([0.08, 1.44, 0.12], materials.trim, [-2.8, 2.45, -2.48]);
  box([0.08, 1.44, 0.12], materials.trim, [-0.3, 2.45, -2.48]);
  box([0.07, 1.3, 0.12], materials.trim, [-1.55, 2.45, -2.46]);
  box([2.35, 0.06, 0.12], materials.trim, [-1.55, 2.45, -2.46]);
  // A restrained skyline silhouette gives the window depth without textures.
  for (const [x, w, h] of [[-2.48, 0.3, 0.44], [-2.08, 0.42, 0.62], [-1.55, 0.35, 0.34], [-1.08, 0.48, 0.52], [-0.66, 0.25, 0.3]]) {
    box([w, h, 0.025], materials.fabric, [x, 1.82 + h / 2, -2.5], [0, 0, 0]);
  }

  // Interview desk and understated items in the foreground.
  box([4.25, 0.16, 1.05], materials.woodLight, [0, 0.9, 1.48]);
  for (const x of [-1.82, 1.82]) for (const z of [1.08, 1.86]) {
    box([0.12, 0.82, 0.12], materials.darkWood, [x, 0.42, z]);
  }
  // Laptop facing the interviewer, with a readable, muted blue screen.
  box([0.56, 0.045, 0.38], materials.metal, [-1.15, 1.015, 1.22], [-0.06, 0, 0]);
  box([0.56, 0.3, 0.045], materials.darkWood, [-1.15, 1.2, 1.03], [-0.18, 0, 0]);
  box([0.48, 0.23, 0.018], materials.screen, [-1.15, 1.21, 1.0], [-0.18, 0, 0], { cast: false });
  // A visible résumé page sits near the participant's side of the desktop.
  box([0.66, 0.025, 0.42], materials.paper, [1.18, 1.0, 1.72], [0, 0.05, -0.07], { cast: false });
  box([0.46, 0.008, 0.018], materials.fabric, [1.18, 1.016, 1.62], [0, 0.05, -0.07], { cast: false });
  box([0.48, 0.008, 0.014], materials.metal, [1.18, 1.016, 1.68], [0, 0.05, -0.07], { cast: false });
  box([0.4, 0.008, 0.014], materials.metal, [1.18, 1.016, 1.74], [0, 0.05, -0.07], { cast: false });
  cylinder(0.07, 0.07, 0.025, materials.accent, [1.45, 1.0, 1.36]);

  // HR chair sits directly across the desk.
  const chair = (x, z, scale = 1) => {
    const group = new THREE.Group(); group.position.set(x, 0, z); group.scale.setScalar(scale); scene.add(group);
    const childBox = (size, material, position, rotation = [0, 0, 0]) => addMesh(new THREE.BoxGeometry(...size), material, group, { position, rotation });
    childBox([0.9, 0.16, 0.82], materials.fabric, [0, 0.95, 0.05]);
    childBox([0.9, 1.0, 0.16], materials.navy, [0, 1.48, -0.32], [-0.08, 0, 0]);
    cylinder(0.045, 0.045, 0.7, materials.metal, [0, 0.53, 0.02]);
    cylinder(0.06, 0.34, 0.1, materials.metal, [0, 0.18, 0.02]);
    for (let i = 0; i < 5; i++) {
      const a = i * Math.PI * 2 / 5;
      const leg = addMesh(new THREE.BoxGeometry(0.48, 0.065, 0.09), materials.metal, group,
        { position: [Math.sin(a) * 0.22, 0.08, Math.cos(a) * 0.22], rotation: [0, a, 0] });
      leg.castShadow = false;
    }
    return group;
  };
  chair(0, 0.22, 0.82);

  // Project-owned seated HR avatar, built from lightweight Three.js geometry.
  // No external character asset or asset license is required.
  const person = new THREE.Group(); person.position.set(0, -0.25, 0.22); scene.add(person);
  const ellipsoid = (material, scale, position, parent = person) => {
    const mesh = addMesh(new THREE.SphereGeometry(1, 20, 14), material, parent, { position });
    mesh.scale.set(...scale); return mesh;
  };
  const taperedFaceGeometry = () => {
    const geometry = new THREE.SphereGeometry(1, 32, 24);
    const positions = geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      const y = positions.getY(i);
      const jaw = THREE.MathUtils.clamp((0.12 - y) / 0.78, 0, 1);
      positions.setX(i, positions.getX(i) * (1 - jaw * 0.16));
      positions.setZ(i, positions.getZ(i) * (1 - jaw * 0.08));
    }
    positions.needsUpdate = true;
    geometry.computeVertexNormals();
    return geometry;
  };
  const roundedFrameGeometry = (width, height, radius, innerWidth, innerHeight, innerRadius) => {
    const traceRoundRect = (path, w, h, r, reverse = false) => {
      const x = w / 2, y = h / 2;
      if (!reverse) {
        path.moveTo(-x + r, -y); path.lineTo(x - r, -y); path.quadraticCurveTo(x, -y, x, -y + r);
        path.lineTo(x, y - r); path.quadraticCurveTo(x, y, x - r, y); path.lineTo(-x + r, y);
        path.quadraticCurveTo(-x, y, -x, y - r); path.lineTo(-x, -y + r); path.quadraticCurveTo(-x, -y, -x + r, -y);
      } else {
        path.moveTo(-x + r, -y); path.quadraticCurveTo(-x, -y, -x, -y + r);
        path.lineTo(-x, y - r); path.quadraticCurveTo(-x, y, -x + r, y); path.lineTo(x - r, y);
        path.quadraticCurveTo(x, y, x, y - r); path.lineTo(x, -y + r); path.quadraticCurveTo(x, -y, x - r, -y);
        path.lineTo(-x + r, -y);
      }
    };
    const shape = new THREE.Shape();
    traceRoundRect(shape, width, height, radius);
    const opening = new THREE.Path();
    traceRoundRect(opening, innerWidth, innerHeight, innerRadius, true);
    shape.holes.push(opening);
    return new THREE.ExtrudeGeometry(shape, {
      depth: 0.012, bevelEnabled: true, bevelSegments: 2, steps: 1,
      bevelSize: 0.002, bevelThickness: 0.002, curveSegments: 8,
    });
  };
  const torso = new THREE.Group(); torso.position.set(0, 1.1, 0); person.add(torso);
  ellipsoid(materials.blazer, [0.68, 0.42, 0.31], [0, 0.28, 0.02], torso);
  ellipsoid(materials.blazer, [0.43, 0.62, 0.3], [0, -0.05, 0.02], torso);
  ellipsoid(materials.shirt, [0.21, 0.39, 0.035], [0, 0.2, 0.302], torso);
  ellipsoid(materials.accent, [0.055, 0.23, 0.035], [0, 0.12, 0.345], torso);
  ellipsoid(materials.shirt, [0.105, 0.105, 0.055], [-0.105, 0.43, 0.27], torso);
  ellipsoid(materials.shirt, [0.105, 0.105, 0.055], [0.105, 0.43, 0.27], torso);
  // Layered lapels add a clearer professional silhouette while reusing the existing palette.
  const lapel = (side) => {
    const shape = new THREE.Shape();
    shape.moveTo(0, 0.44); shape.lineTo(side * 0.2, 0.42); shape.lineTo(side * 0.07, 0.04);
    shape.lineTo(side * 0.015, 0.17); shape.closePath();
    const mesh = addMesh(new THREE.ExtrudeGeometry(shape, { depth: 0.018, bevelEnabled: true, bevelSegments: 2, bevelSize: 0.008, bevelThickness: 0.006 }),
      materials.blazer, torso, { position: [0, 0, 0.325] });
    mesh.castShadow = false;
  };
  lapel(-1); lapel(1);
  cylinder(0.085, 0.085, 0.2, materials.skin, [0, 1.66, 0.13], 16);

  // Bent sleeves and hands rest near the far edge of the desk.
  const arms = [];
  for (const side of [-1, 1]) {
    const shoulder = new THREE.Group(); shoulder.position.set(side * 0.52, 1.38, 0.05); person.add(shoulder);
    ellipsoid(materials.blazer, [0.17, 0.29, 0.18], [side * 0.02, -0.13, 0.08], shoulder);
    const forearm = new THREE.Group(); forearm.position.set(side * 0.015, -0.31, 0.19); shoulder.add(forearm);
    ellipsoid(materials.blazer, [0.145, 0.15, 0.25], [0, -0.025, 0.17], forearm);
    ellipsoid(materials.shirt, [0.115, 0.11, 0.055], [0, -0.035, 0.36], forearm);
    ellipsoid(materials.skin, [0.12, 0.07, 0.15], [0, -0.055, 0.46], forearm);
    arms.push({ shoulder, forearm, side });
  }

  const head = new THREE.Group(); head.position.set(0, 1.9, 0.14); person.add(head);
  // The rear hair volume stays behind the face; overlapping locks replace the helmet-like cap.
  ellipsoid(materials.hair, [0.31, 0.37, 0.235], [0, -0.005, 0], head);
  const face = addMesh(taperedFaceGeometry(), materials.skin, head, { position: [0, 0.01, 0.18] });
  face.scale.set(0.265, 0.32, 0.205);
  const crownLocks = [
    [-0.21, 0.205, 0.095, 0.105], [-0.105, 0.255, 0.11, 0.115],
    [0.015, 0.268, 0.112, 0.118], [0.13, 0.24, 0.11, 0.112], [0.225, 0.18, 0.09, 0.105],
  ];
  crownLocks.forEach(([x, y, width, height], index) => {
    const lock = ellipsoid(index === 1 || index === 3 ? materials.hairLight : materials.hair,
      [width, height, 0.125], [x, y, 0.095], head);
    lock.rotation.z = (index - 2) * -0.1;
  });
  for (const side of [-1, 1]) {
    const sideLock = ellipsoid(materials.hair, [0.075, 0.22, 0.13], [side * 0.245, -0.035, 0.075], head);
    sideLock.rotation.z = side * -0.1;
    ellipsoid(materials.skin, [0.052, 0.075, 0.042], [side * 0.251, -0.015, 0.17], head);
    ellipsoid(materials.skin, [0.018, 0.034, 0.012], [side * 0.269, -0.015, 0.205], head);
  }
  const eyes = [];
  for (const x of [-0.09, 0.09]) {
    const eye = new THREE.Group(); eye.position.set(x, 0.05, 0.365); head.add(eye);
    ellipsoid(materials.eyes, [0.041, 0.044, 0.022], [0, 0, 0], eye);
    ellipsoid(materials.iris, [0.018, 0.022, 0.014], [0, -0.002, 0.019], eye);
    ellipsoid(materials.eyes, [0.007, 0.01, 0.006], [-0.006, 0.006, 0.03], eye);
    const upperLid = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.041, 0.006, 0.015), new THREE.Vector3(-0.03, 0.034, 0.021),
      new THREE.Vector3(0, 0.044, 0.024), new THREE.Vector3(0.03, 0.034, 0.021),
      new THREE.Vector3(0.041, 0.006, 0.015),
    ]);
    const lowerLid = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.039, -0.006, 0.016), new THREE.Vector3(-0.026, -0.032, 0.022),
      new THREE.Vector3(0, -0.04, 0.024), new THREE.Vector3(0.026, -0.032, 0.022),
      new THREE.Vector3(0.039, -0.006, 0.016),
    ]);
    addMesh(new THREE.TubeGeometry(upperLid, 12, 0.006, 6, false), materials.skin, eye);
    addMesh(new THREE.TubeGeometry(lowerLid, 12, 0.004, 6, false), materials.skin, eye);
    eyes.push(eye);
  }
  // Soft brows stay separate from the blinking eye groups so their proportions remain steady.
  const brows = [];
  for (const x of [-0.09, 0.09]) {
    const brow = ellipsoid(materials.hair, [0.047, 0.011, 0.014], [x, 0.112, 0.366], head);
    const side = x < 0 ? -1 : 1;
    brow.rotation.z = side * 0.08;
    brows.push({ mesh: brow, side });
  }
  ellipsoid(materials.skin, [0.026, 0.064, 0.028], [0, -0.005, 0.372], head);
  ellipsoid(materials.skin, [0.038, 0.045, 0.041], [0, -0.064, 0.392], head);
  const mouth = ellipsoid(materials.mouth, [0.069, 0.014, 0.014], [0, -0.145, 0.37], head);
  mouth.scale.y = 0.001;
  const smile = addMesh(new THREE.TorusGeometry(0.069, 0.009, 8, 24, Math.PI), materials.smile, head,
    { position: [0, -0.14, 0.369], rotation: [0, 0, Math.PI] });

  // Rounded, softly beveled frames borrow the reference's defining glasses silhouette.
  for (const x of [-0.09, 0.09]) {
    addMesh(roundedFrameGeometry(0.16, 0.145, 0.046, 0.124, 0.108, 0.034), materials.darkWood, head,
      { position: [x, 0.05, 0.382] });
  }
  const glassesBridge = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.015, 0.05, 0.389), new THREE.Vector3(0, 0.035, 0.405), new THREE.Vector3(0.015, 0.05, 0.389),
  ]);
  addMesh(new THREE.TubeGeometry(glassesBridge, 10, 0.012, 8, false), materials.darkWood, head);
  for (const side of [-1, 1]) {
    const temple = new THREE.CatmullRomCurve3([
      new THREE.Vector3(side * 0.166, 0.07, 0.378), new THREE.Vector3(side * 0.215, 0.065, 0.34), new THREE.Vector3(side * 0.245, 0.04, 0.28),
    ]);
    addMesh(new THREE.TubeGeometry(temple, 10, 0.009, 6, false), materials.darkWood, head);
  }

  let avatarState = "idle";
  let microphoneLevel = 0;
  let speechCue = null;
  const setAvatarState = (next) => {
    if (!["idle", "listening", "speaking"].includes(next) || next === avatarState) return;
    avatarState = next;
    host.dataset.avatarState = next;
  };
  host.dataset.avatarState = avatarState;
  const avatarStateEvent = (event) => {
    const detail = event.detail || {};
    setAvatarState(detail.state);
    microphoneLevel = Number.isFinite(detail.microphoneLevel) ? THREE.MathUtils.clamp(detail.microphoneLevel, 0, 1) : 0;
    speechCue = detail.state === "speaking" ? detail.speechCue || null : null;
  };
  window.addEventListener("aiversepulse:interview-avatar-state", avatarStateEvent);
  let blinkStartedAt = -10;
  let nextBlinkAt = 1.7;
  const blinkAmount = (time) => {
    if (time >= nextBlinkAt) {
      blinkStartedAt = time;
      nextBlinkAt = time + 3.2 + (Math.sin(time * 1.31) + 1) * 0.9;
    }
    const phase = (time - blinkStartedAt) / 0.16;
    return phase >= 0 && phase <= 1 ? Math.sin(phase * Math.PI) : 0;
  };
  let previousFrameTime = 0;
  const animateAvatar = (timeMs) => {
    const time = timeMs / 1000;
    const delta = previousFrameTime ? Math.min(0.05, Math.max(0.001, time - previousFrameTime)) : 1 / 60;
    previousFrameTime = time;
    const ease = (value, target, speed) => THREE.MathUtils.damp(value, target, speed, delta);
    const listening = avatarState === "listening", speaking = avatarState === "speaking";
    const quiet = 1 - THREE.MathUtils.smoothstep(microphoneLevel, 0.01, 0.04);
    const thoughtPhase = time % 8.4;
    const thoughtPulse = thoughtPhase > 6.5 ? Math.sin((thoughtPhase - 6.5) / 1.9 * Math.PI) : 0;
    const thinking = listening ? thoughtPulse * quiet : 0;
    const nod = listening && time % 4.8 > 0.25 && time % 4.8 < 0.58
      ? Math.sin((time % 4.8 - 0.25) / 0.33 * Math.PI) * 0.045 : 0;
    torso.scale.y = 1 + Math.sin(time * 1.3) * 0.007 + (listening ? microphoneLevel * 0.012 : 0);
    head.rotation.x = ease(head.rotation.x, (listening ? -0.035 : 0) + nod + thinking * 0.026
      + (speaking ? Math.sin(time * 3.2) * 0.014 : 0), 5);
    head.rotation.y = ease(head.rotation.y, Math.sin(time * (speaking ? 1.8 : 0.55)) * (listening ? 0.018 : 0.024)
      + (listening ? microphoneLevel * 0.075 : 0) + thinking * 0.03, 3);
    head.rotation.z = ease(head.rotation.z, (listening ? -0.018 : 0) + thinking * 0.04, 4);
    head.position.y = 1.9 + Math.sin(time * 1.3) * 0.006;
    let speechOpen = 0.018;
    if (speaking && speechCue?.word) {
      const word = String(speechCue.word);
      const secondsPerCharacter = Number.isFinite(speechCue.secondsPerCharacter) ? speechCue.secondsPerCharacter : 0.1;
      const elapsed = Math.max(0, (performance.now() - speechCue.startedAt) / 1000);
      const characterIndex = Math.floor(elapsed / secondsPerCharacter);
      const character = word[Math.min(characterIndex, word.length - 1)]?.toLowerCase() || "";
      if (characterIndex < word.length) {
        // SpeechSynthesis word-boundary cues drive simple vowel/consonant jaw shapes.
        speechOpen = /[aeo]/.test(character) ? 0.064
          : /[iu]/.test(character) ? 0.043
            : /[mnbp]/.test(character) ? 0.014 : 0.027;
        speechOpen += Math.sin(time * 18 + characterIndex) * 0.004;
      }
    } else if (listening) speechOpen = 0.022 + microphoneLevel * 0.006;
    mouth.scale.y = ease(mouth.scale.y, speaking ? speechOpen : 0.001, speaking ? 18 : 9);
    materials.mouth.opacity = ease(materials.mouth.opacity, speaking ? 0.96 : 0, 13);
    materials.smile.opacity = ease(materials.smile.opacity, speaking ? 0 : 1, 11);
    const blink = blinkAmount(time);
    eyes.forEach((eye, index) => {
      eye.scale.y = 1 - blink * (index === 0 ? 0.95 : 0.93);
      eye.rotation.x = ease(eye.rotation.x, -thinking * 0.055, 5);
    });
    brows.forEach(({ mesh, side }) => {
      mesh.position.y = ease(mesh.position.y, 0.112 + thinking * 0.009, 6);
      mesh.rotation.z = ease(mesh.rotation.z, side * (0.08 + thinking * 0.045), 6);
    });
    arms.forEach(({ shoulder, forearm, side }) => {
      const gesture = speaking ? Math.max(0, Math.sin(time * 1.9 + (side > 0 ? 0 : Math.PI))) * 0.045 : 0;
      shoulder.rotation.z = ease(shoulder.rotation.z, side * gesture + (listening ? Math.sin(time * 1.1 + side) * 0.006 : 0), 4);
      forearm.rotation.x = ease(forearm.rotation.x, speaking ? Math.sin(time * 1.9) * 0.025
        : listening ? Math.sin(time * 0.85 + side) * 0.008 : 0, 4);
    });
  };

  // Plant at the left rear corner adds a small natural accent.
  cylinder(0.23, 0.29, 0.4, materials.pot, [-2.75, 0.2, -1.45], 10);
  for (let i = 0; i < 7; i++) {
    const angle = i * Math.PI * 2 / 7;
    const x = -2.75 + Math.cos(angle) * 0.23;
    const z = -1.45 + Math.sin(angle) * 0.21;
    const leaf = addMesh(new THREE.ConeGeometry(0.16, 1.05 + (i % 3) * 0.12, 7), i % 2 ? materials.leaf : materials.leafLight,
      scene, { position: [x, 0.82, z], rotation: [Math.sin(angle) * 0.22, angle, Math.cos(angle) * 0.22] });
    leaf.castShadow = true;
  }
  cylinder(0.035, 0.05, 0.76, materials.leaf, [-2.75, 0.72, -1.45], 8);

  // Floating shelves and a simple framed brand-color print on the right wall.
  box([1.25, 0.1, 0.36], materials.wood, [2.5, 2.55, -1.72]);
  box([1.25, 0.1, 0.36], materials.wood, [2.5, 1.9, -1.72]);
  box([0.72, 0.07, 0.3], materials.woodLight, [2.45, 2.9, -1.7]);
  box([0.72, 0.58, 0.08], materials.trim, [2.55, 2.45, -2.52]);
  box([0.56, 0.4, 0.035], materials.accent, [2.55, 2.45, -2.46]);
  sphere(0.1, materials.paper, [2.55, 2.45, -2.42], [1.35, 1, 0.18]);

  const hemisphere = new THREE.HemisphereLight("#fbfdff", "#8f806f", 1.85);
  scene.add(hemisphere);
  const key = new THREE.DirectionalLight("#fff2df", 1.65);
  key.position.set(-3.8, 7.2, 4.5); key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -7; key.shadow.camera.right = 7;
  key.shadow.camera.top = 7; key.shadow.camera.bottom = -5;
  key.shadow.bias = -0.00035; key.shadow.radius = 4;
  scene.add(key);
  const fill = new THREE.DirectionalLight("#e6edff", 0.65);
  fill.position.set(4.5, 4.2, 2.8); scene.add(fill);
  // A low-power warm bounce light keeps the face readable without changing the office setup.
  const faceBounce = new THREE.PointLight("#ffe5cf", 0.38, 3.8, 2);
  faceBounce.position.set(0.15, 2.3, 1.15); scene.add(faceBounce);

  let disposed = false;
  let resizeObserver;
  let resizeListener;
  let lastAnimationFrame = 0;
  const draw = () => {
    if (disposed) return;
    const w = host.clientWidth, h = host.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; aimCamera(); camera.updateProjectionMatrix();
    renderer.render(scene, camera);
    host.dataset.ready = "true";
  };
  const unmount = () => {
    if (disposed) return;
    disposed = true; resizeObserver?.disconnect();
    renderer.setAnimationLoop(null);
    window.removeEventListener("aiversepulse:interview-avatar-state", avatarStateEvent);
    if (resizeListener) window.removeEventListener("resize", resizeListener);
    renderer.domElement.removeEventListener("webglcontextlost", contextLost);
    scene.traverse((node) => {
      if (!node.isMesh) return;
      node.geometry.dispose();
    });
    for (const material of Object.values(materials)) material.dispose();
    renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
    delete host.dataset.ready;
  };
  const contextLost = (event) => {
    event.preventDefault();
    if (disposed) return;
    onFailure?.(new Error("The browser lost the 3D graphics context."));
    unmount();
  };
  renderer.domElement.addEventListener("webglcontextlost", contextLost);
  renderer.setAnimationLoop((time) => {
    if (disposed) return;
    if (time - lastAnimationFrame < 1000 / 30) return;
    lastAnimationFrame = time;
    animateAvatar(time);
    renderer.render(scene, camera);
    host.dataset.ready = "true";
  });
  if (window.ResizeObserver) {
    resizeObserver = new ResizeObserver(draw);
    resizeObserver.observe(host);
  } else {
    resizeListener = draw;
    window.addEventListener("resize", resizeListener);
  }
  draw();
  return unmount;
}
