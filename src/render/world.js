// World: the 3D scene for one hole. Stage 0 placeholder (sky gradient, ground, sun) so the
// engine, the color pipeline, and the verify gate can run end to end. Later stages replace the
// contents with terrain, sky, vegetation, water, and props behind the same interface.
import * as THREE from 'three';
import { todById } from './timeOfDay.js';
import { courseById } from '../course/courses.js';
import { DEG } from '../core/math.js';

const GROUND = { parkland: 0x3f7a35, links: 0x6f8a45, desert: 0xb9793f, alpine: 0x4c7a4a, tropical: 0x3f9a4a };

export function createWorld(engine, { courseId, todId, hole = 1 }) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, engine.width / engine.height, 0.3, 6000);
  camera.position.set(0, 2.2, 6);
  camera.lookAt(0, 1.2, -40);

  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, depthTest: false,
    uniforms: { uSunDir: { value: new THREE.Vector3() }, uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uSun: { value: new THREE.Color() } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = position; vec4 p = modelViewMatrix * vec4(position, 0.0); gl_Position = projectionMatrix * vec4(p.xyz, 1.0); gl_Position.z = gl_Position.w; }',
    fragmentShader: 'varying vec3 vDir; uniform vec3 uSunDir; uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uSun; void main(){ vec3 d = normalize(vDir); float h = clamp(d.y, 0.0, 1.0); vec3 c = mix(uHorizon, uZenith, pow(h, 0.5)); float s = max(dot(d, uSunDir), 0.0); c += uSun * (pow(s, 600.0) * 30.0 + pow(s, 12.0) * 0.25); gl_FragColor = vec4(c, 1.0); }',
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), skyMat);
  sky.frustumCulled = false; sky.renderOrder = -1000;
  scene.add(sky);

  const groundMat = new THREE.MeshStandardMaterial({ color: 0x3f7a35, roughness: 0.95 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000, 1, 1).rotateX(-Math.PI / 2), groundMat);
  ground.receiveShadow = true;
  scene.add(ground);

  const sun = new THREE.DirectionalLight(0xffffff, 3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -30; sun.shadow.camera.right = 30; sun.shadow.camera.top = 30; sun.shadow.camera.bottom = -30;
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 300;
  scene.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(0xbfd8ff, 0x5a6b45, 1);
  scene.add(hemi);

  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.0427, 24, 16), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35 }));
  ball.position.set(0, 0.0427, 0); ball.castShadow = true;
  scene.add(ball);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 2.1, 8), new THREE.MeshStandardMaterial({ color: 0xf2f2e8, roughness: 0.5 }));
  pole.position.set(0, 1.05, -60); pole.castShadow = true;
  scene.add(pole);

  const world = { scene, camera, courseId, todId, hole, sunDir: new THREE.Vector3(), ready: true };

  world.setTimeOfDay = (id) => {
    const tod = todById(id);
    world.todId = tod.id;
    const el = tod.sunElev * DEG, az = tod.sunAz * DEG;
    world.sunDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
    sun.position.copy(world.sunDir).multiplyScalar(120);
    sun.color.setRGB(tod.sunColor[0], tod.sunColor[1], tod.sunColor[2]);
    sun.intensity = tod.sunIntensity;
    hemi.intensity = tod.ambient * (tod.night ? 0.12 : 1.0);
    const day = Math.max(0, Math.min(1, tod.sunElev / 30));
    skyMat.uniforms.uSunDir.value.copy(world.sunDir);
    if (tod.night) {
      skyMat.uniforms.uZenith.value.setRGB(0.004, 0.008, 0.02);
      skyMat.uniforms.uHorizon.value.setRGB(0.012, 0.02, 0.045);
      skyMat.uniforms.uSun.value.setRGB(0.3, 0.36, 0.5);
    } else {
      skyMat.uniforms.uZenith.value.setRGB(0.1 + 0.05 * day, 0.22 + 0.2 * day, 0.5 + 0.35 * day);
      skyMat.uniforms.uHorizon.value.setRGB(0.9 * tod.fog.color[0], 0.9 * tod.fog.color[1], 0.9 * tod.fog.color[2]);
      skyMat.uniforms.uSun.value.setRGB(tod.sunColor[0], tod.sunColor[1], tod.sunColor[2]);
    }
    const p = engine.post.state;
    p.sunDir.copy(world.sunDir);
    p.fogColor.setRGB(tod.fog.color[0], tod.fog.color[1], tod.fog.color[2]);
    if (tod.night) p.fogColor.multiplyScalar(0.25);
    p.fogSunColor.setRGB(tod.sunColor[0], tod.sunColor[1], tod.sunColor[2]);
    p.fogDensity = tod.fog.density; p.fogHaze = tod.fog.haze; p.fogHeight = tod.fog.height; p.fogMax = tod.fog.max;
    p.contrast = tod.grade.contrast; p.saturation = tod.grade.saturation;
    p.tint.setRGB(tod.grade.tint[0], tod.grade.tint[1], tod.grade.tint[2]);
    p.shaftStrength = tod.shafts * 0.5;
    p.shaftColor.setRGB(tod.sunColor[0], tod.sunColor[1], tod.sunColor[2]);
    engine.exposure.target = tod.targetLuma;
    engine.exposure.min = tod.exposure[0]; engine.exposure.max = tod.exposure[1];
  };

  world.setCourse = (id) => {
    const c = courseById(id);
    world.courseId = c.id;
    groundMat.color.setHex(GROUND[c.id] || GROUND.parkland);
  };

  world.resize = () => {
    camera.aspect = engine.width / engine.height;
    // Hold the horizontal field of view in portrait so the hole stays in frame.
    camera.fov = camera.aspect >= 1 ? 55 : Math.min(85, (2 * Math.atan(Math.tan((55 * DEG) / 2) / Math.max(camera.aspect, 0.45) * 0.72)) / DEG);
    camera.updateProjectionMatrix();
  };

  world.update = () => {
    sky.position.copy(camera.position);
    sky.scale.setScalar(camera.far * 0.9);
  };

  world.dispose = () => {
    scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
  };

  world.setCourse(courseId);
  world.setTimeOfDay(todId);
  world.resize();
  return world;
}
