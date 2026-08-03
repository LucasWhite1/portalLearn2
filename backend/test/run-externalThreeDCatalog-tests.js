const assert = require('assert');

const originalFetch = global.fetch;
global.fetch = async (url) => {
  const parsed = new URL(url);
  if (parsed.hostname === 'api.polyhaven.com' && parsed.pathname === '/assets') {
    return new Response(JSON.stringify({
      football: {
        type: 2,
        name: 'Football',
        description: 'A safe CC0 ball.',
        category: 'Sports',
        tags: ['football', 'ball'],
        download_count: 100,
        thumbnail_url: 'https://cdn.polyhaven.com/asset_img/thumbs/football.png'
      }
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (parsed.hostname === 'api.polyhaven.com' && parsed.pathname === '/files/football') {
    return new Response(JSON.stringify({
      gltf: {
        '1k': {
          gltf: {
            url: 'https://dl.polyhaven.org/file/ph-assets/Models/gltf/1k/football/model.gltf',
            size: 2000,
            include: {
              'model.bin': {
                url: 'https://dl.polyhaven.org/file/ph-assets/Models/gltf/1k/football/model.bin',
                size: 4000
              }
            }
          }
        }
      }
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (parsed.hostname === 'api.sketchfab.com') {
    const query = parsed.searchParams.get('q') || '';
    return new Response(JSON.stringify({
      results: query.includes('football') ? [{
        uid: '1234567890abcdef1234567890abcdef',
        name: 'Public football',
        description: 'Safe public model',
        viewerUrl: 'https://sketchfab.com/3d-models/public-football-1234567890abcdef1234567890abcdef',
        isDownloadable: true,
        license: { label: 'CC0 Public Domain' },
        user: { displayName: 'Model Author' },
        thumbnails: {
          images: [{
            width: 256,
            url: 'https://media.sketchfab.com/models/1234567890abcdef1234567890abcdef/thumbnail.jpeg'
          }]
        },
        archives: { glb: [{ size: 5000 }] }
      }] : []
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  const fileType = parsed.searchParams.get('file_type');
  const rows = fileType === 'jpg'
    ? [{
        title: 'Modelo seguro',
        content: {
          model_url: '3d_package:safe',
          uri: 'https://3d-api.si.edu/content/document/3d_package:safe/thumb.jpg',
          file_size: 1200
        }
      }]
    : [
        {
          title: 'Modelo seguro',
          content: {
            model_url: '3d_package:safe',
            uri: 'https://3d-api.si.edu/content/document/3d_package:safe/low.glb',
            file_size: 2_000_000
          }
        },
        {
          title: 'Modelo seguro',
          content: {
            model_url: '3d_package:safe',
            uri: 'https://3d-api.si.edu/content/document/3d_package:safe/high.glb',
            file_size: 8_000_000
          }
        },
        {
          title: 'Arquivo grande',
          content: {
            model_url: '3d_package:large',
            uri: 'https://3d-api.si.edu/content/document/3d_package:large/model.glb',
            file_size: 60_000_000
          }
        },
        {
          title: 'Origem maliciosa',
          content: {
            model_url: '3d_package:evil',
            uri: 'https://example.com/model.glb',
            file_size: 1000
          }
        }
      ];
  return new Response(JSON.stringify({ rows }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
};

const {
  buildMultilingualSearchQueries,
  getExternalThreeDModel,
  isApprovedExternalModelUrl,
  isApprovedExternalThumbnailUrl,
  searchExternalThreeDModels
} = require('../src/externalThreeDCatalog');

(async () => {
  const owner = 'owner-1';
  const items = await searchExternalThreeDModels(owner, 'seguro');
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].title, 'Modelo seguro');
  assert.strictEqual(items[0].size, 8_000_000);
  assert.strictEqual(items[0].uri, undefined);
  assert.ok(items[0].thumbnailUrl.startsWith('/api/admin/3d-catalog/'));
  const privateItem = getExternalThreeDModel(owner, items[0].id);
  assert.ok(privateItem.uri.endsWith('/high.glb'));
  assert.strictEqual(getExternalThreeDModel('owner-2', items[0].id), null);

  const mixedItems = await searchExternalThreeDModels(owner, 'football');
  const polyItem = mixedItems.find((item) => item.providerCredit === 'Poly Haven · CC0');
  assert.ok(polyItem);
  assert.strictEqual(polyItem.preview3d, false);
  assert.strictEqual(polyItem.uri, undefined);
  const privatePolyItem = getExternalThreeDModel(owner, polyItem.id);
  assert.strictEqual(privatePolyItem.provider, 'POLY_HAVEN');
  assert.strictEqual(privatePolyItem.resources.length, 1);
  assert.ok(isApprovedExternalModelUrl(privatePolyItem.uri, 'POLY_HAVEN'));
  assert.ok(isApprovedExternalThumbnailUrl(
    'https://cdn.polyhaven.com/asset_img/thumbs/football.png',
    'POLY_HAVEN'
  ));
  assert.strictEqual(isApprovedExternalModelUrl('https://example.com/model.gltf', 'POLY_HAVEN'), false);

  const translated = buildMultilingualSearchQueries('cadeira de escritório');
  assert.ok(translated.includes('chair office'));
  assert.ok(translated.includes('silla oficina'));
  const sketchfabItem = mixedItems.find((item) => item.externalOpenUrl);
  assert.ok(sketchfabItem);
  assert.strictEqual(sketchfabItem.licenseLabel, 'CC0 Public Domain');
  assert.ok(sketchfabItem.providerCredit.includes('Model Author'));
  console.log('externalThreeDCatalog tests: ok');
})()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    global.fetch = originalFetch;
  });
