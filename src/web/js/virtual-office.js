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

  const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 30);
  camera.position.set(0, 1.52, 7.25);
  camera.lookAt(0, 1.2, -0.1);

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

  // Quiet, warm room with a timber floor and a softly lit rear wall.
  box([11, 0.16, 15], materials.floor, [0, -0.08, 1]);
  box([11, 4.7, 0.18], materials.wall, [0, 2.28, -5.7]);
  box([0.18, 4.7, 13], materials.sideWall, [-5.5, 2.28, 0.8]);
  box([0.18, 4.7, 13], materials.wall, [5.5, 2.28, 0.8]);
  box([11, 0.12, 0.18], materials.trim, [0, 0.12, -5.58]);

  // Back window with simple blue panes and slim frames (no image textures).
  box([3.15, 1.72, 0.08], materials.glass, [-2.15, 2.65, -5.57], [0, 0, 0]);
  box([3.32, 0.08, 0.12], materials.trim, [-2.15, 1.77, -5.48]);
  box([3.32, 0.08, 0.12], materials.trim, [-2.15, 3.53, -5.48]);
  box([0.08, 1.84, 0.12], materials.trim, [-3.82, 2.65, -5.48]);
  box([0.08, 1.84, 0.12], materials.trim, [-0.48, 2.65, -5.48]);
  box([0.07, 1.72, 0.12], materials.trim, [-2.15, 2.65, -5.46]);
  box([3.15, 0.06, 0.12], materials.trim, [-2.15, 2.65, -5.46]);
  // A restrained skyline silhouette gives the window depth without textures.
  for (const [x, w, h] of [[-3.25, 0.42, 0.56], [-2.72, 0.58, 0.85], [-1.98, 0.5, 0.44], [-1.35, 0.68, 0.7], [-0.9, 0.36, 0.38]]) {
    box([w, h, 0.025], materials.fabric, [x, 1.82 + h / 2, -5.5], [0, 0, 0]);
  }

  // Interview desk and understated items in the foreground.
  box([3.8, 0.16, 1.45], materials.woodLight, [0, 0.9, 1.38]);
  for (const x of [-1.62, 1.62]) for (const z of [0.86, 1.9]) {
    box([0.12, 0.82, 0.12], materials.darkWood, [x, 0.42, z]);
  }
  // Laptop facing the interviewer, with a readable, muted blue screen.
  box([0.76, 0.055, 0.5], materials.metal, [-0.92, 1.015, 0.93], [-0.06, 0, 0]);
  box([0.76, 0.39, 0.055], materials.darkWood, [-0.92, 1.23, 0.71], [-0.18, 0, 0]);
  box([0.66, 0.29, 0.018], materials.screen, [-0.92, 1.24, 0.675], [-0.18, 0, 0], { cast: false });
  box([0.3, 0.035, 0.24], materials.paper, [1.22, 1.012, 1.48], [0, 0.08, -0.08], { cast: false });
  box([0.3, 0.035, 0.24], materials.paper, [1.26, 1.038, 1.45], [0, 0.08, -0.08], { cast: false });
  cylinder(0.07, 0.07, 0.025, materials.accent, [1.68, 1.0, 1.64]);

  // HR chair sits directly across the desk. The avatar is introduced in Phase 2.
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
  chair(0, -0.42, 1.02);
  chair(3.35, 0.12, 0.78);

  // Plant at the left rear corner adds a small natural accent.
  cylinder(0.27, 0.36, 0.48, materials.pot, [-4.05, 0.25, -2.3], 10);
  for (let i = 0; i < 7; i++) {
    const angle = i * Math.PI * 2 / 7;
    const x = -4.05 + Math.cos(angle) * 0.27;
    const z = -2.3 + Math.sin(angle) * 0.24;
    const leaf = addMesh(new THREE.ConeGeometry(0.16, 1.05 + (i % 3) * 0.12, 7), i % 2 ? materials.leaf : materials.leafLight,
      scene, { position: [x, 0.95, z], rotation: [Math.sin(angle) * 0.22, angle, Math.cos(angle) * 0.22] });
    leaf.castShadow = true;
  }
  cylinder(0.035, 0.05, 0.95, materials.leaf, [-4.05, 0.86, -2.3], 8);

  // Floating shelves and a simple framed brand-color print on the right wall.
  box([1.55, 0.1, 0.42], materials.wood, [4.12, 2.95, -2.75]);
  box([1.55, 0.1, 0.42], materials.wood, [4.12, 2.1, -2.75]);
  box([0.82, 0.07, 0.32], materials.woodLight, [3.9, 3.38, -2.62]);
  box([0.94, 0.72, 0.08], materials.trim, [3.75, 2.56, -5.53]);
  box([0.74, 0.52, 0.035], materials.accent, [3.75, 2.56, -5.47]);
  sphere(0.13, materials.paper, [3.75, 2.56, -5.43], [1.35, 1, 0.18]);

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
  const draw = () => {
    if (disposed) return;
    const w = host.clientWidth, h = host.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    renderer.render(scene, camera);
    host.dataset.ready = "true";
  };
  const unmount = () => {
    if (disposed) return;
    disposed = true; resizeObserver?.disconnect();
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
