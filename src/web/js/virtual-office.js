// Phase 1 virtual interview scene. This module is imported only for an active
// interview when VIRTUAL_INTERVIEW_3D is enabled.
import * as THREE from "../vendor/three.module.js";

const makeMaterial = (color, roughness = 0.82, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, ...extra });

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
    skin: makeMaterial("#e9b895"), hair: makeMaterial("#342d3b"), blazer: makeMaterial("#45587f"), shirt: makeMaterial("#f7f4ef"),
    eyes: makeMaterial("#fffdf8"), iris: makeMaterial("#46536a"), mouth: makeMaterial("#573b3c"),
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
  const torso = new THREE.Group(); torso.position.set(0, 1.1, 0); person.add(torso);
  ellipsoid(materials.blazer, [0.68, 0.42, 0.31], [0, 0.28, 0.02], torso);
  ellipsoid(materials.blazer, [0.43, 0.62, 0.3], [0, -0.05, 0.02], torso);
  ellipsoid(materials.shirt, [0.21, 0.39, 0.035], [0, 0.2, 0.302], torso);
  ellipsoid(materials.accent, [0.055, 0.23, 0.035], [0, 0.12, 0.345], torso);
  ellipsoid(materials.shirt, [0.11, 0.09, 0.045], [-0.11, 0.43, 0.26], torso);
  ellipsoid(materials.shirt, [0.11, 0.09, 0.045], [0.11, 0.43, 0.26], torso);
  cylinder(0.095, 0.095, 0.22, materials.skin, [0, 1.66, 0.13], 16);

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
  ellipsoid(materials.hair, [0.31, 0.38, 0.24], [0, 0, 0], head);
  ellipsoid(materials.skin, [0.265, 0.32, 0.205], [0, 0.01, 0.18], head);
  ellipsoid(materials.hair, [0.29, 0.17, 0.23], [0, 0.22, 0.08], head);
  ellipsoid(materials.hair, [0.075, 0.25, 0.11], [-0.245, 0.03, 0.06], head);
  ellipsoid(materials.hair, [0.075, 0.25, 0.11], [0.245, 0.03, 0.06], head);
  const eyes = [];
  for (const x of [-0.09, 0.09]) {
    const eye = new THREE.Group(); eye.position.set(x, 0.05, 0.365); head.add(eye);
    ellipsoid(materials.eyes, [0.045, 0.052, 0.021], [0, 0, 0], eye);
    ellipsoid(materials.iris, [0.019, 0.025, 0.013], [0, -0.002, 0.019], eye);
    ellipsoid(materials.eyes, [0.007, 0.01, 0.006], [0, -0.002, 0.03], eye);
    ellipsoid(materials.hair, [0.047, 0.012, 0.017], [0, 0.067, 0.005], eye);
    eyes.push(eye);
  }
  ellipsoid(materials.skin, [0.028, 0.045, 0.025], [0, -0.03, 0.365], head);
  const mouth = ellipsoid(materials.mouth, [0.073, 0.018, 0.014], [0, -0.115, 0.365], head);
  mouth.visible = false;
  const smile = addMesh(new THREE.TorusGeometry(0.075, 0.01, 6, 16, Math.PI), materials.mouth, head,
    { position: [0, -0.115, 0.36], rotation: [0, 0, Math.PI] });

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
  const blinkAmount = (time, offset = 0) => {
    const phase = (time + offset) % 4.1;
    return phase < 0.12 ? Math.sin(phase / 0.12 * Math.PI) : 0;
  };
  let previousFrameTime = 0;
  const animateAvatar = (timeMs) => {
    const time = timeMs / 1000;
    const delta = previousFrameTime ? Math.min(0.05, Math.max(0.001, time - previousFrameTime)) : 1 / 60;
    previousFrameTime = time;
    const ease = (value, target, speed) => THREE.MathUtils.damp(value, target, speed, delta);
    const listening = avatarState === "listening", speaking = avatarState === "speaking";
    mouth.visible = speaking; smile.visible = !speaking;
    const nod = listening && time % 4.8 > 0.25 && time % 4.8 < 0.58
      ? Math.sin((time % 4.8 - 0.25) / 0.33 * Math.PI) * 0.045 : 0;
    torso.scale.y = 1 + Math.sin(time * 1.3) * 0.007 + (listening ? microphoneLevel * 0.012 : 0);
    head.rotation.x = ease(head.rotation.x, (listening ? -0.035 : 0) + nod + (speaking ? Math.sin(time * 3.2) * 0.014 : 0), 5);
    head.rotation.y = ease(head.rotation.y, Math.sin(time * (speaking ? 1.8 : 0.55)) * (listening ? 0.018 : 0.024)
      + (listening ? microphoneLevel * 0.075 : 0), 3);
    head.rotation.z = ease(head.rotation.z, listening ? -0.025 : 0, 4);
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
    mouth.scale.y = ease(mouth.scale.y, speechOpen, speaking ? 18 : 7);
    eyes.forEach((eye, index) => {
      const blink = Math.max(blinkAmount(time), blinkAmount(time, index * 0.035));
      eye.scale.y = 1 - blink * 0.94;
    });
    arms.forEach(({ shoulder, forearm, side }) => {
      const gesture = speaking ? Math.max(0, Math.sin(time * 1.9 + (side > 0 ? 0 : Math.PI))) * 0.045 : 0;
      shoulder.rotation.z = ease(shoulder.rotation.z, side * gesture, 4);
      forearm.rotation.x = ease(forearm.rotation.x, speaking ? Math.sin(time * 1.9) * 0.025 : 0, 4);
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

  const hemisphere = new THREE.HemisphereLight("#fbfdff", "#8f806f", 2.45);
  scene.add(hemisphere);
  const key = new THREE.DirectionalLight("#fff5e7", 1.25);
  key.position.set(-3.8, 7.2, 4.5); key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -7; key.shadow.camera.right = 7;
  key.shadow.camera.top = 7; key.shadow.camera.bottom = -5;
  key.shadow.bias = -0.00035; key.shadow.radius = 4;
  scene.add(key);
  const fill = new THREE.DirectionalLight("#e6edff", 0.75);
  fill.position.set(4.5, 4.2, 2.8); scene.add(fill);

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
