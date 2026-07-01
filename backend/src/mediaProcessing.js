const fs = require('fs/promises');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const { safeFetch, readResponseBuffer } = require('./security');

const execFileAsync = promisify(execFile);

ffmpeg.setFfmpegPath(ffmpegPath);

const TEMP_ROOT_DIR = path.resolve(__dirname, '../.tmp/media-processing');
const WHISPER_PATH = path.resolve(__dirname, '../whisper.cpp/build/bin/whisper-cli.exe');
const WHISPER_MODEL_PATH = path.resolve(__dirname, '../whisper.cpp/models/ggml-base.bin');
const MAX_MEDIA_BYTES = 40 * 1024 * 1024;
const allowHttpRemoteSources = !['production', 'prod'].includes(String(process.env.NODE_ENV || process.env.APP_ENV || '').toLowerCase());

const isDataUrl = (value = '') => /^data:/i.test(String(value || ''));

const sanitizeExtension = (value = '', fallback = 'bin') => {
  const normalized = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  return normalized || fallback;
};

const getExtensionFromMimeType = (mimeType = '', fallback = 'bin') => {
  const subtype = String(mimeType || '').split('/')[1] || '';
  return sanitizeExtension(subtype, fallback);
};

const parseDataUrl = (dataUrl = '') => {
  const match = String(dataUrl || '').match(/^data:([^;,]+)(;base64)?,(.*)$/i);
  if (!match) {
    throw new Error('Midia em formato invalido.');
  }
  const mimeType = match[1] || 'application/octet-stream';
  const isBase64Payload = Boolean(match[2]);
  const payload = match[3] || '';
  const buffer = isBase64Payload
    ? Buffer.from(payload, 'base64')
    : Buffer.from(decodeURIComponent(payload), 'utf8');
  if (buffer.length > MAX_MEDIA_BYTES) {
    throw new Error('A midia enviada excede o limite de 40 MB.');
  }
  return {
    mimeType,
    buffer,
    extension: getExtensionFromMimeType(mimeType),
    filename: `upload.${getExtensionFromMimeType(mimeType)}`
  };
};

const fetchRemoteMedia = async (sourceUrl, expectedType = '') => {
  const response = await safeFetch(sourceUrl, {}, {
    allowHttp: allowHttpRemoteSources,
    allowCrossOriginRedirects: true,
    timeoutMs: 30000
  });
  if (!response.ok) {
    throw new Error('Nao foi possivel baixar a midia selecionada.');
  }
  const mimeType = response.headers.get('content-type') || 'application/octet-stream';
  if (expectedType && !String(mimeType).toLowerCase().startsWith(`${expectedType.toLowerCase()}/`)) {
    throw new Error(`A URL informada nao parece ser um arquivo de ${expectedType}.`);
  }
  const extension = getExtensionFromMimeType(mimeType);
  const buffer = await readResponseBuffer(response, MAX_MEDIA_BYTES);
  return {
    mimeType,
    buffer,
    extension,
    filename: `remote.${extension}`
  };
};

const readMediaSource = async (sourceUrl, expectedType = '') => {
  if (!sourceUrl || typeof sourceUrl !== 'string') {
    throw new Error('Midia invalida.');
  }
  const source = isDataUrl(sourceUrl)
    ? parseDataUrl(sourceUrl)
    : await fetchRemoteMedia(sourceUrl, expectedType);
  if (expectedType && !String(source.mimeType).toLowerCase().startsWith(`${expectedType.toLowerCase()}/`)) {
    throw new Error(`O arquivo enviado nao eh um ${expectedType} valido.`);
  }
  return source;
};

const ensureTempRootDir = async () => {
  await fs.mkdir(TEMP_ROOT_DIR, { recursive: true });
};

