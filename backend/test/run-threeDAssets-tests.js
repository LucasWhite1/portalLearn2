const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const {
  createPublicThreeDAssetToken,
  verifyPublicThreeDAssetToken,
  __testing
} = require('../src/threeDAssets');

const pad4 = (buffer, fill = 0) => {
  const padding = (4 - (buffer.length % 4)) % 4;
  return padding ? Buffer.concat([buffer, Buffer.alloc(padding, fill)]) : buffer;
};

const createTriangleGlb = () => {
  const positions = Buffer.from(new Float32Array([
    -1, -1, 0,
    1, -1, 0,
    0, 1, 0
  ]).buffer);
  const indices = Buffer.from(new Uint16Array([0, 1, 2]).buffer);
  const binary = pad4(Buffer.concat([positions, indices]));
  const json = {
    asset: { version: '2.0', generator: 'Criatyve test' },
    buffers: [{ byteLength: binary.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positions.length, target: 34962 },
      { buffer: 0, byteOffset: positions.length, byteLength: indices.length, target: 34963 }
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 3,
        type: 'VEC3',
        min: [-1, -1, 0],
        max: [1, 1, 0]
      },
      { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' }
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    nodes: [{ mesh: 0 }],
    scenes: [{ nodes: [0] }],
    scene: 0
  };
  const jsonChunk = pad4(Buffer.from(JSON.stringify(json)), 0x20);
  const totalLength = 12 + 8 + jsonChunk.length + 8 + binary.length;
  const header = Buffer.alloc(12);
  header.write('glTF', 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(totalLength, 8);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonChunk.length, 0);
  jsonHeader.write('JSON', 4);
  const binaryHeader = Buffer.alloc(8);
  binaryHeader.writeUInt32LE(binary.length, 0);
  binaryHeader.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jsonHeader, jsonChunk, binaryHeader, binary]);
};

const createTriangleGltf = () => {
  const positions = Buffer.from(new Float32Array([
    -1, -1, 0,
    1, -1, 0,
    0, 1, 0
  ]).buffer);
  const indices = Buffer.from(new Uint16Array([0, 1, 2]).buffer);
  const binary = pad4(Buffer.concat([positions, indices]));
  return {
    asset: { version: '2.0', generator: 'Criatyve test' },
    buffers: [{
      byteLength: binary.length,
      uri: `data:application/octet-stream;base64,${binary.toString('base64')}`
    }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positions.length, target: 34962 },
      { buffer: 0, byteOffset: positions.length, byteLength: indices.length, target: 34963 }
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [-1, -1, 0], max: [1, 1, 0] },
      { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' }
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    nodes: [{ mesh: 0 }],
    scenes: [{ nodes: [0] }],
    scene: 0
  };
};

const run = async () => {
  const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'criatyve-3d-'));
  try {
    const glbPath = path.join(tempDirectory, 'triangle.glb');
    await fs.writeFile(glbPath, createTriangleGlb());
    const { document } = await __testing.readDocument(glbPath, '.glb');
    const stats = __testing.inspectDocument(document);
    assert.strictEqual(stats.triangles, 1);
    assert.strictEqual(stats.nodes, 1);
    assert.doesNotThrow(() => __testing.assertDocumentLimits(stats));

    const optimized = await __testing.optimizeVariant({
      sourcePath: glbPath,
      extension: '.glb',
      triangleTarget: 100_000,
      textureEdge: 1_024
    });
    assert.strictEqual(optimized.buffer.toString('ascii', 0, 4), 'glTF');
    assert.strictEqual(optimized.stats.triangles, 1);

    const gltfPath = path.join(tempDirectory, 'triangle.gltf');
    await fs.writeFile(gltfPath, JSON.stringify(createTriangleGltf()));
    const gltfResult = await __testing.readDocument(gltfPath, '.gltf');
    assert.strictEqual(__testing.inspectDocument(gltfResult.document).triangles, 1);

    const externalGltfPath = path.join(tempDirectory, 'external.gltf');
    await fs.writeFile(
      externalGltfPath,
      JSON.stringify({
        asset: { version: '2.0' },
        buffers: [{ uri: 'https://example.com/model.bin', byteLength: 12 }]
      })
    );
    await assert.rejects(
      () => __testing.readDocument(externalGltfPath, '.gltf'),
      /URLs externas|autocontido/
    );

    assert.throws(() => __testing.readGlbJson(Buffer.from('not-a-glb')), /Assinatura GLB inválida/);

    const assetId = '11111111-1111-4111-8111-111111111111';
    const moduleId = '22222222-2222-4222-8222-222222222222';
    const token = createPublicThreeDAssetToken(assetId, moduleId, 60);
    assert.strictEqual(verifyPublicThreeDAssetToken(token, assetId, moduleId), true);
    assert.strictEqual(verifyPublicThreeDAssetToken(token, assetId, assetId), false);
    console.log('threeDAssets tests: ok');
  } finally {
    await fs.rm(tempDirectory, { recursive: true, force: true });
  }
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
