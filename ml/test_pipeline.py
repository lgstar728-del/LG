"""파이프라인 자동 테스트 (누출 방지·재현성·모델 산출물). 실행: python -m unittest ml/test_pipeline.py -v"""
import json
import sys
import unittest
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).parent))
from common import LEAKY_COLUMNS, build_features, time_split  # noqa: E402
from generate_data import generate  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]


class PipelineTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.df, cls.pitchers = generate(n_total=4000, seed=123)

    def test_every_row_marked_demo(self):
        self.assertTrue((self.df["data_source"] == "DEMO").all())
        self.assertTrue(self.df["is_demo"].all())
        self.assertTrue(all(p["is_demo"] for p in self.pitchers))

    def test_deterministic_with_seed(self):
        again, _ = generate(n_total=4000, seed=123)
        pd.testing.assert_frame_equal(self.df, again)

    def test_label_matches_miss_distance(self):
        self.assertTrue(((self.df["miss_distance"] <= 0.45).astype(int) == self.df["success"]).all())

    def test_features_exclude_post_pitch_columns(self):
        pv = sorted(self.df.pitcher_id.unique())
        feats = build_features(self.df, pv, ["FF", "SL", "CB", "CH", "FK"])
        for leaky in LEAKY_COLUMNS:
            self.assertNotIn(leaky, feats.columns)
        self.assertFalse(any(c.startswith(("actual", "miss", "success")) for c in feats.columns))

    def test_time_split_has_no_game_overlap_and_is_chronological(self):
        tr, ca, te = time_split(self.df)
        self.assertEqual(len(tr) + len(ca) + len(te), len(self.df))
        sets = [set(x.game_id) for x in (tr, ca, te)]
        self.assertFalse(sets[0] & sets[1] or sets[0] & sets[2] or sets[1] & sets[2])
        self.assertLessEqual(tr.groupby("game_id").game_date.min().max(), ca.groupby("game_id").game_date.min().min())
        self.assertLessEqual(ca.groupby("game_id").game_date.min().max(), te.groupby("game_id").game_date.min().min())

    def test_exported_model_is_demo_and_complete(self):
        m = json.loads((ROOT / "src" / "model" / "model.json").read_text(encoding="utf-8"))
        self.assertEqual(m["data_source"], "DEMO")
        self.assertGreater(m["n_trees"], 50)
        self.assertEqual(len(m["trees"]), m["n_trees"])
        metrics = json.loads((ROOT / "data" / "metrics.json").read_text(encoding="utf-8"))
        self.assertGreater(metrics["test"]["calibrated"]["roc_auc"], 0.55)
        self.assertIn("실제 성능이 아님", metrics["claim"])


if __name__ == "__main__":
    unittest.main()
