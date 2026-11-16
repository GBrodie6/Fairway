// Dev tool: dumps the texture stats of a processed GLB (alpha coverage per material texture).
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
await MeshoptDecoder.ready;
const doc = await io.read(process.argv[2]);
for (const mat of doc.getRoot().listMaterials()) {
  const t = mat.getBaseColorTexture();
  let info = 'no texture';
  if (t) {
    const img = sharp(Buffer.from(t.getImage()));
    const meta = await img.metadata();
    const st = await img.stats();
    info = `${meta.width}x${meta.height} ch=${meta.channels} alpha=${meta.hasAlpha} means=${st.channels.map((c) => c.mean.toFixed(0)).join(',')}`;
  }
  console.log(mat.getName(), 'alphaMode', mat.getAlphaMode(), 'cutoff', mat.getAlphaCutoff(), info);
}
for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) {
  const uv = p.getAttribute('TEXCOORD_0');
  console.log(' prim', p.getMaterial().getName(), 'verts', uv.getCount(), 'uv min', uv.getMin([]).map((v) => v.toFixed(2)), 'max', uv.getMax([]).map((v) => v.toFixed(2)));
}
