// Phase 1 virtual interview scene. This module is imported only for an active
// interview when VIRTUAL_INTERVIEW_3D is enabled.
import * as THREE from "../vendor/three.module.js";
import { reduceMotion } from "./lib.js";

const makeMaterial = (color, roughness = 0.82, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, ...extra });
const makeClayMaterial = (color, roughness) => new THREE.MeshPhysicalMaterial({
  color, roughness, metalness: 0, clearcoat: 0.1, clearcoatRoughness: 0.72,
});

// aimX(width): where the camera looks across the desk; the room leaves its left side to the question overlay,
// the landing stage (interview.js) leaves its left side to the page heading.
const ROOM_AIM = (w) => (w >= 1024 ? 0.34 : w <= 760 ? 0.12 : 0);

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
    skin: makeClayMaterial("#e9b895", 0.66),
    cheek: new THREE.MeshPhysicalMaterial({ color: "#cf827a", roughness: 0.82, metalness: 0, transparent: true, opacity: 0.2, depthWrite: false }),
    hair: makeClayMaterial("#302936", 0.84), hairLight: makeClayMaterial("#403440", 0.82),
    blazer: makeMaterial("#3e5279", 0.92), shirt: makeMaterial("#f7f4ef", 0.9),
    eyes: new THREE.MeshPhysicalMaterial({ color: "#fffdf8", roughness: 0.34, metalness: 0, clearcoat: 0.16, clearcoatRoughness: 0.42 }),
    iris: makeMaterial("#657185", 0.48), pupil: makeMaterial("#282b35", 0.32),
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
  // Smooth, variable-radius tubes make hair locks and facial curves feel sculpted
  // while keeping their vertex count small enough for laptop integrated graphics.
  const taperedTube = (points, radius, material, parent, { radialSegments = 8, tubularSegments = 18, taper = 0.12 } = {}) => {
    const curve = new THREE.CatmullRomCurve3(points.map((point) => new THREE.Vector3(...point)), false, "centripetal");
    const frames = curve.computeFrenetFrames(tubularSegments, false);
    const positions = [], indices = [];
    for (let i = 0; i <= tubularSegments; i++) {
      const t = i / tubularSegments;
      const point = curve.getPointAt(t);
      const endTaper = THREE.MathUtils.smoothstep(t, 1 - taper, 1);
      const startTaper = THREE.MathUtils.smoothstep(t, 0, taper * 0.55);
      const r = radius * Math.max(0.08, startTaper) * (1 - endTaper * 0.94);
      for (let j = 0; j <= radialSegments; j++) {
        const angle = j / radialSegments * Math.PI * 2;
        const normal = frames.normals[i].clone().multiplyScalar(Math.cos(angle));
        const binormal = frames.binormals[i].clone().multiplyScalar(Math.sin(angle));
        const vertex = point.clone().addScaledVector(normal, r).addScaledVector(binormal, r);
        positions.push(vertex.x, vertex.y, vertex.z);
        if (i < tubularSegments && j < radialSegments) {
          const a = i * (radialSegments + 1) + j, b = a + radialSegments + 1;
          indices.push(a, b, a + 1, b, b + 1, a + 1);
        }
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices); geometry.computeVertexNormals();
    return addMesh(geometry, material, parent);
  };
  const taperedFaceGeometry = () => {
    const geometry = new THREE.SphereGeometry(1, 32, 24);
    const positions = geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      const y = positions.getY(i);
      const jaw = THREE.MathUtils.smoothstep(-y, -0.04, 0.85);
      const cheek = Math.exp(-((y + 0.06) ** 2) / 0.12) * Math.exp(-(positions.getX(i) ** 2) / 0.3);
      positions.setX(i, positions.getX(i) * (1 - jaw * 0.13) * (1 + cheek * 0.025));
      positions.setZ(i, positions.getZ(i) * (1 - jaw * 0.045) + cheek * 0.018);
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
  const torso = new THREE.Group(); torso.position.set(0, 1.1, 0); torso.scale.x = 0.9; person.add(torso);
  // A single softly bevelled silhouette gives the blazer shoulders and waist a tailored shape.
  const blazerShape = new THREE.Shape();
  blazerShape.moveTo(-0.32, -0.54); blazerShape.lineTo(0.32, -0.54);
  blazerShape.quadraticCurveTo(0.4, -0.54, 0.4, -0.43); blazerShape.lineTo(0.37, -0.12);
  blazerShape.quadraticCurveTo(0.38, 0.02, 0.43, 0.16); blazerShape.lineTo(0.51, 0.34);
  blazerShape.quadraticCurveTo(0.53, 0.43, 0.4, 0.47); blazerShape.lineTo(0.19, 0.51);
  blazerShape.lineTo(0.13, 0.35); blazerShape.lineTo(-0.13, 0.35); blazerShape.lineTo(-0.19, 0.51);
  blazerShape.lineTo(-0.4, 0.47); blazerShape.quadraticCurveTo(-0.53, 0.43, -0.51, 0.34);
  blazerShape.lineTo(-0.43, 0.16); blazerShape.quadraticCurveTo(-0.38, 0.02, -0.37, -0.12);
  blazerShape.lineTo(-0.4, -0.43); blazerShape.quadraticCurveTo(-0.4, -0.54, -0.32, -0.54);
  addMesh(new THREE.ExtrudeGeometry(blazerShape, {
    depth: 0.38, bevelEnabled: true, bevelSegments: 4, bevelSize: 0.045,
    bevelThickness: 0.045, curveSegments: 10,
  }), materials.blazer, torso, { position: [0, 0, -0.19] });
  // The shirt panel and collar are separate, softly rounded layers beneath the lapels.
  const shirtPanel = new THREE.Shape();
  shirtPanel.moveTo(-0.13, -0.42); shirtPanel.lineTo(0.13, -0.42);
  shirtPanel.lineTo(0.12, 0.33); shirtPanel.lineTo(-0.12, 0.33); shirtPanel.closePath();
  addMesh(new THREE.ExtrudeGeometry(shirtPanel, {
    depth: 0.025, bevelEnabled: true, bevelSegments: 3, bevelSize: 0.025,
    bevelThickness: 0.018, curveSegments: 8,
  }), materials.shirt, torso, { position: [0, 0, 0.205], cast: false });
  const collarPoint = (side) => {
    const shape = new THREE.Shape();
    shape.moveTo(0, 0.4); shape.lineTo(side * 0.16, 0.35);
    shape.lineTo(side * 0.055, 0.17); shape.lineTo(0, 0.25); shape.closePath();
    addMesh(new THREE.ExtrudeGeometry(shape, {
      depth: 0.035, bevelEnabled: true, bevelSegments: 2, bevelSize: 0.012,
      bevelThickness: 0.012, curveSegments: 6,
    }), materials.shirt, torso, { position: [0, 0, 0.26], cast: false });
  };
  collarPoint(-1); collarPoint(1);
  ellipsoid(materials.accent, [0.035, 0.2, 0.018], [0, 0.02, 0.25], torso);
  // Layered lapels keep the navy blazer structured without widening its silhouette.
  const lapel = (side) => {
    const shape = new THREE.Shape();
    shape.moveTo(0, 0.45); shape.lineTo(side * 0.18, 0.4); shape.lineTo(side * 0.075, -0.03);
    shape.lineTo(side * 0.015, 0.12); shape.closePath();
    const mesh = addMesh(new THREE.ExtrudeGeometry(shape, { depth: 0.024, bevelEnabled: true, bevelSegments: 3, bevelSize: 0.012, bevelThickness: 0.009 }),
      materials.blazer, torso, { position: [0, 0, 0.278] });
    mesh.castShadow = false;
  };
  lapel(-1); lapel(1);
  for (const y of [-0.14, -0.32]) {
    ellipsoid(materials.darkWood, [0.016, 0.016, 0.009], [0.2, y, 0.287], torso);
  }
  // The neck sits just below the jaw, inside the shirt collar.
  cylinder(0.078, 0.078, 0.21, materials.skin, [0, 1.36, 0.13], 20);

  // Seated sleeves bend onto the desktop; the wrists, palms and fingers remain visible above it.
  const arms = [];
  for (const side of [-1, 1]) {
    const shoulder = new THREE.Group(); shoulder.position.set(side * 0.385, 1.47, 0.045); person.add(shoulder);
    const upperArm = ellipsoid(materials.blazer, [0.124, 0.19, 0.15], [side * 0.02, -0.075, 0.09], shoulder);
    upperArm.rotation.z = side * -0.1;
    ellipsoid(materials.blazer, [0.108, 0.105, 0.12], [side * 0.035, -0.17, 0.19], shoulder);
    const forearm = new THREE.Group(); forearm.position.set(side * 0.045, -0.105, 0.215); shoulder.add(forearm);
    const sleeve = ellipsoid(materials.blazer, [0.097, 0.083, 0.28], [0, -0.028, 0.265], forearm);
    sleeve.rotation.x = -0.015;
    // The sleeve slightly overlaps the wrist so the hand joins cleanly without a bulky cuff shape.
    const hand = new THREE.Group(); hand.position.set(-side * 0.13, -0.075, 0.565); forearm.add(hand);
    ellipsoid(materials.skin, [0.074, 0.039, 0.08], [0, 0, 0], hand);
    for (const [fingerX, fingerLength] of [[-0.045, 0.061], [-0.015, 0.07], [0.015, 0.069], [0.044, 0.059]]) {
      const finger = addMesh(new THREE.CapsuleGeometry(0.013, fingerLength, 3, 7), materials.skin, hand,
        { position: [fingerX, -0.003, 0.068], rotation: [Math.PI / 2, 0, 0] });
      finger.scale.x = 0.94;
    }
    const thumb = addMesh(new THREE.CapsuleGeometry(0.02, 0.045, 4, 8), materials.skin, hand,
      { position: [side * 0.075, -0.002, 0.006], rotation: [Math.PI / 2, 0, side * 0.72] });
    thumb.scale.set(0.92, 1, 1);
    arms.push({ shoulder, forearm, side });
  }

  const head = new THREE.Group(); head.position.set(0, 1.9, 0.14); person.add(head);
  const createSculptedHair = () => {
    // A partial sphere forms the back and crown; a few broad tapered locks
    // create a swept hairstyle without reading as a separate helmet.
    const cap = new THREE.SphereGeometry(1, 32, 24, 0, Math.PI * 2, 0, Math.PI * 0.52);
    addMesh(cap, materials.hair, head, { position: [0, 0.025, 0.025] }).scale.set(0.295, 0.35, 0.215);
    const locks = [
      { points: [[-0.245, 0.12, 0.19], [-0.21, 0.24, 0.235], [-0.13, 0.315, 0.25], [-0.035, 0.315, 0.255]], radius: 0.066, material: materials.hair },
      { points: [[-0.15, 0.22, 0.235], [-0.105, 0.32, 0.25], [0.005, 0.355, 0.245], [0.105, 0.305, 0.23]], radius: 0.068, material: materials.hairLight },
      { points: [[-0.025, 0.27, 0.255], [0.065, 0.335, 0.24], [0.17, 0.285, 0.215], [0.235, 0.19, 0.175]], radius: 0.061, material: materials.hair },
    ];
    locks.forEach(({ points, radius, material }) => taperedTube(points, radius, material, head, { tubularSegments: 16 }));
    for (const side of [-1, 1]) taperedTube([
      [side * 0.22, 0.18, 0.1], [side * 0.275, 0.08, 0.135], [side * 0.275, -0.055, 0.135], [side * 0.235, -0.16, 0.095],
    ], 0.059, materials.hair, head, { tubularSegments: 16, taper: 0.16 });
  };
  const createStylizedHead = () => {
    createSculptedHair();
    const face = addMesh(taperedFaceGeometry(), materials.skin, head, { position: [0, 0.01, 0.18] });
    face.scale.set(0.265, 0.32, 0.205);
    // Ears sit behind the cheek silhouette so their join remains soft.
    for (const side of [-1, 1]) {
      ellipsoid(materials.skin, [0.044, 0.067, 0.034], [side * 0.25, -0.018, 0.165], head);
      ellipsoid(materials.cheek, [0.031, 0.014, 0.006], [side * 0.145, -0.066, 0.35], head);
    }
    const eyes = [];
    for (const x of [-0.087, 0.087]) {
      const eye = new THREE.Group(); eye.position.set(x, 0.052, 0.36); head.add(eye);
      ellipsoid(materials.eyes, [0.035, 0.036, 0.019], [0, 0, 0], eye);
      ellipsoid(materials.iris, [0.0155, 0.018, 0.011], [0, -0.002, 0.017], eye);
      ellipsoid(materials.pupil, [0.008, 0.010, 0.006], [0, -0.002, 0.026], eye);
      ellipsoid(materials.eyes, [0.0055, 0.007, 0.004], [-0.006, 0.007, 0.031], eye);
      const upperLid = new THREE.CatmullRomCurve3([
        new THREE.Vector3(-0.035, 0.003, 0.014), new THREE.Vector3(-0.025, 0.026, 0.019),
        new THREE.Vector3(0, 0.034, 0.021), new THREE.Vector3(0.025, 0.026, 0.019),
        new THREE.Vector3(0.035, 0.003, 0.014),
      ]);
      const lowerLid = new THREE.CatmullRomCurve3([
        new THREE.Vector3(-0.034, -0.004, 0.014), new THREE.Vector3(-0.023, -0.025, 0.019),
        new THREE.Vector3(0, -0.032, 0.02), new THREE.Vector3(0.023, -0.025, 0.019),
        new THREE.Vector3(0.034, -0.004, 0.014),
      ]);
      addMesh(new THREE.TubeGeometry(upperLid, 12, 0.0055, 6, false), materials.skin, eye);
      addMesh(new THREE.TubeGeometry(lowerLid, 12, 0.0035, 6, false), materials.skin, eye);
      eyes.push(eye);
    }
    const brows = [];
    for (const x of [-0.087, 0.087]) {
      const browGroup = new THREE.Group(); browGroup.position.set(x, 0.113, 0.36); head.add(browGroup);
      taperedTube([[-0.039, -0.003, 0.004], [-0.02, 0.016, 0.012], [0.008, 0.018, 0.013], [0.039, 0.002, 0.004]],
        0.007, materials.hair, browGroup, { tubularSegments: 10, radialSegments: 6, taper: 0.22 });
      brows.push({ mesh: browGroup, side: x < 0 ? -1 : 1 });
    }
    // Narrow bridge and rounded tip overlap slightly to read as one soft nose.
    ellipsoid(materials.skin, [0.021, 0.05, 0.021], [0, -0.003, 0.365], head);
    ellipsoid(materials.skin, [0.029, 0.023, 0.027], [0, -0.045, 0.384], head);
    const mouth = ellipsoid(materials.mouth, [0.052, 0.012, 0.011], [0, -0.139, 0.371], head);
    mouth.scale.y = 0.001;
    const smileCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.052, -0.143, 0.365), new THREE.Vector3(-0.029, -0.158, 0.373),
      new THREE.Vector3(0, -0.163, 0.376), new THREE.Vector3(0.029, -0.158, 0.373),
      new THREE.Vector3(0.052, -0.143, 0.365),
    ]);
    const smile = addMesh(new THREE.TubeGeometry(smileCurve, 18, 0.005, 6, false), materials.smile, head);
    // Rounded frames now sit close to the smaller eyes; the bridge and temples stay intact.
    for (const x of [-0.087, 0.087]) {
      addMesh(roundedFrameGeometry(0.15, 0.132, 0.042, 0.119, 0.101, 0.031), materials.darkWood, head,
        { position: [x, 0.052, 0.378] });
    }
    const glassesBridge = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.016, 0.052, 0.384), new THREE.Vector3(0, 0.04, 0.397), new THREE.Vector3(0.016, 0.052, 0.384),
    ]);
    addMesh(new THREE.TubeGeometry(glassesBridge, 10, 0.01, 8, false), materials.darkWood, head);
    for (const side of [-1, 1]) {
      const temple = new THREE.CatmullRomCurve3([
        new THREE.Vector3(side * 0.16, 0.068, 0.374), new THREE.Vector3(side * 0.205, 0.06, 0.34), new THREE.Vector3(side * 0.235, 0.04, 0.28),
      ]);
      addMesh(new THREE.TubeGeometry(temple, 10, 0.008, 6, false), materials.darkWood, head);
    }
    return { eyes, brows, mouth, smile };
  };
  const { eyes, brows, mouth, smile } = createStylizedHead();
  // Face, eye and hand details (< 9 cm) cast no visible shadow; skipping them roughly halves the shadow pass.
  person.traverse((node) => {
    if (!node.isMesh) return;
    node.geometry.computeBoundingSphere();
    if (node.geometry.boundingSphere.radius * Math.max(node.scale.x, node.scale.y, node.scale.z) < 0.09) node.castShadow = false;
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
    const breathing = Math.sin(time * 1.3);
    torso.scale.y = 1 + breathing * 0.007 + (listening ? microphoneLevel * 0.012 : 0);
    torso.rotation.x = ease(torso.rotation.x, -0.025 + breathing * 0.004, 2.4);
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
      const gesture = speaking ? Math.max(0, Math.sin(time * 1.35 + (side > 0 ? 0 : Math.PI))) * 0.06 : 0;
      shoulder.position.y = ease(shoulder.position.y, 1.48 + breathing * 0.004, 2.2);
      shoulder.rotation.z = ease(shoulder.rotation.z, side * gesture + (listening ? Math.sin(time * 1.1 + side) * 0.006 : 0), 4);
      forearm.rotation.x = ease(forearm.rotation.x, speaking ? Math.sin(time * 1.35) * 0.045
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
  // Reduced motion: settle the pose for the current state off-screen and render one static frame.
  const drawStill = () => { for (let t = 50; t <= 2000; t += 50) animateAvatar(t); previousFrameTime = 0; draw(); };
  if (!still) renderer.setAnimationLoop((time) => {
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
  if (still) drawStill(); else draw();
  return unmount;
}
