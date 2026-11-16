// Prints the structure of a downloaded Poly Haven model: primitives, materials, and how the
// foliage is built (connected components per primitive), to tune the LOD recipe.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import path from 'node:path';
import { fetchModel } from '../assets/lib/sources.mjs';

const asset = process.argv[2];
const src = path.resolve('asset-src');
const m = await fetchModel(asset, src);
console.log('downloaded', (m.bytes / 1e6).toFixed(1), 'MB', 'alphas', Object.keys(m.alphas));
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(m.gltfPath);
const root = doc.getRoot();
for (const node of root.listNodes()) console.log('node', node.getName(), 'T', node.getTranslation().map((v) => v.toFixed(2)), 'S', node.getScale().map((v) => v.toFixed(2)), 'mesh', node.getMesh()?.getName());
for (const mesh of root.listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION'), idx = prim.getIndices();
    const mat = prim.getMaterial();
    const nTri = idx ? idx.getCount() / 3 : pos.getCount() / 3;
    const nV = pos.getCount();
    // Union-find over vertices by index.
    const parent = new Int32Array(nV).map((_, i) => i);
    const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
    const ia = idx.getArray();
    for (let t = 0; t < ia.length; t += 3) {
      const a = find(ia[t]), b = find(ia[t + 1]), c = find(ia[t + 2]);
      if (b !== a) parent[b] = a;
      if (c !== a) parent[find(c)] = a;
    }
    const comp = new Map();
    for (let t = 0; t < ia.length; t += 3) { const r = find(ia[t]); comp.set(r, (comp.get(r) || 0) + 1); }
    const sizes = [...comp.values()].sort((a, b) => b - a);
    const min = pos.getMin([]), max = pos.getMax([]);
    console.log(`prim mat="${mat.getName()}" alpha=${mat.getAlphaMode()} tris=${nTri} verts=${nV} components=${sizes.length} largest=${sizes.slice(0, 5)} median=${sizes[sizes.length >> 1]} bbox y ${min[1].toFixed(2)}..${max[1].toFixed(2)} x ${min[0].toFixed(2)}..${max[0].toFixed(2)}`);
  }
}
