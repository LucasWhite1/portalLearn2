const crypto = require('crypto');
const { sanitizeText } = require('./security');

const SMITHSONIAN_SEARCH_ENDPOINT = 'https://3d-api.si.edu/api/v1.0/content/file/search';
const POLY_HAVEN_ASSETS_ENDPOINT = 'https://api.polyhaven.com/assets?t=models';
const POLY_HAVEN_FILES_ENDPOINT = 'https://api.polyhaven.com/files';
const POLY_HAVEN_CREDIT_URL = 'https://polyhaven.com';
const SKETCHFAB_SEARCH_ENDPOINT = 'https://api.sketchfab.com/v3/search';
const SKETCHFAB_CREDIT_URL = 'https://sketchfab.com';
const MAX_REMOTE_BYTES = 100 * 1024 * 1024;
const MAX_PROVIDER_FILE_BYTES = 40 * 1024 * 1024;
const CACHE_TTL_MS = 20 * 60 * 1000;
const PROVIDER_CACHE_TTL_MS = 30 * 60 * 1000;
const MAX_RESULTS_PER_PROVIDER = 20;
const resultCache = new Map();
let polyHavenAssetsCache = null;

const SEARCH_CONCEPTS = [
  ['cadeira', 'chair', 'silla'], ['mesa', 'table', 'mesa'], ['sofa', 'sofa', 'sofa'],
  ['cama', 'bed', 'cama'], ['armario', 'cabinet', 'armario'], ['estante', 'shelf', 'estanteria'],
  ['casa', 'house', 'casa'], ['predio', 'building', 'edificio'], ['porta', 'door', 'puerta'],
  ['janela', 'window', 'ventana'], ['ponte', 'bridge', 'puente'], ['castelo', 'castle', 'castillo'],
  ['carro', 'car', 'coche'], ['moto', 'motorcycle', 'motocicleta'], ['bicicleta', 'bicycle', 'bicicleta'],
  ['aviao', 'airplane', 'avion'], ['navio', 'ship', 'barco'], ['barco', 'boat', 'barco'],
  ['trem', 'train', 'tren'], ['onibus', 'bus', 'autobus'], ['caminhao', 'truck', 'camion'],
  ['animal', 'animal', 'animal'], ['cachorro', 'dog', 'perro'], ['gato', 'cat', 'gato'],
  ['cavalo', 'horse', 'caballo'], ['passaro', 'bird', 'pajaro'], ['peixe', 'fish', 'pez'],
  ['dinossauro', 'dinosaur', 'dinosaurio'], ['corpo', 'body', 'cuerpo'], ['coracao', 'heart', 'corazon'],
  ['cerebro', 'brain', 'cerebro'], ['esqueleto', 'skeleton', 'esqueleto'], ['celula', 'cell', 'celula'],
  ['planta', 'plant', 'planta'], ['arvore', 'tree', 'arbol'], ['flor', 'flower', 'flor'],
  ['comida', 'food', 'comida'], ['fruta', 'fruit', 'fruta'], ['bola', 'ball', 'pelota'],
  ['futebol', 'football', 'futbol'], ['esporte', 'sport', 'deporte'], ['robo', 'robot', 'robot'],
  ['computador', 'computer', 'computadora'], ['telefone', 'phone', 'telefono'],
  ['ferramenta', 'tool', 'herramienta'], ['maquina', 'machine', 'maquina'],
  ['espada', 'sword', 'espada'], ['arma', 'weapon', 'arma'], ['personagem', 'character', 'personaje'],
  ['escritorio', 'office', 'oficina'], ['cozinha', 'kitchen', 'cocina'], ['banheiro', 'bathroom', 'bano']
];
const SEARCH_STOP_WORDS = new Set(['a', 'as', 'o', 'os', 'de', 'da', 'do', 'das', 'dos', 'um', 'uma', 'the', 'of', 'el', 'la', 'los', 'las', 'del']);

const getProviderUserAgent = () =>
  String(process.env.THREE_D_CATALOG_USER_AGENT || process.env.THREE_D_STORE_USER_AGENT || process.env.ASAAS_APP_NAME || 'Criatyve-3D-Catalog/1.0');

const cleanupCache = () => {
  const now = Date.now();
  for (const [id, entry] of resultCache.entries()) {
    if (entry.expiresAt <= now) resultCache.delete(id);
  }
};

const fetchJson = async (url, timeout = 15_000) => {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(timeout),
    headers: {
      accept: 'application/json',
      'user-agent': getProviderUserAgent()
    }
  });
  if (!response.ok) throw new Error(`Catalog provider returned ${response.status}.`);
  return response.json();
};

