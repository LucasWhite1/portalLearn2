import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { CSS3DObject, CSS3DRenderer } from 'three/addons/renderers/CSS3DRenderer.js';

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
const INTERACTIVE_SELECTOR = 'button,input,textarea,select,a,audio,video,[contenteditable="true"],[data-3d-interactive="true"]';
const CSS3D_WORLD_PER_PIXEL = 0.0052;

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
      ? {
          x: Number(value.fallback2d.x) || 0,
          y: Number(value.fallback2d.y) || 0
        }
      : null
  };
};

export const getThreeDAttachmentPixelLimits = (value = null) => {
  const attachment = normalizeThreeDAttachment(value);
  if (!attachment) return null;
  const worldPerPixel = CSS3D_WORLD_PER_PIXEL * attachment.scale;
  return {
    width: Math.max(40, Math.floor((attachment.surfaceSize[0] * 0.94) / worldPerPixel)),
    height: Math.max(40, Math.floor((attachment.surfaceSize[1] * 0.94) / worldPerPixel))
  };
};

export const interpolateThreeDAttachment = (fromValue, toValue, progress = 0) => {
  const from = normalizeThreeDAttachment(fromValue);
  const to = normalizeThreeDAttachment(toValue);
  if (!from || !to) return from || to || null;
  const amount = clamp(progress, 0, 1);
  const lerp = (start, end) => start + (end - start) * amount;
  const normal = new THREE.Vector3(
    lerp(from.normal[0], to.normal[0]),
    lerp(from.normal[1], to.normal[1]),
    lerp(from.normal[2], to.normal[2])
  );
  if (normal.lengthSq() < 0.000001) normal.set(...from.normal);
  normal.normalize();
  return normalizeThreeDAttachment({
    enabled: true,
    position: from.position.map((value, index) => lerp(value, to.position[index])),
    normal: normal.toArray(),
    surfaceSize: from.surfaceSize.map((value, index) => lerp(value, to.surfaceSize[index])),
    scale: lerp(from.scale, to.scale),
    surfaceOffset: lerp(from.surfaceOffset, to.surfaceOffset),
    fallback2d: from.fallback2d || to.fallback2d || null
  });
};

const getPrimitiveGeometry = (type) => {
  switch (type) {
    case 'sphere':
      return new THREE.SphereGeometry(1.65, 48, 32);
    case 'cylinder':
      return new THREE.CylinderGeometry(1.45, 1.45, 3.2, 48);
    case 'plane':
      return new THREE.PlaneGeometry(4.4, 3.1, 1, 1);
    case 'pyramid':
      return new THREE.ConeGeometry(1.9, 3.4, 4);
    case 'cube':
    default:
      return new THREE.BoxGeometry(3.2, 3.2, 3.2);
  }
};

const disposeObject = (object) => {
  object?.traverse?.((child) => {
    child.geometry?.dispose?.();
    const materials = Array.isArray(child.material) ? child.material : [child.material].filter(Boolean);
    materials.forEach((material) => {
      Object.values(material || {}).forEach((value) => {
        if (value?.isTexture) value.dispose();
      });
      material?.dispose?.();
    });
  });
};

const getDeviceProfile = () => {
  const mobile = window.matchMedia?.('(max-width: 800px)').matches || /Android|iPhone|iPad/i.test(navigator.userAgent);
  const weakDevice = Number(navigator.deviceMemory || 8) <= 4 || Number(navigator.hardwareConcurrency || 8) <= 4;
  return {
    mobile,
    weakDevice,
    variant: mobile || weakDevice ? 'mobile' : 'desktop',
    pixelRatio: Math.min(window.devicePixelRatio || 1, mobile ? 1 : 1.5),
    maxFps: weakDevice ? 15 : mobile ? 24 : 30
  };
};

