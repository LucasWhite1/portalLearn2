import base64
import hmac
import os
from typing import List, Optional

import cv2
import mediapipe as mp
import numpy as np
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field
from matching import build_reference_embedding, evaluate_embedding_match, normalize_embedding


MODEL_DIR = os.getenv("FACE_MODEL_DIR", "/models")
YUNET_PATH = os.path.join(MODEL_DIR, "face_detection_yunet_2023mar.onnx")
SFACE_PATH = os.path.join(MODEL_DIR, "face_recognition_sface_2021dec.onnx")
MODEL_VERSION = os.getenv("FACE_MODEL_VERSION", "opencv-sface-2021dec-mediapipe-v2")
INTERNAL_TOKEN = os.getenv("FACE_SERVICE_INTERNAL_TOKEN", "")


def bounded_float_env(name, default, minimum, maximum):
    value = float(os.getenv(name, str(default)))
    if value < minimum or value > maximum:
        raise RuntimeError(f"{name} must be between {minimum} and {maximum}")
    return value


def bounded_int_env(name, default, minimum, maximum):
    value = int(os.getenv(name, str(default)))
    if value < minimum or value > maximum:
        raise RuntimeError(f"{name} must be between {minimum} and {maximum}")
    return value


COSINE_THRESHOLD = bounded_float_env("FACE_COSINE_THRESHOLD", 0.55, 0.50, 0.90)
MATCH_CONSENSUS_RATIO = bounded_float_env("FACE_MATCH_CONSENSUS_RATIO", 0.75, 0.67, 1.0)
MIN_MATCH_FRAMES = bounded_int_env("FACE_MIN_MATCH_FRAMES", 6, 6, 12)
MAX_EMBEDDING_FRAMES = bounded_int_env("FACE_MAX_EMBEDDING_FRAMES", 12, MIN_MATCH_FRAMES, 20)
MAX_FRAMES = 36
MAX_FRAME_BYTES = 700 * 1024

app = FastAPI(title="Criatyve Face Verification", docs_url=None, redoc_url=None, openapi_url=None)
detector = cv2.FaceDetectorYN.create(YUNET_PATH, "", (320, 320), 0.85, 0.3, 5000)
recognizer = cv2.FaceRecognizerSF.create(SFACE_PATH, "")
face_mesh = mp.solutions.face_mesh.FaceMesh(
    static_image_mode=True,
    max_num_faces=2,
    refine_landmarks=True,
    min_detection_confidence=0.7,
)


class FramePayload(BaseModel):
    mimeType: str
    data: str


class ChallengePayload(BaseModel):
    nonce: str = Field(min_length=32, max_length=96)
    steps: List[str] = Field(min_length=1, max_length=3)
    schemaVersion: int


class VerifyPayload(BaseModel):
    challenge: ChallengePayload
    referenceEmbedding: Optional[List[float]] = None
    frames: List[FramePayload] = Field(min_length=8, max_length=MAX_FRAMES)


def require_internal_token(token: str):
    if not INTERNAL_TOKEN or not hmac.compare_digest(token or "", INTERNAL_TOKEN):
        raise HTTPException(status_code=401, detail="Unauthorized")


def decode_frame(frame: FramePayload) -> np.ndarray:
    if frame.mimeType not in {"image/jpeg", "image/png", "image/webp"}:
        raise ValueError("INVALID_FRAME_TYPE")
    raw = base64.b64decode(frame.data, validate=True)
    if not raw or len(raw) > MAX_FRAME_BYTES:
        raise ValueError("INVALID_FRAME_SIZE")
    image = cv2.imdecode(np.frombuffer(raw, dtype=np.uint8), cv2.IMREAD_COLOR)
    if image is None or image.shape[0] < 120 or image.shape[1] < 120:
        raise ValueError("INVALID_FRAME")
    return image


def eye_aspect_ratio(points, indexes):
    p1, p2, p3, p4, p5, p6 = [np.array([points[i].x, points[i].y]) for i in indexes]
    vertical = np.linalg.norm(p2 - p6) + np.linalg.norm(p3 - p5)
    horizontal = 2.0 * max(np.linalg.norm(p1 - p4), 1e-6)
    return float(vertical / horizontal)


def landmark_metrics(image):
    rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
    result = face_mesh.process(rgb)
    if not result.multi_face_landmarks:
        return None, 0
    if len(result.multi_face_landmarks) != 1:
        return None, len(result.multi_face_landmarks)
    points = result.multi_face_landmarks[0].landmark
    left_ear = eye_aspect_ratio(points, [33, 160, 158, 133, 153, 144])
    right_ear = eye_aspect_ratio(points, [362, 385, 387, 263, 373, 380])
    cheek_left = points[234]
    cheek_right = points[454]
    nose = points[1]
    midpoint = (cheek_left.x + cheek_right.x) / 2.0
    width = max(abs(cheek_right.x - cheek_left.x), 1e-6)
    yaw = float((nose.x - midpoint) / width)
    return {"ear": (left_ear + right_ear) / 2.0, "yaw": yaw}, 1


def detect_single_face(image):
    height, width = image.shape[:2]
    detector.setInputSize((width, height))
    _, faces = detector.detect(image)
    if faces is None or len(faces) == 0:
        return None, 0
    if len(faces) != 1:
        return None, len(faces)
    return faces[0], 1