const fetchSmithsonianRows = async ({ query = '', fileType, rows = 100, start = 0 }) => {
  const url = new URL(SMITHSONIAN_SEARCH_ENDPOINT);
  if (query) url.searchParams.set('q', sanitizeText(query, 100));
  url.searchParams.set('file_type', fileType);
  url.searchParams.set('file_size', `[0 TO ${MAX_REMOTE_BYTES}]`);
  url.searchParams.set('rows', String(Math.min(150, Math.max(1, rows))));
  if (start > 0) url.searchParams.set('start', String(start));
  const payload = await fetchJson(url);
  return Array.isArray(payload?.rows) ? payload.rows : [];
};

const normalizeSmithsonianModelKey = (row) =>
  sanitizeText(row?.content?.model_url || row?.url || '', 180);

const buildSmithsonianThumbnail = (modelKey) => (
  /^3d_package:[0-9a-f-]{36}$/i.test(modelKey)
    ? `https://3d-api.si.edu/content/document/${modelKey}/scene-image-thumb.jpg`
    : ''
);

const cacheExternalCandidate = (userId, candidate) => {
  const externalId = crypto.randomUUID();
  resultCache.set(externalId, {
    ...candidate,
    userId,
    expiresAt: Date.now() + CACHE_TTL_MS
  });
  return {
    id: externalId,
    title: candidate.title,
    description: candidate.description,
    category: candidate.category || 'Catálogo online',
    size: candidate.size,
    external: true,
    preview3d: candidate.preview3d !== false,
    providerCredit: candidate.providerCredit || null,
    providerCreditUrl: candidate.providerCreditUrl || null,
    externalOpenUrl: candidate.externalOpenUrl || null,
    author: candidate.author || null,
    licenseLabel: candidate.licenseLabel || candidate.license || null,
    thumbnailUrl: candidate.thumbnailUri
      ? `/api/admin/3d-catalog/${externalId}/thumbnail`
      : null
  };
};

const normalizeSearchToken = (value) =>
  String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

const buildMultilingualSearchQueries = (value) => {
  const original = sanitizeText(value, 100).trim();
  if (!original) return [''];
  const tokens = normalizeSearchToken(original).split(/[^a-z0-9]+/).filter((token) => token && !SEARCH_STOP_WORDS.has(token));
  const translated = [1, 2].map((languageIndex) => tokens.map((token) => {
    const concept = SEARCH_CONCEPTS.find((terms) => terms.includes(token));
    return concept?.[languageIndex] || token;
  }).join(' ').trim()).filter(Boolean);
  return [...new Set([original, ...translated])].slice(0, 3);
};

const searchSmithsonianModels = async (queries) => {
  const primaryQuery = queries[0] || '';
  const pageOffset = primaryQuery ? 0 : (Math.floor(Date.now() / 3_600_000) % 4) * 100;
  const [modelPages, imageRows] = await Promise.all([
    Promise.all(queries.flatMap((query, index) => [
      fetchSmithsonianRows({ query, fileType: 'glb', rows: index === 0 ? 100 : 60, start: index === 0 ? pageOffset : 0 })
    ])),
    fetchSmithsonianRows({ query: primaryQuery, fileType: 'jpg', rows: 150, start: pageOffset }).catch(() => [])
  ]);
  const thumbnailByModel = new Map();
  for (const row of imageRows) {
    const key = normalizeSmithsonianModelKey(row);
    const uri = sanitizeText(row?.content?.uri, 2000);
    if (!key || !isApprovedExternalThumbnailUrl(uri, 'SMITHSONIAN_OPEN_ACCESS')) continue;
    const size = Number(row?.content?.file_size || Number.MAX_SAFE_INTEGER);
    const current = thumbnailByModel.get(key);
    if (!current || size < current.size) thumbnailByModel.set(key, { uri, size });
  }
  const candidates = new Map();
  for (const row of modelPages.flat()) {
    const key = normalizeSmithsonianModelKey(row);
    const uri = sanitizeText(row?.content?.uri, 2000);
    const size = Number(row?.content?.file_size || 0);
    if (
      !key
      || !isApprovedExternalModelUrl(uri, 'SMITHSONIAN_OPEN_ACCESS')
      || !Number.isFinite(size)
      || size <= 0
      || size > MAX_PROVIDER_FILE_BYTES
    ) continue;
    const current = candidates.get(key);
    if (!current || size > current.size) {
      candidates.set(key, {
        provider: 'SMITHSONIAN_OPEN_ACCESS',
        license: 'CC0',
        title: sanitizeText(row.title || 'Modelo 3D', 120),
        description: 'Modelo de acervo aberto, validado e otimizado pela Criatyve ao importar.',
        category: 'Acervo aberto',
        uri,
        size,
        resources: [],
        preview3d: true,
        thumbnailUri: thumbnailByModel.get(key)?.uri || buildSmithsonianThumbnail(key)
      });
    }
  }
  return [...candidates.values()].slice(0, MAX_RESULTS_PER_PROVIDER);
};

