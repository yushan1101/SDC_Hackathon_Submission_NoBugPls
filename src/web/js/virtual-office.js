// The virtual interview office, with Mina (js/mina.js) as the interviewer. Imported only when VIRTUAL_INTERVIEW_3D is
// enabled: by the live interview room and by the interview landing pages.
import * as THREE from "../vendor/three.module.js";
import { reduceMotion } from "./lib.js";

const makeMaterial = (color, roughness = 0.82, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, ...extra });

// aimX(width): where the camera looks across the desk; the room leaves its left side to the question overlay,
// the landing stage (interview.js) leaves its left side to the page heading.
const ROOM_AIM = (w) => (w >= 1024 ? 0.34 : w <= 760 ? 0.12 : 0);

// The room only shows (host[data-ready]) once Mina is seated, so nothing else ever appears in her chair; if she
// can't load, onFailure lets the caller fall back to its plain layout.
export function mountVirtualOffice(host, { onFailure, aimX = ROOM_AIM } = {}) {
  const width = host.clientWidth;
  const height = host.clientHeight;
  if (!width || !height) throw new Error("The interview office has no visible size.");

  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#d9e3f1");
  scene.fog = new THREE.Fog("#d9e3f1", 13, 25);

  const camera = new THREE.PerspectiveCamera(48, width / height, 0.1, 30);
  camera.position.set(0, 1.15, 2.8);
  const aimCamera = () => camera.lookAt(aimX(host.clientWidth), 1.52, 0.05);
  aimCamera();

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "low-power" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setSize(width, height, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // As in HoloHuman: filmic tone mapping, and a soft studio reflection that only Mina's materials pick up.
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.3;
  const studio = (() => {
    const room = new THREE.Scene();
    room.add(new THREE.Mesh(new THREE.BoxGeometry(10, 6, 10), new THREE.MeshBasicMaterial({ color: "#6f6862", side: THREE.BackSide })));
    for (const [x, y, z, size] of [[0, 2.5, 4, 3], [-4, 1, 1, 2], [4, 1.5, 0, 1.5]]) {  // key softbox in front, two side cards
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({ color: "#ffffff" }));
      panel.position.set(x, y, z); panel.lookAt(0, 0, 0); room.add(panel);
    }
    const pmrem = new THREE.PMREMGenerator(renderer);
    const texture = pmrem.fromScene(room, 0.04).texture;
    pmrem.dispose(); room.traverse((node) => { if (node.isMesh) { node.geometry.dispose(); node.material.dispose(); } });
    return texture;
  })();
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

  // Mina sits in the chair across the desk; the desk hides everything below her waist. 2.45 is the office's scale.
  let mina = null;
  import("./mina.js").then(({ loadMina }) => loadMina({ envMap: studio, height: 2.45 })).then((m) => {
    if (disposed) return;
    m.root.updateMatrixWorld(true);
    m.root.position.add(new THREE.Vector3(0, 1.65, 0.34).sub(m.head.getWorldPosition(new THREE.Vector3())));
    scene.add(m.root); mina = m;
    if (still) drawStill(); else draw();
  }).catch((error) => {
    if (disposed) return;
    onFailure?.(error instanceof Error ? error : new Error("The interviewer could not load."));
    unmount();
  });

  const still = reduceMotion();
  let avatarState = "idle";
  let microphoneLevel = 0;
  let speechCue = null;
  const setAvatarState = (next) => {
    if (!["idle", "listening", "speaking"].includes(next) || next === avatarState) return;
    avatarState = next;
    host.dataset.avatarState = next;
    if (still) drawStill();
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
      // about one blink in five is a quick double blink, as people do
      nextBlinkAt = time + (Math.sin(time * 7.3) > 0.6 ? 0.3 : 2.4 + (Math.sin(time * 1.31) + 1) * 1.3);
    }
    const phase = (time - blinkStartedAt) / 0.16;
    return phase >= 0 && phase <= 1 ? Math.sin(phase * Math.PI) : 0;
  };
  // Mina's head eases toward these each frame: nods while listening, small turns while speaking, drift when idle.
  const look = { x: 0, y: 0, z: 0 };
  let previousFrameTime = 0;
  const animateAvatar = (timeMs) => {
    if (!mina) return;
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
    // layered sines read as organic drift rather than a metronome (after HoloHuman's behaviour.js)
    const drift = (Math.sin(time * 0.55) + Math.sin(time * 1.49 + 1.3) * 0.5 + Math.sin(time * 0.17 + 4.1) * 0.8) / 2.3;
    look.x = ease(look.x, (listening ? -0.035 : 0) + nod + thinking * 0.026 + (speaking ? Math.sin(time * 3.2) * 0.014 : 0), 5);
    look.y = ease(look.y, (speaking ? Math.sin(time * 1.8) : drift) * (listening ? 0.018 : 0.03)
      + (listening ? microphoneLevel * 0.075 : 0) + thinking * 0.03, 3);
    look.z = ease(look.z, (listening ? -0.018 : 0) + thinking * 0.04, 4);
    // SpeechSynthesis word-boundary cues open the jaw by letter: vowels wide, m/n/b/p nearly closed.
    let jaw = 0;
    if (speaking && speechCue?.word) {
      const word = String(speechCue.word);
      const secondsPerCharacter = Number.isFinite(speechCue.secondsPerCharacter) ? speechCue.secondsPerCharacter : 0.1;
      const index = Math.floor(Math.max(0, (performance.now() - speechCue.startedAt) / 1000) / secondsPerCharacter);
      const character = word[Math.min(index, word.length - 1)]?.toLowerCase() || "";
      if (index < word.length) jaw = (/[aeo]/.test(character) ? 1 : /[iu]/.test(character) ? 0.67 : /[mnbp]/.test(character) ? 0.22 : 0.42)
        + Math.sin(time * 18 + index) * 0.06;
    }
    mina.set({ blink: blinkAmount(time), jaw: Math.max(0, jaw) * 0.55, smile: speaking ? 0.15 : 0.32,
      headX: look.x, headY: look.y, headZ: look.z, breath: Math.sin(time * 1.3) });
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
  // A low-power warm bounce light keeps her face readable without changing the office setup.
  const faceBounce = new THREE.PointLight("#ffe5cf", 0.46, 3.8, 2);
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
    if (mina) host.dataset.ready = "true";
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
    studio.dispose();
    mina?.root.traverse((node) => {
      for (const m of [node.material].flat()) if (m) { for (const v of Object.values(m)) if (v?.isTexture) v.dispose(); m.dispose(); }
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
  // Reduced motion: settle the pose for the current state off-screen and render one static frame.
  const drawStill = () => { for (let t = 50; t <= 2000; t += 50) animateAvatar(t); previousFrameTime = 0; draw(); };
  if (!still) renderer.setAnimationLoop((time) => {
    if (disposed) return;
    if (time - lastAnimationFrame < 1000 / 30) return;
    lastAnimationFrame = time;
    animateAvatar(time);
    renderer.render(scene, camera);
  });
  if (window.ResizeObserver) {
    resizeObserver = new ResizeObserver(draw);
    resizeObserver.observe(host);
  } else {
    resizeListener = draw;
    window.addEventListener("resize", resizeListener);
  }
  if (still) drawStill(); else draw();
  return unmount;
}