const createThreeDFallbackController = () => {
  let stageNode = null;
  const notice = document.createElement('div');
  notice.className = 'three-d-static-fallback';
  notice.innerHTML = '<strong>Visualização 3D indisponível</strong><span>Este aparelho exibirá os elementos no modo plano.</span>';
  return {
    attachElement(node, element) {
      if (!stageNode || !node) return false;
      node.style.left = `${Number(element?.attachment3d?.fallback2d?.x ?? element?.x) || 0}px`;
      node.style.top = `${Number(element?.attachment3d?.fallback2d?.y ?? element?.y) || 0}px`;
      stageNode.appendChild(node);
      return true;
    },
    beginAnchorPick: () => false,
    cancelAnchorPick() {},
    captureCanvas: () => null,
    destroy() {
      notice.remove();
      stageNode = null;
    },
    getAnimationNames: () => [],
    getProfile: () => ({ mobile: true, weakDevice: true, variant: 'mobile', pixelRatio: 1, maxFps: 0 }),
    moveAttachedElement: () => null,
    async mount(nextStageNode) {
      stageNode = nextStageNode;
      stageNode?.prepend(notice);
      return true;
    },
    normalizeScene: normalizeThreeDScene,
    requestRender() {},
    resize() {},
    setSceneState() {},
    unmount() {
      notice.remove();
      stageNode = null;
    }
  };
};