const getPolyHavenAssets = async () => {
  if (polyHavenAssetsCache?.expiresAt > Date.now()) return polyHavenAssetsCache.items;
  const payload = await fetchJson(POLY_HAVEN_ASSETS_ENDPOINT, 25_000);
  const items = Object.entries(payload || {})
    .filter(([, asset]) => Number(asset?.type) === 2)
    .map(([id, asset]) => ({ id, ...asset }));
  polyHavenAssetsCache = { items, expiresAt: Date.now() + PROVIDER_CACHE_TTL_MS };
  return items;
};

const pickPolyHavenGltf = (payload) => {
  const file = payload?.gltf?.['1k']?.gltf || payload?.gltf?.['2k']?.gltf;
  if (!file?.url || !file?.include || typeof file.include !== 'object') return null;
  const resources = Object.entries(file.include).map(([relativePath, resource]) => ({
    relativePath,
    url: resource?.url,
    size: Number(resource?.size || 0)
  }));
  const size = Number(file.size || 0) + resources.reduce((total, resource) => total + resource.size, 0);
  if (
    !isApprovedExternalModelUrl(file.url, 'POLY_HAVEN')
    || resources.some((resource) =>
      !isSafeRelativeResourcePath(resource.relativePath)
      || !isApprovedExternalModelUrl(resource.url, 'POLY_HAVEN')
      || !Number.isFinite(resource.size)
      || resource.size <= 0
    )
    || !Number.isFinite(size)
    || size <= 0
    || size > MAX_REMOTE_BYTES
  ) return null;
  return { uri: file.url, resources, size };
};

const searchPolyHavenModels = async (queries) => {
  const words = queries.flatMap((query) => normalizeSearchToken(query).split(/\s+/)).filter(Boolean);
  const assets = await getPolyHavenAssets();
  const matching = assets
    .filter((asset) => {
      if (!words.length) return true;
      const haystack = [
        asset.name,
        asset.description,
        asset.category,
        ...(Array.isArray(asset.tags) ? asset.tags : [])
      ].join(' ').toLowerCase();
      return words.some((word) => haystack.includes(word));
    })
    .sort((a, b) => Number(b.download_count || 0) - Number(a.download_count || 0))
    .slice(0, MAX_RESULTS_PER_PROVIDER);
  const candidates = await Promise.all(matching.map(async (asset) => {
    try {
      const files = await fetchJson(`${POLY_HAVEN_FILES_ENDPOINT}/${encodeURIComponent(asset.id)}`, 20_000);
      const selected = pickPolyHavenGltf(files);
      if (!selected) return null;
      return {
        provider: 'POLY_HAVEN',
        license: 'CC0',
        sourceAssetId: asset.id,
        title: sanitizeText(asset.name || 'Modelo 3D', 120),
        description: sanitizeText(asset.description || 'Modelo CC0 pronto para importar.', 260),
        category: `Poly Haven · ${sanitizeText(asset.category || 'Modelos CC0', 64)}`,
        thumbnailUri: sanitizeText(asset.thumbnail_url, 2000),
        preview3d: false,
        providerCredit: 'Poly Haven · CC0',
        providerCreditUrl: POLY_HAVEN_CREDIT_URL,
        ...selected
      };
    } catch {
      return null;
    }
  }));
  return candidates.filter(Boolean);
};

const pickSketchfabThumbnail = (model) => {
  const images = Array.isArray(model?.thumbnails?.images) ? model.thumbnails.images : [];
  return [...images].sort((a, b) => Number(a.width || 0) - Number(b.width || 0))
    .find((image) => Number(image.width || 0) >= 256)?.url || images.at(-1)?.url || '';
};

