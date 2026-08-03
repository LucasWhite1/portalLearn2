import unittest

import numpy as np

from matching import build_reference_embedding, evaluate_embedding_match


class MatchingPolicyTests(unittest.TestCase):
    def test_reference_uses_multiple_frames(self):
        features = [
            np.asarray([1.0, 0.01, 0.0]),
            np.asarray([0.99, -0.02, 0.0]),
            np.asarray([1.0, 0.03, 0.01]),
            np.asarray([0.98, 0.01, -0.02]),
            np.asarray([0.99, 0.0, 0.02]),
            np.asarray([1.0, -0.01, 0.0]),
        ]
        reference = build_reference_embedding(features)
        self.assertIsNotNone(reference)
        self.assertGreater(float(reference[0]), 0.99)

    def test_rejects_single_matching_frame(self):
        reference = np.asarray([1.0, 0.0, 0.0])
        features = [reference] + [np.asarray([0.0, 1.0, 0.0]) for _ in range(7)]
        result = evaluate_embedding_match(features, reference, 0.55, 0.75, 6)
        self.assertFalse(result["matched"])
        self.assertEqual(result["matchedFrames"], 1)

    def test_accepts_consistent_matching_frames(self):
        reference = np.asarray([1.0, 0.0, 0.0])
        features = [
            np.asarray([1.0, offset, 0.0])
            for offset in (0.01, -0.02, 0.03, -0.01, 0.02, 0.0, 0.04, -0.03)
        ]
        result = evaluate_embedding_match(features, reference, 0.55, 0.75, 6)
        self.assertTrue(result["matched"])
        self.assertEqual(result["matchedFrames"], 8)

    def test_rejects_too_few_frames(self):
        reference = np.asarray([1.0, 0.0, 0.0])
        result = evaluate_embedding_match([reference] * 5, reference, 0.55, 0.75, 6)
        self.assertFalse(result["matched"])
        self.assertEqual(result["failureCode"], "INSUFFICIENT_MATCH_FRAMES")


if __name__ == "__main__":
    unittest.main()