const createJobDir = async () => {
  await ensureTempRootDir();
  const jobDir = path.join(TEMP_ROOT_DIR, `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  await fs.mkdir(jobDir, { recursive: true });
  return jobDir;
};

const removeDirSafe = async (dirPath) => {
  if (!dirPath) return;
  await fs.rm(dirPath, { recursive: true, force: true }).catch(() => {});
};

const bufferToDataUrl = (buffer, mimeType) => `data:${mimeType};base64,${buffer.toString('base64')}`;

const runFfmpegCommand = (command) =>
  new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback(value);
    };
    const timeout = setTimeout(() => {
      command.kill('SIGKILL');
      finish(reject, new Error('O processamento da midia excedeu o tempo permitido.'));
    }, 2 * 60 * 1000);
    command
      .on('end', () => finish(resolve))
      .on('error', (error) => finish(reject, error))
      .run();
  });

const parseTimestampToSeconds = (value = '') => {
  const match = String(value || '').trim().match(/^(\d{2}):(\d{2}):(\d{2}),(\d{3})$/);
  if (!match) {
    return 0;
  }
  const [, hh, mm, ss, ms] = match;
  return (
    Number(hh || 0) * 3600 +
    Number(mm || 0) * 60 +
    Number(ss || 0) +
    Number(ms || 0) / 1000
  );
};

const secondsToVttTimestamp = (value = 0) => {
  const safeValue = Math.max(0, Number(value) || 0);
  const hours = Math.floor(safeValue / 3600);
  const minutes = Math.floor((safeValue % 3600) / 60);
  const seconds = Math.floor(safeValue % 60);
  const milliseconds = Math.round((safeValue - Math.floor(safeValue)) * 1000);
  return [
    String(hours).padStart(2, '0'),
    String(minutes).padStart(2, '0'),
    String(seconds).padStart(2, '0')
  ].join(':') + `.${String(milliseconds).padStart(3, '0')}`;
};

const parseSrt = (srtText = '') => {
  return String(srtText || '')
    .replace(/\r/g, '')
    .split('\n\n')
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const lines = block.split('\n').map((line) => line.trim()).filter(Boolean);
      if (lines.length < 2) {
        return null;
      }
      const timeLine = lines[1].includes('-->') ? lines[1] : lines[0];
      const textLines = lines[1].includes('-->') ? lines.slice(2) : lines.slice(1);
      const [startRaw = '', endRaw = ''] = timeLine.split('-->').map((item) => item.trim());
      const text = textLines.join(' ').replace(/\s+/g, ' ').trim();
      if (!text) {
        return null;
      }
      return {
        start: Number(parseTimestampToSeconds(startRaw).toFixed(3)),
        end: Number(parseTimestampToSeconds(endRaw).toFixed(3)),
        text
      };
    })
    .filter((entry) => entry && entry.end > entry.start);
};

const buildVttFromSegments = (segments = []) => {
  const cues = segments
    .map((segment, index) => {
      return [
        String(index + 1),
        `${secondsToVttTimestamp(segment.start)} --> ${secondsToVttTimestamp(segment.end)}`,
        segment.text || ''
      ].join('\n');
    })
    .join('\n\n');
  return `WEBVTT\n\n${cues}`.trim();
};

const ensureWhisperFiles = async () => {
  await fs.access(WHISPER_PATH);
  await fs.access(WHISPER_MODEL_PATH);
};

const convertMediaToWav = async (inputPath, outputPath, sourceType = 'audio') => {
  const command = ffmpeg(inputPath);
  if (sourceType === 'video') {
    command.noVideo();
  }
  command
    .audioChannels(1)
    .audioFrequency(16000)
    .audioCodec('pcm_s16le')
    .format('wav')
    .output(outputPath);
  await runFfmpegCommand(command);
};

const extractAudioFromMediaSource = async (sourceUrl) => {
  const source = await readMediaSource(sourceUrl, 'video');
  const jobDir = await createJobDir();
  try {
    const inputPath = path.join(jobDir, `input.${source.extension || 'mp4'}`);
    const outputPath = path.join(jobDir, 'audio.mp3');
    await fs.writeFile(inputPath, source.buffer);
    const command = ffmpeg(inputPath)
      .noVideo()
      .audioCodec('libmp3lame')
      .audioBitrate('192k')
      .format('mp3')
      .output(outputPath);
    await runFfmpegCommand(command);
    const outputBuffer = await fs.readFile(outputPath);
    return {
      mimeType: 'audio/mpeg',
      audioDataUrl: bufferToDataUrl(outputBuffer, 'audio/mpeg'),
      fileName: 'audio-extraido.mp3'
    };
  } finally {
    await removeDirSafe(jobDir);
  }
};

const transcribeMediaSource = async (sourceUrl, { sourceType = 'audio', language = 'pt' } = {}) => {
  const normalizedType = sourceType === 'video' ? 'video' : 'audio';
  const source = await readMediaSource(sourceUrl, normalizedType);
  const jobDir = await createJobDir();
  try {
    await ensureWhisperFiles();
    const inputPath = path.join(jobDir, `input.${source.extension || (normalizedType === 'video' ? 'mp4' : 'mp3')}`);
    const wavPath = path.join(jobDir, 'speech.wav');
    const outputBasePath = path.join(jobDir, 'transcription');
    await fs.writeFile(inputPath, source.buffer);
    await convertMediaToWav(inputPath, wavPath, normalizedType);
    await execFileAsync(
      WHISPER_PATH,
      ['-m', WHISPER_MODEL_PATH, '-f', wavPath, '-l', language, '-otxt', '-osrt', '-of', outputBasePath],
      {
        windowsHide: true,
        timeout: 3 * 60 * 1000,
        maxBuffer: 20 * 1024 * 1024
      }
    );
    const srtPath = `${outputBasePath}.srt`;
    const txtPath = `${outputBasePath}.txt`;
    const srt = await fs.readFile(srtPath, 'utf8');
    const txt = await fs.readFile(txtPath, 'utf8').catch(() => '');
    const segments = parseSrt(srt);
    const transcript = txt.trim() || segments.map((segment) => segment.text).join(' ').trim();
    return {
      transcript,
      captions: segments,
      srt,
      vtt: buildVttFromSegments(segments),
      language
    };
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error('Whisper nao esta configurado corretamente no backend.');
    }
    throw error;
  } finally {
    await removeDirSafe(jobDir);
  }
};

module.exports = {
  extractAudioFromMediaSource,
  transcribeMediaSource,
  __test: {
    parseDataUrl,
    parseSrt,
    buildVttFromSegments,
    secondsToVttTimestamp,
    readMediaSource
  }
};
