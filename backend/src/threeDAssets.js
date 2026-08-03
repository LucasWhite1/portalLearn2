const crypto = require('crypto');
const fs = require('fs');
const fsPromises = require('fs/promises');
const path = require('path');
const Busboy = require('busboy');
const sharp = require('sharp');
const db = require('./db');
const {
  getProviderUserAgent,
  isApprovedExternalModelUrl,
  isSafeRelativeResourcePath
} = require('./externalThreeDCatalog');

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const MAX_TRIANGLES = 1_000_000;
const MAX_NODES = 5_000;
const MAX_MATERIALS = 100;
const MAX_TEXTURE_EDGE = 4_096;
const MAX_TEXTURE_PIXELS = 64 * 1024 * 1024;
const DESKTOP_TRIANGLE_TARGET = 250_000;
const MOBILE_TRIANGLE_TARGET = 100_000;
const DESKTOP_TEXTURE_EDGE = 2_048;
const MOBILE_TEXTURE_EDGE = 1_024;
const ASSET_ID_REGEX = /^[0-9a-f-]{36}$/i;
const SAFE_FILE_NAME_REGEX = /[^a-z0-9._-]+/gi;
const storageRoot = path.resolve(
  process.env.THREE_D_STORAGE_DIR || path.join(__dirname, '../../storage/3d')
);
const publicTokenSecret = String(process.env.SESSION_SECRET || 'development-only-three-d-token');

let tableReady = false;
let gltfRuntimePromise = null;
let lastOrphanCleanupAt = 0;