export const createThreeDStageController = ({
  mode = 'viewer',
  loadAssetBuffer,
  onSceneChange,
  onAnchorPicked,
  canControl = () => true,
  shouldAnimateAttachedElement = () => mode !== 'creator',
  onTransformInteraction,
  onRender
} = {}) => {
  const profile = getDeviceProfile();
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.01, 100);
  camera.position.set(0, 0, 8.2);
  let webglRenderer;
  try {
    webglRenderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: !profile.mobile,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true
    });
  } catch (error) {
    console.warn('WebGL indisponível; usando fallback estático.', error);
    return createThreeDFallbackController();
  }
  webglRenderer.setPixelRatio(profile.pixelRatio);
  webglRenderer.outputColorSpace = THREE.SRGBColorSpace;
  webglRenderer.domElement.className = 'three-d-webgl-layer';
  webglRenderer.domElement.setAttribute('aria-label', 'Cenário 3D interativo');

  const cssRenderer = new CSS3DRenderer();
  cssRenderer.domElement.className = 'three-d-css-layer';
  cssRenderer.domElement.setAttribute('aria-hidden', 'false');

  const modelRoot = new THREE.Group();
  const cssRoot = new THREE.Group();
  scene.add(modelRoot, cssRoot);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x253152, 2.5));
  const keyLight = new THREE.DirectionalLight(0xffffff, 3.2);
  keyLight.position.set(4, 6, 7);
  scene.add(keyLight);
  const fillLight = new THREE.DirectionalLight(0x8ab4ff, 1.4);
  fillLight.position.set(-5, -2, 4);
  scene.add(fillLight);

  let stageNode = null;
  let activeSlide = null;
  let activeScene = normalizeThreeDScene();
  let activeFingerprint = '';
  let activeLoadFingerprint = '';
  let activeLoadPromise = null;
  let modelObject = null;
  let mixer = null;
  let animations = [];
  let animationFrame = 0;
  let lastFrameAt = 0;
  let lastRenderAt = 0;
  let needsRender = true;
  let destroyed = false;
  let loadingSequence = 0;
  let anchoringElementId = '';
  let pointerState = null;
  const clock = new THREE.Clock();
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const anchoredObjects = new Map();

  const syncRootTransform = () => {
    const quaternion = new THREE.Quaternion(...activeScene.quaternion).normalize();
    modelRoot.quaternion.copy(quaternion);
    cssRoot.quaternion.copy(quaternion);
    camera.position.z = 8.2 / activeScene.zoom;
    const viewHeight = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * camera.position.z;
    const viewWidth = viewHeight * camera.aspect;
    const rootX = activeScene.position[0] * viewWidth;
    const rootY = -activeScene.position[1] * viewHeight;
    modelRoot.position.set(rootX, rootY, 0);
    cssRoot.position.copy(modelRoot.position);
  };

  const applySceneToSlide = ({ transient = false } = {}) => {
    if (!activeSlide) return;
    activeSlide.threeDScene = {
      ...activeScene,
      quaternion: modelRoot.quaternion.toArray(),
      position: [...activeScene.position],
      zoom: clamp(8.2 / camera.position.z, 0.5, 2.5)
    };
    activeScene = normalizeThreeDScene(activeSlide.threeDScene);
    onSceneChange?.(activeScene, { transient });
  };

  const requestRender = () => {
    needsRender = true;
    if (!animationFrame && !destroyed) {
      animationFrame = requestAnimationFrame(renderLoop);
    }
  };

  const projectAttachmentToModelSurface = (attachment) => {
    if (!modelObject || !attachment) return attachment;
    const radialDirection = new THREE.Vector3(...attachment.position);
    if (radialDirection.lengthSq() < 0.000001) radialDirection.set(...attachment.normal);
    radialDirection.normalize();
    modelRoot.updateMatrixWorld(true);
    const origin = modelRoot.localToWorld(radialDirection.clone().multiplyScalar(20));
    const target = modelRoot.localToWorld(new THREE.Vector3());
    raycaster.set(origin, target.sub(origin).normalize());
    const intersection = raycaster.intersectObject(modelObject, true)[0];
    if (!intersection) return attachment;
    const localPosition = modelRoot.worldToLocal(intersection.point.clone());
    let localNormal = new THREE.Vector3(...attachment.normal).normalize();
    if (intersection.face?.normal && intersection.object?.matrixWorld) {
      const normalMatrix = new THREE.Matrix3().getNormalMatrix(intersection.object.matrixWorld);
      const worldNormal = intersection.face.normal.clone().applyNormalMatrix(normalMatrix).normalize();
      localNormal = worldNormal.transformDirection(modelRoot.matrixWorld.clone().invert()).normalize();
    }
    return normalizeThreeDAttachment({
      ...attachment,
      position: localPosition.toArray(),
      normal: localNormal.toArray()
    });
  };

  const getMotionFrameStyle = (fromFrame, toFrame, progress) => {
    const amount = clamp(progress, 0, 1);
    const lerp = (start, end) => start + (end - start) * amount;
    return {
      width: lerp(Number(fromFrame.width) || 40, Number(toFrame.width) || 40),
      height: lerp(Number(fromFrame.height) || 40, Number(toFrame.height) || 40),
      rotation: lerp(Number(fromFrame.rotation) || 0, Number(toFrame.rotation) || 0),
      opacity: lerp(Number(fromFrame.opacity ?? 1), Number(toFrame.opacity ?? 1))
    };
  };

  const updateAttachedMotionAnimations = (timestamp) => {
    let hasActiveMotion = false;
    anchoredObjects.forEach((entry) => {
      const motion = entry.motion;
      if (!motion || motion.finished || motion.frames.length < 2) return;
      const elapsed = timestamp - motion.startedAt - motion.delay;
      let progress = 0;
      if (elapsed < 0) {
        hasActiveMotion = true;
      } else if (motion.loop) {
        progress = (elapsed % motion.duration) / motion.duration;
        hasActiveMotion = true;
      } else {
        progress = clamp(elapsed / motion.duration, 0, 1);
        hasActiveMotion = hasActiveMotion || progress < 1;
        motion.finished = progress >= 1;
      }
      const framePosition = progress * (motion.frames.length - 1);
      const fromIndex = Math.min(Math.floor(framePosition), motion.frames.length - 1);
      const toIndex = Math.min(fromIndex + 1, motion.frames.length - 1);
      const segmentProgress = framePosition - fromIndex;
      const fromFrame = motion.frames[fromIndex];
      const toFrame = motion.frames[toIndex];
      const interpolated = interpolateThreeDAttachment(
        fromFrame.attachment3d,
        toFrame.attachment3d,
        segmentProgress
      );
      applyAttachmentToAnchoredObject(
        entry,
        projectAttachmentToModelSurface(interpolated),
        {
          persist: false,
          frameStyle: getMotionFrameStyle(fromFrame, toFrame, segmentProgress)
        }
      );
      needsRender = true;
    });
    return hasActiveMotion;
  };

  const updateAnchorVisibility = () => {
    if (!modelObject) return;
    modelRoot.updateMatrixWorld(true);
    cssRoot.updateMatrixWorld(true);
    anchoredObjects.forEach(({ object, attachment }) => {
      const localPosition = new THREE.Vector3(...attachment.position);
      const worldPosition = modelRoot.localToWorld(localPosition.clone());
      const localNormal = new THREE.Vector3(...attachment.normal).normalize();
      const worldNormal = localNormal.transformDirection(modelRoot.matrixWorld);
      const towardCamera = camera.position.clone().sub(worldPosition).normalize();
      let visible = worldNormal.dot(towardCamera) > 0.025;
      if (visible) {
        const distance = camera.position.distanceTo(worldPosition);
        raycaster.set(camera.position, worldPosition.clone().sub(camera.position).normalize());
        const intersections = raycaster.intersectObject(modelObject, true);
        if (intersections.length && intersections[0].distance < distance - 0.035) visible = false;
      }
      object.element.style.visibility = visible ? 'visible' : 'hidden';
      object.element.style.pointerEvents = visible ? 'auto' : 'none';
    });
  };

  function renderLoop(timestamp) {
    animationFrame = 0;
    if (destroyed || !stageNode || document.hidden) return;
    const minimumFrameMs = 1000 / profile.maxFps;
    const modelAnimationActive = Boolean(mixer && activeScene.animationPlaying);
    const attachedAnimationPending = Array.from(anchoredObjects.values()).some((entry) => entry.motion && !entry.motion.finished);
    if (timestamp - lastRenderAt < minimumFrameMs && (needsRender || modelAnimationActive || attachedAnimationPending)) {
      animationFrame = requestAnimationFrame(renderLoop);
      return;
    }
    const delta = Math.min(0.1, Math.max(0, (timestamp - (lastFrameAt || timestamp)) / 1000));
    lastFrameAt = timestamp;
    if (modelAnimationActive) {
      mixer.timeScale = activeScene.animationSpeed;
      mixer.update(delta);
      needsRender = true;
    }
    const attachedAnimationActive = updateAttachedMotionAnimations(timestamp);
    if (needsRender || modelAnimationActive || attachedAnimationActive) {
      updateAnchorVisibility();
      webglRenderer.render(scene, camera);
      cssRenderer.render(scene, camera);
      onRender?.();
      needsRender = false;
      lastRenderAt = timestamp;
    }
    if (modelAnimationActive || attachedAnimationActive || needsRender) animationFrame = requestAnimationFrame(renderLoop);
  }

  const clearAnchors = () => {
    anchoredObjects.forEach(({ object }) => {
      object.removeFromParent();
      object.element.remove();
    });
    anchoredObjects.clear();
  };

  const clearModel = () => {
    if (mixer) {
      mixer.stopAllAction();
      mixer.uncacheRoot(modelObject);
    }
    mixer = null;
    animations = [];
    if (modelObject) {
      modelObject.removeFromParent();
      disposeObject(modelObject);
      modelObject = null;
    }
    while (modelRoot.children.length) modelRoot.remove(modelRoot.children[0]);
  };

  const normalizeModelBounds = (object) => {
    object.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(object);
    if (bounds.isEmpty()) return;
    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    const maximum = Math.max(size.x, size.y, size.z, 0.001);
    object.position.sub(center);
    object.scale.setScalar(4.2 / maximum);
  };

  const applyAnimationState = () => {
    if (!mixer) return;
    mixer.stopAllAction();
    if (activeScene.animationIndex >= 0 && animations[activeScene.animationIndex]) {
      const action = mixer.clipAction(animations[activeScene.animationIndex]);
      action.reset().play();
      action.paused = !activeScene.animationPlaying;
    }
  };

  const setModel = (object, clips = []) => {
    clearModel();
    modelObject = object;
    normalizeModelBounds(modelObject);
    modelRoot.add(modelObject);
    animations = Array.isArray(clips) ? clips : [];
    if (animations.length) {
      mixer = new THREE.AnimationMixer(modelObject);
      applyAnimationState();
    }
    requestRender();
  };

  const remapAnchorsToCurrentModel = () => {
    if (!modelObject) return;
    anchoredObjects.forEach((entry) => {
      const projectedAttachment = projectAttachmentToModelSurface(entry.attachment);
      if (!projectedAttachment) return;
      applyAttachmentToAnchoredObject(entry, projectedAttachment, { persist: false });
      entry.object.element.style.visibility = 'visible';
      entry.object.element.style.pointerEvents = 'auto';
    });
    requestRender();
  };

  const loadCurrentModel = async () => {
    const fingerprint = `${activeScene.assetId}|${activeScene.primitiveType}`;
    if (fingerprint === activeFingerprint && modelObject) return;
    if (fingerprint === activeLoadFingerprint && activeLoadPromise) {
      return activeLoadPromise;
    }
    const sequence = ++loadingSequence;
    activeFingerprint = fingerprint;
    activeLoadFingerprint = fingerprint;
    clearModel();
    activeLoadPromise = (async () => {
      if (activeScene.assetId) {
        try {
          let gltf = null;
          const variants = profile.variant === 'mobile' ? ['mobile', 'desktop'] : ['desktop'];
          let lastError = null;
          for (const variant of variants) {
            try {
              const buffer = await loadAssetBuffer?.(activeScene.assetId, variant);
              if (sequence !== loadingSequence || !buffer) return;
              const loader = new GLTFLoader();
              const dracoLoader = new DRACOLoader();
              const vendorOrigin = String(window.__THREE_VENDOR_ORIGIN__ || '');
              dracoLoader.setDecoderPath(`${vendorOrigin}/vendor/three/examples/jsm/libs/draco/gltf/`);
              loader.setDRACOLoader(dracoLoader);
              loader.setMeshoptDecoder(MeshoptDecoder);
              try {
                gltf = await new Promise((resolve, reject) => {
                  loader.parse(buffer, '', resolve, reject);
                });
              } finally {
                dracoLoader.dispose();
              }
              break;
            } catch (error) {
              lastError = error;
            }
          }
          if (!gltf) throw lastError || new Error('Nenhuma variante válida do modelo foi encontrada.');
          if (sequence !== loadingSequence) {
            disposeObject(gltf.scene);
            return;
          }
          stageNode?.classList.remove('three-d-load-failed');
          setModel(gltf.scene, gltf.animations);
        } catch (error) {
          console.error('Falha ao carregar modelo 3D', error);
          stageNode?.classList.add('three-d-load-failed');
          setModel(
            new THREE.Mesh(
              getPrimitiveGeometry('cube'),
              new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.65, metalness: 0.05 })
            )
          );
          remapAnchorsToCurrentModel();
        }
        return;
      }
      const material = new THREE.MeshStandardMaterial({
        color: 0x30c985,
        roughness: 0.48,
        metalness: 0.08,
        side: activeScene.primitiveType === 'plane' ? THREE.DoubleSide : THREE.FrontSide
      });
      setModel(new THREE.Mesh(getPrimitiveGeometry(activeScene.primitiveType), material));
    })();
    try {
      await activeLoadPromise;
    } finally {
      if (activeLoadFingerprint === fingerprint) {
        activeLoadFingerprint = '';
        activeLoadPromise = null;
      }
    }
  };

  const resize = () => {
    if (!stageNode) return;
    const width = Math.max(1, stageNode.clientWidth || 1280);
    const height = Math.max(1, stageNode.clientHeight || 720);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    syncRootTransform();
    webglRenderer.setSize(width, height, false);
    cssRenderer.setSize(width, height);
    requestRender();
  };

  const setPointerFromEvent = (event) => {
    const rect = webglRenderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  };

  const resolveAttachmentFromPointer = (event) => {
    if (!modelObject) return null;
    setPointerFromEvent(event);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObject(modelObject, true)[0];
    if (!hit?.face) return null;
    const localPosition = modelRoot.worldToLocal(hit.point.clone());
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld);
    const worldNormal = hit.face.normal.clone().applyMatrix3(normalMatrix).normalize();
    const inverseRoot = new THREE.Matrix3().getNormalMatrix(modelRoot.matrixWorld).invert();
    const localNormal = worldNormal.applyMatrix3(inverseRoot).normalize();
    const surfaceQuaternion = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 0, 1),
      localNormal
    );
    const tangent = new THREE.Vector3(1, 0, 0).applyQuaternion(surfaceQuaternion).normalize();
    const bitangent = new THREE.Vector3(0, 1, 0).applyQuaternion(surfaceQuaternion).normalize();
    const geometryBounds = hit.object.geometry?.boundingBox
      || (hit.object.geometry?.computeBoundingBox?.(), hit.object.geometry?.boundingBox);
    const projectedX = [];
    const projectedY = [];
    if (geometryBounds) {
      for (const x of [geometryBounds.min.x, geometryBounds.max.x]) {
        for (const y of [geometryBounds.min.y, geometryBounds.max.y]) {
          for (const z of [geometryBounds.min.z, geometryBounds.max.z]) {
            const localCorner = new THREE.Vector3(x, y, z);
            hit.object.localToWorld(localCorner);
            modelRoot.worldToLocal(localCorner);
            projectedX.push(localCorner.dot(tangent));
            projectedY.push(localCorner.dot(bitangent));
          }
        }
      }
    }
    if (!projectedX.length) {
      const modelBounds = new THREE.Box3().setFromObject(hit.object);
      for (const x of [modelBounds.min.x, modelBounds.max.x]) {
        for (const y of [modelBounds.min.y, modelBounds.max.y]) {
          for (const z of [modelBounds.min.z, modelBounds.max.z]) {
            const localCorner = modelRoot.worldToLocal(new THREE.Vector3(x, y, z));
            projectedX.push(localCorner.dot(tangent));
            projectedY.push(localCorner.dot(bitangent));
          }
        }
      }
    }
    const surfaceSize = [
      Math.max(0.2, Math.max(...projectedX) - Math.min(...projectedX)),
      Math.max(0.2, Math.max(...projectedY) - Math.min(...projectedY))
    ];
    return {
      enabled: true,
      position: localPosition.toArray(),
      normal: localNormal.toArray(),
      surfaceSize,
      scale: 1,
      surfaceOffset: 0.015
    };
  };

  const pickAnchor = (event) => {
    if (!anchoringElementId) return false;
    const attachment = resolveAttachmentFromPointer(event);
    if (!attachment) return false;
    onAnchorPicked?.(anchoringElementId, attachment);
    anchoringElementId = '';
    stageNode.classList.remove('is-picking-3d-anchor');
    requestRender();
    return true;
  };

  const projectPointerToArcball = (event) => {
    const rect = webglRenderer.domElement.getBoundingClientRect();
    const radius = Math.max(1, Math.min(rect.width, rect.height) / 2);
    const x = (event.clientX - (rect.left + rect.width / 2)) / radius;
    const y = ((rect.top + rect.height / 2) - event.clientY) / radius;
    const distanceSquared = x * x + y * y;
    const z = distanceSquared <= 0.5
      ? Math.sqrt(1 - distanceSquared)
      : 0.5 / Math.sqrt(distanceSquared);
    return new THREE.Vector3(x, y, z).normalize();
  };

  const onPointerDown = (event) => {
    if (event.button !== 0 || event.target.closest?.(INTERACTIVE_SELECTOR)) return;
    if (pickAnchor(event)) {
      event.preventDefault();
      return;
    }
    if (!canControl(activeScene)) return;
    pointerState = {
      id: event.pointerId,
      mode: event.shiftKey ? 'pan' : 'rotate',
      vector: event.shiftKey ? null : projectPointerToArcball(event),
      startClientX: event.clientX,
      startClientY: event.clientY,
      startPosition: [...activeScene.position],
      moved: false
    };
    webglRenderer.domElement.setPointerCapture?.(event.pointerId);
    onTransformInteraction?.('start', activeScene);
  };

  const onPointerMove = (event) => {
    if (!pointerState || pointerState.id !== event.pointerId) return;
    if (pointerState.mode === 'pan') {
      const rect = webglRenderer.domElement.getBoundingClientRect();
      activeScene.position = [
        clamp(pointerState.startPosition[0] + (event.clientX - pointerState.startClientX) / Math.max(1, rect.width), -0.5, 0.5),
        clamp(pointerState.startPosition[1] + (event.clientY - pointerState.startClientY) / Math.max(1, rect.height), -0.5, 0.5)
      ];
      pointerState.moved = true;
      syncRootTransform();
      applySceneToSlide({ transient: true });
      onTransformInteraction?.('move', activeScene);
      requestRender();
      return;
    }
    const currentVector = projectPointerToArcball(event);
    const angle = pointerState.vector.angleTo(currentVector);
    if (angle < 0.0001) return;
    const deltaRotation = new THREE.Quaternion().setFromUnitVectors(pointerState.vector, currentVector);
    pointerState.vector.copy(currentVector);
    pointerState.moved = true;
    modelRoot.quaternion.premultiply(deltaRotation).normalize();
    cssRoot.quaternion.copy(modelRoot.quaternion);
    activeScene.quaternion = modelRoot.quaternion.toArray();
    applySceneToSlide({ transient: true });
    onTransformInteraction?.('move', activeScene);
    requestRender();
  };

  const finishPointer = (event) => {
    if (!pointerState || pointerState.id !== event.pointerId) return;
    webglRenderer.domElement.releasePointerCapture?.(event.pointerId);
    pointerState = null;
    applySceneToSlide({ transient: false });
    onTransformInteraction?.('end', activeScene);
  };

  const onWheel = (event) => {
    if (!canControl(activeScene) || event.target.closest?.(INTERACTIVE_SELECTOR)) return;
    event.preventDefault();
    activeScene.zoom = clamp(activeScene.zoom * (event.deltaY > 0 ? 0.92 : 1.08), 0.5, 2.5);
    camera.position.z = 8.2 / activeScene.zoom;
    applySceneToSlide({ transient: true });
    onTransformInteraction?.('move', activeScene);
    requestRender();
  };

  webglRenderer.domElement.addEventListener('pointerdown', onPointerDown);
  webglRenderer.domElement.addEventListener('pointermove', onPointerMove);
  webglRenderer.domElement.addEventListener('pointerup', finishPointer);
  webglRenderer.domElement.addEventListener('pointercancel', finishPointer);
  webglRenderer.domElement.addEventListener('wheel', onWheel, { passive: false });
  document.addEventListener('visibilitychange', requestRender);

  const mount = async (nextStageNode, slide) => {
    stageNode = nextStageNode;
    activeSlide = slide;
    activeScene = normalizeThreeDScene(slide?.threeDScene);
    if (!activeScene.enabled || !stageNode) {
      unmount();
      return false;
    }
    stageNode.classList.add('three-d-stage-active');
    stageNode.prepend(cssRenderer.domElement);
    stageNode.prepend(webglRenderer.domElement);
    clearAnchors();
    syncRootTransform();
    resize();
    await loadCurrentModel();
    applyAnimationState();
    requestRender();
    return true;
  };

  const unmount = () => {
    anchoringElementId = '';
    pointerState = null;
    clearAnchors();
    webglRenderer.domElement.remove();
    cssRenderer.domElement.remove();
    stageNode?.classList.remove('three-d-stage-active', 'is-picking-3d-anchor', 'three-d-load-failed');
    stageNode = null;
    activeSlide = null;
    if (animationFrame) cancelAnimationFrame(animationFrame);
    animationFrame = 0;
  };

  const applyAttachmentToAnchoredObject = (entry, nextAttachment, options = {}) => {
    const attachment = normalizeThreeDAttachment(nextAttachment);
    if (!entry || !attachment) return null;
    const { object, element } = entry;
    const limits = getThreeDAttachmentPixelLimits(attachment);
    const width = Math.min(Math.max(1, Number(options.frameStyle?.width ?? element.width) || 160), limits.width);
    const height = Math.min(Math.max(1, Number(options.frameStyle?.height ?? element.height) || 80), limits.height);
    if (options.persist !== false) {
      element.width = width;
      element.height = height;
    }
    object.element.style.width = `${width}px`;
    object.element.style.height = `${height}px`;
    const contentNode = object.element.firstElementChild;
    if (contentNode instanceof HTMLElement) {
      contentNode.style.width = `${width}px`;
      contentNode.style.height = `${height}px`;
      if (options.frameStyle) {
        contentNode.style.opacity = String(options.frameStyle.opacity);
        contentNode.style.transform = `rotate(${options.frameStyle.rotation}deg)`;
      }
    }
    const position = new THREE.Vector3(...attachment.position);
    const normal = new THREE.Vector3(...attachment.normal).normalize();
    object.position.copy(position).addScaledVector(normal, attachment.surfaceOffset);
    object.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    object.scale.setScalar(CSS3D_WORLD_PER_PIXEL * attachment.scale);
    entry.attachment = attachment;
    if (options.persist !== false) element.attachment3d = attachment;
    return attachment;
  };

  const attachElement = (node, element) => {
    const attachment = normalizeThreeDAttachment(element?.attachment3d);
    if (!attachment || !node) return false;
    const previous = anchoredObjects.get(element.id);
    if (previous) {
      previous.object.removeFromParent();
      previous.object.element.remove();
      anchoredObjects.delete(element.id);
    }
    const limits = getThreeDAttachmentPixelLimits(attachment);
    const width = Math.min(
      Math.max(1, Number(element.width) || node.offsetWidth || 160),
      limits?.width || Number.MAX_SAFE_INTEGER
    );
    const height = Math.min(
      Math.max(1, Number(element.height) || node.offsetHeight || 80),
      limits?.height || Number.MAX_SAFE_INTEGER
    );
    const wrapper = document.createElement('div');
    wrapper.className = 'three-d-anchored-element';
    wrapper.dataset.elementId = element.id;
    wrapper.dataset.threeDInteractive = 'true';
    wrapper.style.width = `${width}px`;
    wrapper.style.height = `${height}px`;
    wrapper.classList.toggle('is-editor-selected', node.classList.contains('element-active'));
    node.style.left = '0';
    node.style.top = '0';
    node.style.width = `${width}px`;
    node.style.height = `${height}px`;
    wrapper.appendChild(node);
    const object = new CSS3DObject(wrapper);
    cssRoot.add(object);
    const motionFrames = Array.isArray(element.motionFrames)
      ? element.motionFrames.filter((frame) => normalizeThreeDAttachment(frame?.attachment3d))
      : [];
    const shouldAnimate = element.animationType === 'motion-recording'
      && motionFrames.length >= 2
      && shouldAnimateAttachedElement(element);
    let preservedElapsedMs = Number(node.dataset.motionElapsedSeconds || 0) * 1000;
    if (node._motionAnimation) {
      preservedElapsedMs = Number(node._motionAnimation.currentTime) || preservedElapsedMs;
      node._motionAnimation.cancel?.();
      node._motionAnimation = null;
    }
    node.style.left = '0';
    node.style.top = '0';
    const entry = {
      object,
      attachment,
      element,
      motion: shouldAnimate
        ? {
            frames: motionFrames,
            duration: Math.max(200, (Number(element.animationDuration) || 1.2) * 1000),
            delay: Math.max(0, (Number(element.animationDelay) || 0) * 1000),
            loop: Boolean(element.animationLoop),
            startedAt: performance.now() - preservedElapsedMs,
            finished: false
          }
        : null
    };
    anchoredObjects.set(element.id, entry);
    const initialAttachment = shouldAnimate ? motionFrames[0].attachment3d : attachment;
    applyAttachmentToAnchoredObject(entry, initialAttachment, {
      persist: !shouldAnimate,
      frameStyle: shouldAnimate ? getMotionFrameStyle(motionFrames[0], motionFrames[0], 0) : null
    });
    requestRender();
    return true;
  };

  const moveAttachedElement = (elementId, event) => {
    const entry = anchoredObjects.get(String(elementId || ''));
    if (!entry) return null;
    const nextAttachment = resolveAttachmentFromPointer(event);
    if (!nextAttachment) return null;
    const fallback2d = entry.element.attachment3d?.fallback2d || entry.attachment?.fallback2d || null;
    const attachment = applyAttachmentToAnchoredObject(entry, { ...nextAttachment, fallback2d });
    requestRender();
    return attachment;
  };

  const beginAnchorPick = (elementId) => {
    if (!stageNode || !modelObject) return false;
    anchoringElementId = String(elementId || '');
    stageNode.classList.toggle('is-picking-3d-anchor', Boolean(anchoringElementId));
    return Boolean(anchoringElementId);
  };

  const cancelAnchorPick = () => {
    anchoringElementId = '';
    stageNode?.classList.remove('is-picking-3d-anchor');
  };

  const setSceneState = (nextScene, { notify = false } = {}) => {
    activeScene = normalizeThreeDScene(nextScene);
    if (activeSlide) activeSlide.threeDScene = activeScene;
    syncRootTransform();
    applyAnimationState();
    if (notify) applySceneToSlide({ transient: false });
    requestRender();
  };

  const getAnimationNames = () => animations.map((clip, index) => ({
    index,
    name: clip.name || `Animação ${index + 1}`
  }));

  const captureCanvas = () => {
    requestRender();
    webglRenderer.render(scene, camera);
    return webglRenderer.domElement;
  };

  const getAttachmentExportLayouts = () => {
    if (!stageNode) return new Map();
    const stageRect = stageNode.getBoundingClientRect();
    if (!stageRect.width || !stageRect.height) return new Map();
    const logicalWidth = Number(activeSlide?.stageWidth) || 1280;
    const logicalHeight = Number(activeSlide?.stageHeight) || 720;
    const scaleX = logicalWidth / stageRect.width;
    const scaleY = logicalHeight / stageRect.height;
    const layouts = new Map();
    anchoredObjects.forEach(({ object }, elementId) => {
      const elementNode = object?.element;
      if (!(elementNode instanceof HTMLElement) || elementNode.style.display === 'none') return;
      const rect = elementNode.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      layouts.set(elementId, {
        x: (rect.left - stageRect.left) * scaleX,
        y: (rect.top - stageRect.top) * scaleY,
        width: rect.width * scaleX,
        height: rect.height * scaleY,
        rotation: 0
      });
    });
    return layouts;
  };

  const destroy = () => {
    destroyed = true;
    unmount();
    clearModel();
    webglRenderer.dispose();
    document.removeEventListener('visibilitychange', requestRender);
  };

  return {
    attachElement,
    beginAnchorPick,
    cancelAnchorPick,
    captureCanvas,
    destroy,
    getAttachmentExportLayouts,
    getAnimationNames,
    getProfile: () => ({ ...profile }),
    mount,
    moveAttachedElement,
    normalizeScene: normalizeThreeDScene,
    requestRender,
    resize,
    setSceneState,
    unmount
  };
};