def evaluate_liveness(metrics, steps):
    if len(metrics) < 8:
        return False, "INSUFFICIENT_VALID_FRAMES"
    ears = [entry["ear"] for entry in metrics]
    yaws = [entry["yaw"] for entry in metrics]
    movement = max(yaws) - min(yaws)
    if movement < 0.04 and max(ears) - min(ears) < 0.018:
        return False, "INSUFFICIENT_MOVEMENT"
    baseline_size = max(2, min(6, int(len(metrics) * 0.18)))
    baseline = metrics[:baseline_size]
    baseline_yaw = float(np.median([entry["yaw"] for entry in baseline]))
    baseline_ear = float(np.median([entry["ear"] for entry in baseline]))
    challenge_metrics = metrics[baseline_size:]
    segment_size = max(2, len(challenge_metrics) // max(len(steps), 1))
    for index, step in enumerate(steps):
        start = index * segment_size
        end = len(challenge_metrics) if index == len(steps) - 1 else (index + 1) * segment_size
        segment = challenge_metrics[start:end]
        if len(segment) < 2:
            return False, f"CHALLENGE_{step.upper()}_NOT_CONFIRMED"
        segment_ears = [entry["ear"] for entry in segment]
        segment_yaws = [entry["yaw"] for entry in segment]
        ear_drop = max(segment_ears + [baseline_ear]) - min(segment_ears)
        confirmed = {
            "blink": ear_drop >= 0.018 and min(segment_ears) <= baseline_ear * 0.9,
            # The preview is mirrored with CSS, while captured pixels are not.
            "turn_left": max(segment_yaws) - baseline_yaw >= 0.045,
            "turn_right": baseline_yaw - min(segment_yaws) >= 0.045,
        }.get(step, False)
        if not confirmed:
            return False, f"CHALLENGE_{step.upper()}_NOT_CONFIRMED"
    return True, None


def audit_image(image):
    height, width = image.shape[:2]
    scale = min(1.0, 640.0 / max(width, height))
    resized = cv2.resize(image, (int(width * scale), int(height * scale)))
    ok, encoded = cv2.imencode(".jpg", resized, [cv2.IMWRITE_JPEG_QUALITY, 78])
    return base64.b64encode(encoded.tobytes()).decode("ascii") if ok else None


def select_embedding_candidates(candidates):
    if not candidates:
        return []
    maximum_area = max(candidate["area"] for candidate in candidates)
    quality_candidates = [
        candidate for candidate in candidates
        if candidate["area"] >= maximum_area * 0.45
    ] or candidates
    if len(quality_candidates) <= MAX_EMBEDDING_FRAMES:
        return quality_candidates
    indexes = np.linspace(0, len(quality_candidates) - 1, MAX_EMBEDDING_FRAMES, dtype=int)
    return [quality_candidates[index] for index in sorted(set(indexes.tolist()))]


def extract_embeddings(candidates):
    embeddings = []
    for candidate in select_embedding_candidates(candidates):
        try:
            aligned = recognizer.alignCrop(candidate["image"], candidate["face"])
            feature = normalize_embedding(recognizer.feature(aligned))
        except Exception:
            feature = None
        if feature is not None:
            embeddings.append(feature)
    return embeddings


@app.get("/health")
def health():
    return {"status": "ok", "modelVersion": MODEL_VERSION}


@app.post("/v1/verify")
async def verify(payload: VerifyPayload, x_internal_token: str = Header(default="")):
    require_internal_token(x_internal_token)
    metrics = []
    face_candidates = []
    best_image = None
    best_face = None
    best_area = 0.0
    multiple_faces = False
    for frame in payload.frames:
        try:
            image = decode_frame(frame)
        except Exception:
            continue
        face, face_count = detect_single_face(image)
        landmarks, landmark_count = landmark_metrics(image)
        if face_count > 1 or landmark_count > 1:
            multiple_faces = True
            continue
        if face is None or landmarks is None:
            continue
        metrics.append(landmarks)
        area = float(face[2] * face[3])
        face_candidates.append({"image": image, "face": face, "area": area})
        if area > best_area:
            best_area = area
            best_image = image
            best_face = face
    if multiple_faces:
        return {
            "verified": False,
            "livenessPassed": False,
            "failureCode": "MULTIPLE_FACES",
            "auditImage": audit_image(best_image) if best_image is not None else None,
            "auditImageMime": "image/jpeg",
            "modelVersion": MODEL_VERSION,
        }
    if best_image is None or best_face is None:
        return {
            "verified": False,
            "livenessPassed": False,
            "failureCode": "FACE_NOT_FOUND",
            "modelVersion": MODEL_VERSION,
        }
    liveness_passed, failure_code = evaluate_liveness(metrics, payload.challenge.steps)
    features = extract_embeddings(face_candidates)
    feature = build_reference_embedding(features)
    if feature is None:
        raise HTTPException(status_code=422, detail="Invalid face feature")
    matched = True
    match_result = None
    if payload.referenceEmbedding is not None:
        reference = normalize_embedding(payload.referenceEmbedding)
        if reference is None or reference.shape != feature.shape:
            matched = False
            failure_code = "MODEL_VERSION_MISMATCH"
        else:
            match_result = evaluate_embedding_match(
                features,
                reference,
                COSINE_THRESHOLD,
                MATCH_CONSENSUS_RATIO,
                MIN_MATCH_FRAMES,
            )
            matched = match_result["matched"]
            if not matched:
                failure_code = match_result["failureCode"]
    verified = bool(liveness_passed and matched)
    return {
        "verified": verified,
        "livenessPassed": bool(liveness_passed),
        "embedding": feature.tolist() if verified else None,
        "failureCode": None if verified else (failure_code or "FACE_NOT_CONFIRMED"),
        "auditImage": audit_image(best_image) if not verified else None,
        "auditImageMime": "image/jpeg",
        "modelVersion": MODEL_VERSION,
        "matchPolicy": {
            "version": 2,
            "evaluatedFrames": match_result["evaluatedFrames"] if match_result else len(features),
            "matchedFrames": match_result["matchedFrames"] if match_result else len(features),
            "consensusPassed": bool(matched),
        },
    }
