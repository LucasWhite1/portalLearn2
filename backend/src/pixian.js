const PIXIAN_API_URL = 'https://api.pixian.ai/api/v2/remove-background';

const getPixianCredentials = () => {
  const username = process.env.PIXIAN_USERNAME || '';
  const password = process.env.PIXIAN_PASSWORD || '';
  return {
    username: username.trim(),
    password: password.trim()
  };
};

const isPixianTestModeEnabled = (override = null) => {
  if (override != null) {
    return Boolean(override);
  }
  return /^(1|true|yes)$/i.test(String(process.env.PIXIAN_TEST_MODE || '').trim());
};

const isDataUrl = (value = '') => /^data:/i.test(String(value || ''));

const parseDataUrl = (dataUrl = '') => {
  const match = String(dataUrl || '').match(/^data:([^;,]+)(;base64)?,(.*)$/i);
  if (!match) {
    throw new Error('Formato de imagem inválido.');
  }
  const mimeType = match[1] || 'application/octet-stream';
  const isBase64 = Boolean(match[2]);
  const payload = match[3] || '';
  const buffer = isBase64
    ? Buffer.from(payload, 'base64')
    : Buffer.from(decodeURIComponent(payload), 'utf8');
  const extension = mimeType.split('/')[1] || 'bin';
  return {
    mimeType,
    buffer,
    filename: `upload.${extension}`
  };
};

const fetchRemoteImage = async (sourceUrl) => {
  const response = await fetch(sourceUrl);
  if (!response.ok) {
    throw new Error('Não foi possível baixar a imagem selecionada.');
  }
  const arrayBuffer = await response.arrayBuffer();
  const mimeType = response.headers.get('content-type') || 'image/png';
  const extension = mimeType.split('/')[1] || 'png';
  return {
    mimeType,
    buffer: Buffer.from(arrayBuffer),
    filename: `remote.${extension}`
  };
};

const readImageSource = async (sourceUrl) => {
  if (!sourceUrl || typeof sourceUrl !== 'string') {
    throw new Error('Imagem inválida para remover o fundo.');
  }
  if (isDataUrl(sourceUrl)) {
    return parseDataUrl(sourceUrl);
  }
  return fetchRemoteImage(sourceUrl);
};

const removeBackgroundFromImageSource = async (sourceUrl, options = {}) => {
  const { username, password } = getPixianCredentials();
  if (!username || !password) {
    throw new Error('Credenciais da Pixian não configuradas.');
  }

  const image = await readImageSource(sourceUrl);
  const formData = new FormData();
  formData.append('image', new Blob([image.buffer], { type: image.mimeType }), image.filename);

  const requestUrl = new URL(PIXIAN_API_URL);
  if (isPixianTestModeEnabled(options.testMode)) {
    requestUrl.searchParams.set('test', 'true');
  }

  const response = await (options.fetchImpl || fetch)(requestUrl, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
    },
    body: formData,
    redirect: 'follow'
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw new Error(`Pixian respondeu ${response.status}${errorBody ? `: ${errorBody}` : ''}`);
  }

  const contentType = response.headers.get('content-type') || 'image/png';
  const resultBuffer = Buffer.from(await response.arrayBuffer());
  return {
    mimeType: contentType,
    dataUrl: `data:${contentType};base64,${resultBuffer.toString('base64')}`
  };
};

module.exports = {
  removeBackgroundFromImageSource,
  readImageSource,
  __test: {
    isDataUrl,
    parseDataUrl,
    readImageSource,
    isPixianTestModeEnabled
  }
};