const isInsideStorageRoot = (targetPath) => {
  const resolvedRoot = path.resolve(storageRoot);
  const resolvedTarget = path.resolve(targetPath);
  return resolvedTarget !== resolvedRoot && resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`);
};

const removeThreeDAssetDirectory = async (targetPath, { throwOnFailure = false } = {}) => {
  if (!targetPath || !isInsideStorageRoot(targetPath)) {
    const error = new Error('Diretorio 3D invalido para remocao.');
    if (throwOnFailure) throw error;
    console.warn(error.message);
    return false;
  }
  const removeOptions = {
    recursive: true,
    force: true,
    maxRetries: 8,
    retryDelay: 150
  };
  try {
    await fsPromises.rm(targetPath, removeOptions);
    return true;
  } catch (error) {
    if (!['ENOTEMPTY', 'EBUSY', 'EPERM'].includes(error?.code)) {
      if (throwOnFailure) throw error;
      console.warn('Nao foi possivel remover diretorio 3D:', error);
      return false;
    }
    try {
      const quarantineRoot = path.join(storageRoot, '.quarantine');
      await fsPromises.mkdir(quarantineRoot, { recursive: true });
      const quarantinePath = path.join(
        quarantineRoot,
        `${path.basename(targetPath)}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`
      );
      await fsPromises.rename(targetPath, quarantinePath);
      setTimeout(() => {
        fsPromises.rm(quarantinePath, removeOptions).catch((cleanupError) => {
          console.warn('Nao foi possivel limpar diretorio 3D em quarentena:', cleanupError);
        });
      }, 250);
      return true;
    } catch (quarantineError) {
      if (throwOnFailure) throw quarantineError;
      console.warn('Nao foi possivel colocar diretorio 3D em quarentena:', quarantineError);
      return false;
    }
  }
};

const removeLegacyThreeDCommerce = async () => {
  let catalogAssetIds = [];
  try {
    const { rows } = await db.query(`
      SELECT id
        FROM three_d_assets
       WHERE EXISTS (
         SELECT 1 FROM information_schema.columns
          WHERE table_schema='public' AND table_name='three_d_assets' AND column_name='is_catalog_asset'
       )
         AND is_catalog_asset = TRUE
    `);
    catalogAssetIds = rows.map((row) => row.id);
  } catch {
    catalogAssetIds = [];
  }
  await db.query('DROP TABLE IF EXISTS three_d_store_webhook_events CASCADE');
  await db.query('DROP TABLE IF EXISTS three_d_store_favorites CASCADE');
  await db.query('DROP TABLE IF EXISTS three_d_store_installations CASCADE');
  await db.query('DROP TABLE IF EXISTS three_d_store_entitlements CASCADE');
  await db.query('DROP TABLE IF EXISTS three_d_store_orders CASCADE');
  await db.query('DROP TABLE IF EXISTS three_d_store_items CASCADE');
  if (catalogAssetIds.length) {
    await db.query('DELETE FROM three_d_assets WHERE id = ANY($1::uuid[])', [catalogAssetIds]);
    await Promise.all(catalogAssetIds.map((id) =>
      removeThreeDAssetDirectory(path.join(storageRoot, id))
    ));
  }
  await db.query('ALTER TABLE three_d_assets DROP COLUMN IF EXISTS is_catalog_asset');
  await removeThreeDAssetDirectory(path.join(storageRoot, '.store-private'));
};

const ensureThreeDAssetsTable = async () => {
  if (tableReady) return;
  await db.query(
    `CREATE TABLE IF NOT EXISTS three_d_assets (
       id UUID PRIMARY KEY,
       owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
       original_name TEXT NOT NULL,
       mime_type TEXT NOT NULL DEFAULT 'model/gltf-binary',
       sha256 TEXT NOT NULL,
       status TEXT NOT NULL DEFAULT 'PROCESSING',
       desktop_path TEXT,
       mobile_path TEXT,
       poster_path TEXT,
       desktop_size BIGINT NOT NULL DEFAULT 0,
       mobile_size BIGINT NOT NULL DEFAULT 0,
       poster_size BIGINT NOT NULL DEFAULT 0,
       stats JSONB NOT NULL DEFAULT '{}'::jsonb,
       error_message TEXT,
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       last_referenced_at TIMESTAMPTZ,
       UNIQUE(owner_user_id, sha256)
     )`
  );
  await db.query(
    'CREATE INDEX IF NOT EXISTS idx_three_d_assets_owner ON three_d_assets(owner_user_id, created_at DESC)'
  );
  await db.query('ALTER TABLE three_d_assets ADD COLUMN IF NOT EXISTS source_provider TEXT');
  await db.query('ALTER TABLE three_d_assets ADD COLUMN IF NOT EXISTS source_reference TEXT');
  await db.query('ALTER TABLE three_d_assets ADD COLUMN IF NOT EXISTS source_license TEXT');
  await removeLegacyThreeDCommerce();
  await fsPromises.mkdir(path.join(storageRoot, '.quarantine'), { recursive: true });
  tableReady = true;
};

const cleanupOrphanedThreeDAssets = async ({ force = false } = {}) => {
  await ensureThreeDAssetsTable();
  if (!force && Date.now() - lastOrphanCleanupAt < 60 * 60 * 1000) return 0;
  lastOrphanCleanupAt = Date.now();
  const { rows } = await db.query(
    `DELETE FROM three_d_assets asset
      WHERE asset.status = 'READY'
        AND asset.created_at < NOW() - INTERVAL '24 hours'
        AND NOT EXISTS (
          SELECT 1
            FROM modules module
           WHERE module.builder_data::text LIKE '%' || asset.id::text || '%'
        )
      RETURNING asset.id`
  );
  await Promise.all(
    rows.map((row) => removeThreeDAssetDirectory(path.join(storageRoot, row.id)))
  );
  return rows.length;
};

const getGltfRuntime = async () => {
  if (!gltfRuntimePromise) {
    gltfRuntimePromise = Promise.all([
      import('@gltf-transform/core'),
      import('@gltf-transform/extensions'),
      import('@gltf-transform/functions'),
      import('meshoptimizer'),
      import('draco3dgltf')
    ]).then(async ([core, extensions, functions, meshoptimizer, draco]) => {
      await Promise.all([meshoptimizer.MeshoptDecoder.ready, meshoptimizer.MeshoptEncoder.ready]);
      const [dracoDecoder, dracoEncoder] = await Promise.all([
        draco.createDecoderModule({}),
        draco.createEncoderModule({})
      ]);
      return {
        ...core,
        ...functions,
        ALL_EXTENSIONS: extensions.ALL_EXTENSIONS,
        MeshoptSimplifier: meshoptimizer.MeshoptSimplifier,
        ioDependencies: {
          'meshopt.decoder': meshoptimizer.MeshoptDecoder,
          'meshopt.encoder': meshoptimizer.MeshoptEncoder,
          'draco3d.decoder': dracoDecoder,
          'draco3d.encoder': dracoEncoder
        }
      };
    });
  }
  return gltfRuntimePromise;
};

const sanitizeOriginalName = (value = '') => {
  const baseName = path.basename(String(value || 'modelo.glb')).slice(0, 160);
  return baseName.replace(SAFE_FILE_NAME_REGEX, '_') || 'modelo.glb';
};

const isAllowedDataUri = (value = '') =>
  /^data:(application\/octet-stream|application\/gltf-buffer|image\/(png|jpeg|webp|ktx2));base64,[a-z0-9+/=\s]+$/i.test(
    String(value || '')
  );

const assertNoExternalResources = (json) => {
  const resources = [
    ...(Array.isArray(json?.buffers) ? json.buffers : []),
    ...(Array.isArray(json?.images) ? json.images : [])
  ];
  resources.forEach((resource) => {
    if (resource?.uri && !isAllowedDataUri(resource.uri)) {
      const error = new Error('O modelo possui arquivos ou URLs externas. Envie um GLB ou GLTF autocontido.');
      error.statusCode = 400;
      error.code = 'THREE_D_EXTERNAL_RESOURCE';
      throw error;
    }
  });
};

const readGlbJson = (buffer) => {
  if (buffer.length < 20 || buffer.toString('ascii', 0, 4) !== 'glTF') {
    throw new Error('Assinatura GLB inválida.');
  }
  const version = buffer.readUInt32LE(4);
  const declaredLength = buffer.readUInt32LE(8);
  if (version !== 2 || declaredLength !== buffer.length) {
    throw new Error('Somente arquivos GLB 2.0 válidos são aceitos.');
  }
  const jsonLength = buffer.readUInt32LE(12);
  const jsonType = buffer.toString('ascii', 16, 20);
  if (jsonType !== 'JSON' || jsonLength < 2 || 20 + jsonLength > buffer.length) {
    throw new Error('O bloco JSON do GLB é inválido.');
  }
  return JSON.parse(buffer.toString('utf8', 20, 20 + jsonLength).replace(/\0+$/g, '').trim());
};

const readDocument = async (filePath, extension) => {
  const runtime = await getGltfRuntime();
  const io = new runtime.NodeIO()
    .registerExtensions(runtime.ALL_EXTENSIONS)
    .registerDependencies(runtime.ioDependencies)
    .setAllowNetwork(false);
  const buffer = await fsPromises.readFile(filePath);
  if (extension === '.glb') {
    const json = readGlbJson(buffer);
    assertNoExternalResources(json);
    return { document: await io.readBinary(new Uint8Array(buffer)), io };
  }
  let json;
  try {
    json = JSON.parse(buffer.toString('utf8'));
  } catch (error) {
    throw new Error('O arquivo GLTF não contém JSON válido.');
  }
  if (String(json?.asset?.version || '') !== '2.0') {
    throw new Error('Somente arquivos GLTF 2.0 são aceitos.');
  }
  assertNoExternalResources(json);
  return {
    document: await io.readJSON({ json, resources: {} }),
    io
  };
};

const countDocumentTriangles = (document) => {
  let triangles = 0;
  document.getRoot().listMeshes().forEach((mesh) => {
    mesh.listPrimitives().forEach((primitive) => {
      const count = primitive.getIndices()?.getCount() || primitive.getAttribute('POSITION')?.getCount() || 0;
      triangles += Math.floor(count / 3);
    });
  });
  return triangles;
};

const inspectDocument = (document) => {
  const root = document.getRoot();
  const textures = root.listTextures();
  const textureStats = textures.map((texture) => {
    const size = texture.getSize() || [0, 0];
    return { width: Number(size[0]) || 0, height: Number(size[1]) || 0 };
  });
  return {
    triangles: countDocumentTriangles(document),
    nodes: root.listNodes().length,
    meshes: root.listMeshes().length,
    materials: root.listMaterials().length,
    textures: textures.length,
    texturePixels: textureStats.reduce((total, item) => total + item.width * item.height, 0),
    maxTextureEdge: textureStats.reduce(
      (maximum, item) => Math.max(maximum, item.width, item.height),
      0
    ),
    animations: root.listAnimations().map((animation, index) => ({
      index,
      name: String(animation.getName() || `Animação ${index + 1}`).slice(0, 120)
    }))
  };
};

const assertDocumentLimits = (stats) => {
  const failures = [];
  if (stats.triangles > MAX_TRIANGLES) failures.push(`mais de ${MAX_TRIANGLES.toLocaleString('pt-BR')} triângulos`);
  if (stats.nodes > MAX_NODES) failures.push(`mais de ${MAX_NODES.toLocaleString('pt-BR')} nós`);
  if (stats.materials > MAX_MATERIALS) failures.push(`mais de ${MAX_MATERIALS} materiais`);
  if (stats.maxTextureEdge > MAX_TEXTURE_EDGE) failures.push(`textura acima de ${MAX_TEXTURE_EDGE}px`);
  if (stats.texturePixels > MAX_TEXTURE_PIXELS) failures.push('texturas acima do orçamento total');
  if (failures.length) {
    const error = new Error(`Modelo 3D recusado: ${failures.join(', ')}.`);
    error.statusCode = 400;
    error.code = 'THREE_D_MODEL_LIMIT';
    throw error;
  }
};

const optimizeVariant = async ({ sourcePath, extension, triangleTarget, textureEdge }) => {
  const runtime = await getGltfRuntime();
  const { document, io } = await readDocument(sourcePath, extension);
  const initialTriangles = Math.max(1, countDocumentTriangles(document));
  const transforms = [runtime.dedup(), runtime.prune(), runtime.weld()];
  if (initialTriangles > triangleTarget) {
    await runtime.MeshoptSimplifier.ready;
    transforms.push(
      runtime.simplify({
        simplifier: runtime.MeshoptSimplifier,
        ratio: Math.max(0.05, triangleTarget / initialTriangles),
        error: 0.001,
        lockBorder: true
      })
    );
  }
  transforms.push(
    runtime.textureCompress({
      encoder: sharp,
      targetFormat: 'webp',
      resize: [textureEdge, textureEdge],
      quality: 82
    }),
    runtime.prune()
  );
  await document.transform(...transforms);
  return {
    buffer: Buffer.from(await io.writeBinary(document)),
    stats: inspectDocument(document)
  };
};

const parseMultipartModel = async (req) => {
  await ensureThreeDAssetsTable();
  const tempId = crypto.randomUUID();
  const tempPath = path.join(storageRoot, '.quarantine', `${tempId}.upload`);
  const hash = crypto.createHash('sha256');
  let uploadPromise = null;
  let originalName = '';
  let extension = '';
  let byteLength = 0;
  let receivedFile = false;

  await new Promise((resolve, reject) => {
    let busboy;
    try {
      busboy = Busboy({
        headers: req.headers,
        limits: { files: 1, fileSize: MAX_UPLOAD_BYTES, fields: 4, parts: 5 }
      });
    } catch (error) {
      reject(Object.assign(new Error('Envie o modelo como multipart/form-data.'), { statusCode: 400 }));
      return;
    }
    busboy.on('file', (fieldName, file, info) => {
      if (receivedFile || fieldName !== 'model') {
        file.resume();
        return;
      }
      receivedFile = true;
      originalName = sanitizeOriginalName(info.filename);
      extension = path.extname(originalName).toLowerCase();
      if (!['.glb', '.gltf'].includes(extension)) {
        file.resume();
        reject(Object.assign(new Error('Envie um arquivo .glb ou .gltf.'), { statusCode: 400 }));
        return;
      }
      const output = fs.createWriteStream(tempPath, { flags: 'wx' });
      uploadPromise = new Promise((resolveUpload, rejectUpload) => {
        output.on('finish', resolveUpload);
        output.on('error', rejectUpload);
        file.on('error', rejectUpload);
        file.on('limit', () => {
          rejectUpload(Object.assign(new Error('O modelo excede o limite de 100 MB.'), { statusCode: 413 }));
        });
      });
      file.on('data', (chunk) => {
        byteLength += chunk.length;
        hash.update(chunk);
      });
      file.pipe(output);
    });
    busboy.on('error', reject);
    busboy.on('finish', resolve);
    req.pipe(busboy);
  });

  try {
    if (!receivedFile || !uploadPromise) {
      throw Object.assign(new Error('Selecione um modelo 3D para enviar.'), { statusCode: 400 });
    }
    await uploadPromise;
    if (!byteLength) {
      throw Object.assign(new Error('O modelo enviado está vazio.'), { statusCode: 400 });
    }
    return {
      tempPath,
      originalName,
      extension,
      byteLength,
      sha256: hash.digest('hex')
    };
  } catch (error) {
    await fsPromises.rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
};

const serializeAsset = (row) => ({
  id: row.id,
  originalName: row.original_name,
  status: row.status,
  size: Number(row.desktop_size || 0) + Number(row.mobile_size || 0) + Number(row.poster_size || 0),
  desktopSize: Number(row.desktop_size || 0),
  mobileSize: Number(row.mobile_size || 0),
  stats: row.stats || {},
  errorMessage: row.error_message || null,
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

const processThreeDAssetUpload = async (ownerUserId, upload, options = {}) => {
  let assetDirectory = '';
  let assetCommitted = false;
  try {
    const { rows: duplicateRows } = await db.query(
      `SELECT * FROM three_d_assets
        WHERE owner_user_id = $1 AND sha256 = $2 AND status = 'READY'
        LIMIT 1`,
      [ownerUserId, upload.sha256]
    );
    if (duplicateRows.length) {
      await fsPromises.rm(upload.tempPath, { force: true });
      return { asset: serializeAsset(duplicateRows[0]), duplicate: true };
    }

    const inspection = await readDocument(upload.tempPath, upload.extension);
    const originalStats = inspectDocument(inspection.document);
    assertDocumentLimits(originalStats);

    const [desktop, mobile] = await Promise.all([
      optimizeVariant({
        sourcePath: upload.tempPath,
        extension: upload.extension,
        triangleTarget: DESKTOP_TRIANGLE_TARGET,
        textureEdge: DESKTOP_TEXTURE_EDGE
      }),
      optimizeVariant({
        sourcePath: upload.tempPath,
        extension: upload.extension,
        triangleTarget: MOBILE_TRIANGLE_TARGET,
        textureEdge: MOBILE_TEXTURE_EDGE
      })
    ]);
    const totalBytes = desktop.buffer.length + mobile.buffer.length;
    if (typeof options.assertQuota === 'function') {
      await options.assertQuota(totalBytes);
    }

    const assetId = crypto.randomUUID();
    assetDirectory = path.join(storageRoot, assetId);
    await fsPromises.mkdir(assetDirectory, { recursive: true });
    const desktopPath = path.join(assetDirectory, 'desktop.glb');
    const mobilePath = path.join(assetDirectory, 'mobile.glb');
    await Promise.all([
      fsPromises.writeFile(desktopPath, desktop.buffer, { flag: 'wx' }),
      fsPromises.writeFile(mobilePath, mobile.buffer, { flag: 'wx' })
    ]);
    const stats = {
      original: originalStats,
      desktop: desktop.stats,
      mobile: mobile.stats,
      optimized: true
    };
    const { rows } = await db.query(
      `INSERT INTO three_d_assets (
         id, owner_user_id, original_name, sha256, status,
         desktop_path, mobile_path, desktop_size, mobile_size, stats,
         source_provider, source_reference, source_license, updated_at
       )
       VALUES ($1, $2, $3, $4, 'READY', $5, $6, $7, $8, $9, $10, $11, $12, NOW())
       RETURNING *`,
      [
        assetId,
        ownerUserId,
        upload.originalName,
        upload.sha256,
        desktopPath,
        mobilePath,
        desktop.buffer.length,
        mobile.buffer.length,
        stats,
        options.sourceProvider || null,
        options.sourceReference || null,
        options.sourceLicense || null
      ]
    );
    assetCommitted = true;
    return { asset: serializeAsset(rows[0]), duplicate: false };
  } finally {
    await fsPromises.rm(upload.tempPath, { force: true }).catch(() => {});
    if (assetDirectory && !assetCommitted) {
      await fsPromises.rm(assetDirectory, { recursive: true, force: true }).catch(() => {});
    }
  }
};

const createThreeDAssetFromRequest = async (req, options = {}) => {
  await cleanupOrphanedThreeDAssets();
  const upload = await parseMultipartModel(req);
  return processThreeDAssetUpload(req.user.id, upload, options);
};

const downloadRemoteFile = async ({ url, destination, provider, remainingBytes }) => {
  if (!isApprovedExternalModelUrl(url, provider)) {
    throw Object.assign(new Error('A origem remota do modelo não é permitida.'), { statusCode: 400 });
  }
  const response = await fetch(new URL(url), {
    redirect: 'manual',
    signal: AbortSignal.timeout(120_000),
    headers: {
      accept: 'model/gltf+json,model/gltf-binary,application/octet-stream,image/*',
      'user-agent': getProviderUserAgent()
    }
  });
  if (!response.ok || !response.body) {
    throw Object.assign(new Error('Não foi possível baixar o modelo selecionado.'), { statusCode: 502 });
  }
  const declaredSize = Number(response.headers.get('content-length') || 0);
  if (declaredSize > remainingBytes) {
    await response.body.cancel().catch(() => {});
    throw Object.assign(new Error('O modelo remoto excede o limite de 100 MB.'), { statusCode: 413 });
  }
  await fsPromises.mkdir(path.dirname(destination), { recursive: true });
  const handle = await fsPromises.open(destination, 'wx');
  let byteLength = 0;
  try {
    for await (const chunk of response.body) {
      const buffer = Buffer.from(chunk);
      byteLength += buffer.length;
      if (byteLength > remainingBytes) {
        throw Object.assign(new Error('O modelo remoto excede o limite de 100 MB.'), { statusCode: 413 });
      }
      await handle.write(buffer);
    }
  } catch (error) {
    await handle.close().catch(() => {});
    await fsPromises.rm(destination, { force: true }).catch(() => {});
    throw error;
  }
  await handle.close();
  if (!byteLength) {
    await fsPromises.rm(destination, { force: true }).catch(() => {});
    throw Object.assign(new Error('O modelo remoto está vazio.'), { statusCode: 502 });
  }
  return byteLength;
};

const bundlePolyHavenGltf = async (remoteModel, tempId) => {
  const tempDirectory = path.join(storageRoot, '.quarantine', `${tempId}-source`);
  const mainPath = path.join(tempDirectory, 'model.gltf');
  const outputPath = path.join(storageRoot, '.quarantine', `${tempId}.upload`);
  let totalBytes = 0;
  try {
    totalBytes += await downloadRemoteFile({
      url: remoteModel.url,
      destination: mainPath,
      provider: 'POLY_HAVEN',
      remainingBytes: MAX_UPLOAD_BYTES
    });
    const resources = Array.isArray(remoteModel.resources) ? remoteModel.resources : [];
    if (!resources.length || resources.length > 32) {
      throw Object.assign(new Error('O pacote GLTF remoto possui dependências inválidas.'), { statusCode: 400 });
    }
    const resourcePaths = new Set();
    for (const resource of resources) {
      if (
        !isSafeRelativeResourcePath(resource.relativePath)
        || !isApprovedExternalModelUrl(resource.url, 'POLY_HAVEN')
      ) {
        throw Object.assign(new Error('O pacote GLTF remoto contém uma dependência não permitida.'), {
          statusCode: 400
        });
      }
      const destination = path.resolve(tempDirectory, resource.relativePath);
      if (!destination.startsWith(`${path.resolve(tempDirectory)}${path.sep}`)) {
        throw Object.assign(new Error('O pacote GLTF remoto contém um caminho inválido.'), { statusCode: 400 });
      }
      totalBytes += await downloadRemoteFile({
        url: resource.url,
        destination,
        provider: 'POLY_HAVEN',
        remainingBytes: MAX_UPLOAD_BYTES - totalBytes
      });
      resourcePaths.add(String(resource.relativePath).replace(/\\/g, '/'));
    }

    const gltfJson = JSON.parse(await fsPromises.readFile(mainPath, 'utf8'));
    if (String(gltfJson?.asset?.version || '') !== '2.0') {
      throw Object.assign(new Error('O pacote remoto não é GLTF 2.0.'), { statusCode: 400 });
    }
    const referencedUris = [
      ...(Array.isArray(gltfJson.buffers) ? gltfJson.buffers : []),
      ...(Array.isArray(gltfJson.images) ? gltfJson.images : [])
    ].map((resource) => String(resource?.uri || '').replace(/\\/g, '/')).filter(Boolean);
    if (referencedUris.some((uri) => !isSafeRelativeResourcePath(uri) || !resourcePaths.has(uri))) {
      throw Object.assign(new Error('O pacote GLTF remoto referencia arquivos não autorizados.'), {
        statusCode: 400
      });
    }

    const runtime = await getGltfRuntime();
    const io = new runtime.NodeIO()
      .registerExtensions(runtime.ALL_EXTENSIONS)
      .registerDependencies(runtime.ioDependencies)
      .setAllowNetwork(false);
    const document = await io.read(mainPath);
    const binary = Buffer.from(await io.writeBinary(document));
    if (!binary.length || binary.length > MAX_UPLOAD_BYTES) {
      throw Object.assign(new Error('O GLB convertido excede o limite de 100 MB.'), { statusCode: 413 });
    }
    await fsPromises.writeFile(outputPath, binary, { flag: 'wx' });
    return {
      tempPath: outputPath,
      originalName: sanitizeOriginalName(`${remoteModel.originalName || 'modelo-criatyve'}.glb`),
      extension: '.glb',
      byteLength: binary.length,
      sha256: crypto.createHash('sha256').update(binary).digest('hex')
    };
  } finally {
    await fsPromises.rm(tempDirectory, { recursive: true, force: true }).catch(() => {});
  }
};

const downloadApprovedRemoteModel = async (remoteModel) => {
  await ensureThreeDAssetsTable();
  const { url, originalName, provider = 'SMITHSONIAN_OPEN_ACCESS' } = remoteModel;
  if (!isApprovedExternalModelUrl(url, provider)) {
    throw Object.assign(new Error('A origem remota do modelo não é permitida.'), { statusCode: 400 });
  }
  const tempId = crypto.randomUUID();
  if (provider === 'POLY_HAVEN') {
    return bundlePolyHavenGltf(remoteModel, tempId);
  }
  const tempPath = path.join(storageRoot, '.quarantine', `${tempId}.upload`);
  const byteLength = await downloadRemoteFile({
    url,
    destination: tempPath,
    provider,
    remainingBytes: MAX_UPLOAD_BYTES
  });
  const buffer = await fsPromises.readFile(tempPath);
  return {
    tempPath,
    originalName: sanitizeOriginalName(`${originalName || 'modelo-criatyve'}.glb`),
    extension: '.glb',
    byteLength,
    sha256: crypto.createHash('sha256').update(buffer).digest('hex')
  };
};

const createThreeDAssetFromRemote = async (ownerUserId, remoteModel, options = {}) => {
  await cleanupOrphanedThreeDAssets();
  const upload = await downloadApprovedRemoteModel(remoteModel);
  return processThreeDAssetUpload(ownerUserId, upload, options);
};

const getThreeDAsset = async (assetId) => {
  if (!ASSET_ID_REGEX.test(String(assetId || ''))) return null;
  await ensureThreeDAssetsTable();
  const { rows } = await db.query('SELECT * FROM three_d_assets WHERE id = $1 LIMIT 1', [assetId]);
  return rows[0] || null;
};

const listThreeDAssets = async (ownerUserId) => {
  await ensureThreeDAssetsTable();
  await cleanupOrphanedThreeDAssets();
  const { rows } = await db.query(
    `SELECT asset.*,
            asset.created_at AS library_created_at
       FROM three_d_assets asset
      WHERE asset.status = 'READY'
        AND asset.owner_user_id = $1
      ORDER BY asset.created_at DESC
      LIMIT 100`,
    [ownerUserId]
  );
  return rows
    .sort((left, right) => new Date(right.library_created_at) - new Date(left.library_created_at))
    .map(serializeAsset);
};

const deleteThreeDAsset = async (assetId, ownerUserId, { allowAnyOwner = false } = {}) => {
  const asset = await getThreeDAsset(assetId);
  if (!asset || (!allowAnyOwner && asset.owner_user_id !== ownerUserId)) return { deleted: false, reason: 'not_found' };
  const { rows: referenceRows } = await db.query(
    `SELECT 1 FROM modules
      WHERE builder_data::text LIKE $1
      LIMIT 1`,
    [`%${assetId}%`]
  );
  if (referenceRows.length) return { deleted: false, reason: 'referenced' };
  await db.query('DELETE FROM three_d_assets WHERE id = $1', [assetId]);
  await removeThreeDAssetDirectory(path.join(storageRoot, assetId));
  return { deleted: true };
};

const getAssetVariantPath = (asset, requestedVariant = 'desktop') => {
  const variant = requestedVariant === 'mobile' ? 'mobile' : 'desktop';
  const filePath = variant === 'mobile' ? asset.mobile_path : asset.desktop_path;
  if (!filePath) return null;
  const resolved = path.resolve(filePath);
  const expectedRoot = path.resolve(storageRoot, asset.id);
  if (resolved !== path.join(expectedRoot, `${variant}.glb`)) return null;
  return { filePath: resolved, variant };
};

const sendThreeDAssetFile = async (req, res, asset, requestedVariant = 'desktop') => {
  const resolved = getAssetVariantPath(asset, requestedVariant);
  if (!resolved || !(await fsPromises.stat(resolved.filePath).catch(() => null))) {
    return res.status(404).json({ message: 'Arquivo 3D não encontrado.' });
  }
  const etag = `"${asset.sha256}-${resolved.variant}"`;
  if (req.headers['if-none-match'] === etag) return res.status(304).end();
  res.setHeader('Content-Type', 'model/gltf-binary');
  res.setHeader('Content-Disposition', `inline; filename="${asset.id}-${resolved.variant}.glb"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.setHeader('ETag', etag);
  return fs.createReadStream(resolved.filePath).pipe(res);
};

