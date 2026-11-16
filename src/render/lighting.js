// Sun, sky fill, and cascaded shadow maps.
// three's CSM addon splits the view frustum into cascades, each with its own shadow map,
// and patches the lighting chunk so a fragment samples only its cascade. Every lit material
// MUST be registered through lighting.setup(material): the addon creates one directional
// light per cascade, so an unregistered material would be lit once per cascade.
import * as THREE from 'three';
import { CSM } from 'three/addons/csm/CSM.js';

let hookSerial = 0;

export function createLighting(scene, camera, tier) {
  const sunDir = new THREE.Vector3(0.4, 0.7, 0.5).normalize();
  const sh = tier.shadows;
  const csm = new CSM({
    camera, parent: scene, cascades: sh.cascades, maxFar: sh.far, mode: 'practical',
    shadowMapSize: sh.size, lightDirection: sunDir.clone().negate(), lightIntensity: 3,
    lightNear: 1, lightFar: 900, lightMargin: 160, shadowBias: -0.00012,
  });
  csm.fade = true;
  for (const l of csm.lights) {
    l.shadow.radius = sh.radius;
    l.shadow.normalBias = 0.05;
    l.castShadow = sh.enabled;
  }
  const hemi = new THREE.HemisphereLight(0xbcd4ff, 0x4a5a3a, 1);
  scene.add(hemi);

  const lighting = {
    csm, hemi, sunDir, sunColor: new THREE.Color(1, 1, 1), sunIntensity: 3,
    // Register a material. hooks are extra onBeforeCompile functions (terrain splat, wind sway,
    // foliage shading), composed after the cascade hook. key keeps program caches distinct.
    setup(material, hooks = [], key = '') {
      csm.setupMaterial(material);
      const csmHook = material.onBeforeCompile;
      const id = key || (hooks.length ? 'h' + (++hookSerial) : '');
      material.onBeforeCompile = (shader, renderer) => {
        csmHook(shader, renderer);
        for (const h of hooks) h(shader, renderer);
        material.userData.shader = shader;
      };
      material.customProgramCacheKey = () => 'csm' + sh.cascades + ':' + id;
      material.needsUpdate = true;
      return material;
    },
    setSun(dir, color, intensity) {
      sunDir.copy(dir).normalize();
      csm.lightDirection.copy(sunDir).negate();
      lighting.sunColor.copy(color);
      lighting.sunIntensity = intensity;
      for (const l of csm.lights) { l.color.copy(color); l.intensity = intensity; }
    },
    setAmbient(sky, ground, intensity) {
      hemi.color.copy(sky); hemi.groundColor.copy(ground); hemi.intensity = intensity;
    },
    update() {
      // Lesson from the old project: refresh the camera before any projection math.
      camera.updateMatrixWorld();
      csm.update();
    },
    resize() { csm.updateFrustums(); },
    dispose() { csm.remove(); csm.dispose(); scene.remove(hemi); },
  };
  return lighting;
}
