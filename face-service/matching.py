import math
from typing import Iterable, Optional

import numpy as np


def normalize_embedding(value) -> Optional[np.ndarray]:
    embedding = np.asarray(value, dtype=np.float32).flatten()
    norm = float(np.linalg.norm(embedding))
    if embedding.size == 0 or not math.isfinite(norm) or norm <= 1e-6:
        return None
    return embedding / norm


def build_reference_embedding(features: Iterable[np.ndarray]) -> Optional[np.ndarray]:
    normalized = [normalize_embedding(feature) for feature in features]
    normalized = [feature for feature in normalized if feature is not None]
    if not normalized:
        return None

    # A normalized centroid is less dependent on one expression or camera frame.
    centroid = normalize_embedding(np.mean(np.stack(normalized), axis=0))
    if centroid is None:
        return None

    # Remove the most divergent samples once before producing the final template.
    similarities = np.asarray([float(np.dot(feature, centroid)) for feature in normalized])
    if len(normalized) >= 6:
        cutoff = max(float(np.percentile(similarities, 20)), 0.35)
        retained = [feature for feature, similarity in zip(normalized, similarities) if similarity >= cutoff]
        if len(retained) >= 4:
            centroid = normalize_embedding(np.mean(np.stack(retained), axis=0))
    return centroid


def evaluate_embedding_match(
    features: Iterable[np.ndarray],
    reference,
    threshold: float,
    consensus_ratio: float,
    minimum_frames: int,
):
    normalized_reference = normalize_embedding(reference)
    normalized_features = [normalize_embedding(feature) for feature in features]
    normalized_features = [feature for feature in normalized_features if feature is not None]
    if normalized_reference is None or len(normalized_features) < minimum_frames:
        return {
            "matched": False,
            "failureCode": "INSUFFICIENT_MATCH_FRAMES",
            "evaluatedFrames": len(normalized_features),
            "matchedFrames": 0,
            "consensus": 0.0,
            "medianSimilarity": None,
        }

    similarities = np.asarray(
        [float(np.dot(feature, normalized_reference)) for feature in normalized_features],
        dtype=np.float32,
    )
    matched_frames = int(np.count_nonzero(similarities >= threshold))
    consensus = matched_frames / len(similarities)
    median_similarity = float(np.median(similarities))
    matched = consensus >= consensus_ratio and median_similarity >= threshold
    return {
        "matched": bool(matched),
        "failureCode": None if matched else "FACE_NOT_MATCHED",
        "evaluatedFrames": len(normalized_features),
        "matchedFrames": matched_frames,
        "consensus": float(consensus),
        "medianSimilarity": median_similarity,
    }
