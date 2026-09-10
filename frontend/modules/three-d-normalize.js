const DEFAULT_QUATERNION = [0, 0, 0, 1];
const DEFAULT_SCENE = Object.freeze({
  schemaVersion: 1,
  enabled: false,
  assetId: '',
  primitiveType: 'cube',
  controlMode: 'teacher',
  quaternion: DEFAULT_QUATERNION,
  position: [0, 0],
  zoom: 1,
  animationIndex: -1,
  animationPlaying: false,
  animationSpeed: 1
});
const PRIMITIVES = new Set(['cube', 'sphere', 'cylinder', 'plane', 'pyramid']);
const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, Number(value) || 0));
const finiteArray = (value, length, fallback) =>
  Array.isArray(value) && value.length === length && value.every((item) => Number.isFinite(Number(item)))
    ? value.map(Number)
    : [...fallback];

export const normalizeThreeDScene = (value = {}) => ({
  ...DEFAULT_SCENE,
  ...value,
  schemaVersion: 1,
  enabled: Boolean(value?.enabled),
  assetId: String(value?.assetId || '').trim(),
  primitiveType: PRIMITIVES.has(value?.primitiveType) ? value.primitiveType : 'cube',
  controlMode: value?.controlMode === 'student' ? 'student' : 'teacher',
  quaternion: finiteArray(value?.quaternion, 4, DEFAULT_QUATERNION),
  position: finiteArray(value?.position, 2, [0, 0]).map((coordinate) => clamp(coordinate, -0.5, 0.5)),
  zoom: clamp(value?.zoom || 1, 0.5, 2.5),
  animationIndex: Number.isInteger(Number(value?.animationIndex)) ? Number(value.animationIndex) : -1,
  animationPlaying: Boolean(value?.animationPlaying),
  animationSpeed: clamp(value?.animationSpeed || 1, 0.1, 3)
});

export const normalizeThreeDAttachment = (value = null) => {
  if (!value?.enabled) return null;
  return {
    enabled: true,
    position: finiteArray(value.position, 3, [0, 0, 1.51]),
    normal: finiteArray(value.normal, 3, [0, 0, 1]),
    surfaceSize: finiteArray(value.surfaceSize, 2, [3.2, 3.2]).map((size) => clamp(size, 0.2, 20)),
    scale: clamp(value.scale || 1, 0.2, 4),
    surfaceOffset: clamp(value.surfaceOffset ?? 0.015, 0.002, 0.15),
    fallback2d: value.fallback2d && typeof value.fallback2d === 'object'
      ? { x: Number(value.fallback2d.x) || 0, y: Number(value.fallback2d.y) || 0 }
      : null
  };
};