const builderDataReferencesAsset = (builderData, assetId) => {
  if (!builderData || !assetId) return false;
  return (builderData.slides || []).some(
    (slide) => slide?.threeDScene?.enabled && slide?.threeDScene?.assetId === assetId
  );
};

const createPublicThreeDAssetToken = (assetId, moduleId, ttlSeconds = 15 * 60) => {
  const expiresAt = Math.floor(Date.now() / 1000) + Math.max(60, Number(ttlSeconds) || 900);
  const payload = `${assetId}.${moduleId}.${expiresAt}`;
  const signature = crypto.createHmac('sha256', publicTokenSecret).update(payload).digest('base64url');
  return `${expiresAt}.${signature}`;
};

const verifyPublicThreeDAssetToken = (token, assetId, moduleId) => {
  const [rawExpiresAt, signature] = String(token || '').split('.');
  const expiresAt = Number(rawExpiresAt);
  if (!Number.isInteger(expiresAt) || expiresAt < Math.floor(Date.now() / 1000) || !signature) return false;
  const payload = `${assetId}.${moduleId}.${expiresAt}`;
  const expected = crypto.createHmac('sha256', publicTokenSecret).update(payload).digest('base64url');
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
};

module.exports = {
  MAX_UPLOAD_BYTES,
  builderDataReferencesAsset,
  createPublicThreeDAssetToken,
  cleanupOrphanedThreeDAssets,
  createThreeDAssetFromRemote,
  createThreeDAssetFromRequest,
  deleteThreeDAsset,
  ensureThreeDAssetsTable,
  getThreeDAsset,
  listThreeDAssets,
  sendThreeDAssetFile,
  serializeAsset,
  verifyPublicThreeDAssetToken,
  __testing: {
    assertDocumentLimits,
    bundlePolyHavenGltf,
    inspectDocument,
    optimizeVariant,
    readDocument,
    readGlbJson
  }
};