const searchSketchfabModels = async (queries) => {
  if (!queries.some(Boolean)) return [];
  const pages = await Promise.all(queries.map(async (query) => {
    const url = new URL(SKETCHFAB_SEARCH_ENDPOINT);
    url.searchParams.set('type', 'models');
    url.searchParams.set('q', query);
    url.searchParams.set('downloadable', 'true');
    url.searchParams.set('license', 'cc0');
    url.searchParams.set('count', '12');
    url.searchParams.set('archives_flavours', 'true');
    const payload = await fetchJson(url, 20_000);
    return Array.isArray(payload?.results) ? payload.results : [];
  }));
  const unique = new Map();
  for (const model of pages.flat()) {
    const uid = sanitizeText(model?.uid, 64);
    const viewerUrl = sanitizeText(model?.viewerUrl, 2000);
    const thumbnailUri = sanitizeText(pickSketchfabThumbnail(model), 2000);
    const smallestGlb = [...(Array.isArray(model?.archives?.glb) ? model.archives.glb : [])]
      .sort((a, b) => Number(a.size || 0) - Number(b.size || 0))[0];
    if (
      !/^[a-f0-9]{32}$/i.test(uid)
      || !isApprovedExternalOpenUrl(viewerUrl, 'SKETCHFAB')
      || !isApprovedExternalThumbnailUrl(thumbnailUri, 'SKETCHFAB')
      || model?.license?.label !== 'CC0 Public Domain'
      || model?.isDownloadable !== true
    ) continue;
    unique.set(uid, {
      provider: 'SKETCHFAB',
      license: 'CC0',
      licenseLabel: 'CC0 Public Domain',
      title: sanitizeText(model.name || 'Modelo 3D', 120),
      description: sanitizeText(model.description || 'Modelo disponível para download no Sketchfab.', 260),
      category: 'Sketchfab · CC0',
      size: Number(smallestGlb?.size || 0),
      thumbnailUri,
      preview3d: false,
      externalOpenUrl: viewerUrl,
      author: sanitizeText(model?.user?.displayName || model?.user?.username || 'Autor do modelo', 100),
      providerCredit: `Sketchfab · ${sanitizeText(model?.user?.displayName || model?.user?.username || 'autor', 80)}`,
      providerCreditUrl: viewerUrl,
      sourceAssetId: uid
    });
  }
  return [...unique.values()].slice(0, MAX_RESULTS_PER_PROVIDER);
};

const searchExternalThreeDModels = async (userId, query = '') => {
  cleanupCache();
  const queries = buildMultilingualSearchQueries(query);
  const providerResults = await Promise.allSettled([
    searchSmithsonianModels(queries),
    searchPolyHavenModels(queries),
    searchSketchfabModels(queries)
  ]);
  const candidates = providerResults.flatMap((result) =>
    result.status === 'fulfilled' ? result.value : []
  );
  if (!candidates.length && providerResults.every((result) => result.status === 'rejected')) {
    throw Object.assign(new Error('O catálogo online de modelos está temporariamente indisponível.'), {
      statusCode: 502
    });
  }
  return candidates.map((candidate) => cacheExternalCandidate(userId, candidate));
};

const getExternalThreeDModel = (userId, externalId) => {
  cleanupCache();
  const entry = resultCache.get(String(externalId || ''));
  if (!entry || entry.userId !== userId || entry.expiresAt <= Date.now()) return null;
  return entry;
};

const isSafeRelativeResourcePath = (value) => {
  const normalized = String(value || '').replace(/\\/g, '/');
  return Boolean(normalized)
    && !normalized.startsWith('/')
    && !normalized.includes('../')
    && !normalized.includes('\0')
    && /^[a-z0-9_./ -]+$/i.test(normalized);
};

const isApprovedExternalThumbnailUrl = (value, provider) => {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:') return false;
    if (provider === 'POLY_HAVEN') {
      return url.hostname === 'cdn.polyhaven.com' && url.pathname.startsWith('/asset_img/');
    }
    if (provider === 'SKETCHFAB') {
      return url.hostname === 'media.sketchfab.com' && url.pathname.startsWith('/models/');
    }
    return url.hostname === '3d-api.si.edu' && url.pathname.startsWith('/content/document/');
  } catch {
    return false;
  }
};

const isApprovedExternalOpenUrl = (value, provider) => {
  try {
    const url = new URL(String(value || ''));
    return provider === 'SKETCHFAB'
      && url.protocol === 'https:'
      && url.hostname === 'sketchfab.com'
      && url.pathname.startsWith('/3d-models/');
  } catch {
    return false;
  }
};

const isApprovedExternalModelUrl = (value, provider) => {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:') return false;
    if (provider === 'POLY_HAVEN') {
      return url.hostname === 'dl.polyhaven.org' && url.pathname.startsWith('/file/ph-assets/Models/');
    }
    return url.hostname === '3d-api.si.edu' && url.pathname.startsWith('/content/document/');
  } catch {
    return false;
  }
};

module.exports = {
  buildMultilingualSearchQueries,
  getExternalThreeDModel,
  getProviderUserAgent,
  isApprovedExternalModelUrl,
  isApprovedExternalOpenUrl,
  isApprovedExternalThumbnailUrl,
  isSafeRelativeResourcePath,
  searchExternalThreeDModels
};
