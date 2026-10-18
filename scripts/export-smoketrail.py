"""Export SmokeTrail's results for the portfolio (read-only on the SmokeTrail repo).

Run from the SmokeTrail repo with its own environment:
    cd ~/Projects/SmokeTrail && .venv/bin/python <portfolio>/scripts/export-smoketrail.py <portfolio>

Uses SmokeTrail's own build_dataset() and the saved best model, checks the
model reproduces the stored 2019 test predictions, then writes:
  src/content/data/smoketrail/forecast-2019.json  per test day: actual, forecast,
      persistence, and the 3 features that moved the forecast most (SHAP)
  src/content/data/smoketrail/pm25-daily.json     every in-season day 2015–2019
"""
import json
import sys
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import shap

sys.path.insert(0, str(Path.cwd()))
from src.models.forecast import _unwrap, build_dataset  # noqa: E402

out_dir = Path(sys.argv[1]) / "src/content/data/smoketrail"
out_dir.mkdir(parents=True, exist_ok=True)

selection = json.loads(Path("models/selection.json").read_text())
best = selection["best_model"]
cols = selection["models"][best]["features"]
model = joblib.load("models/best_model.joblib")

df = build_dataset()
te = df[df["split"] == "test"].reset_index(drop=True)
stored = pd.read_parquet("data/processed/forecast_test_predictions.parquet")
pred = model.predict(te[cols])
assert np.allclose(pred, stored[best].to_numpy(), atol=1e-6), "saved model does not reproduce stored predictions"

est, to_input, is_log = _unwrap(model)
assert is_log, "expected a log-target model"
sv = shap.TreeExplainer(est)(to_input(te[cols]))

NAMES = {
    "day_of_season_next": "Time of season",
    "pm25": "Today's PM2.5",
    "pm25_lag1": "PM2.5 yesterday",
    "pm25_lag2": "PM2.5 two days ago",
    "pm25_lag3": "PM2.5 three days ago",
    "precip_sum": "Rain",
    "wind_speed_mean": "Wind speed",
    "wind_speed_vector": "Steady wind",
    "u_mean": "East–west wind",
    "v_mean": "North–south wind",
    "temp_mean": "Temperature",
    "rh_mean": "Humidity",
    "blh_mean": "Mixing height",
    "diwali_window_next": "Diwali window",
    "fire_count": "Fires today",
    "all_frpw": "Fire load (all directions)",
    "up_frpw_c30": "Upwind fire load",
    "up_count_c30": "Upwind fires",
}


def label(f: str) -> str:
    for suffix, word in (("_lag1", " (1 day ago)"), ("_lag2", " (2 days ago)"), ("_lag3", " (3 days ago)")):
        if f.endswith(suffix) and f not in NAMES:
            return NAMES.get(f[: -len(suffix)], f) + word
    return NAMES.get(f, f)


days = []
for i, r in te.iterrows():
    contrib = sorted(zip(cols, sv.values[i]), key=lambda kv: -abs(kv[1]))[:3]
    days.append({
        "date": str(r["date"])[:10],
        "target": str(r["target_date"])[:10],
        "actual": round(float(r["target_pm25"]), 1),
        "forecast": round(float(pred[i]), 1),
        "persistence": round(float(r["pm25"]), 1),
        "upwindLoad": round(float(r["up_frpw_c30"]), 1),
        "fires": int(r["fire_count"]),
        # Log-target model: each SHAP value multiplies the forecast by exp(value).
        "drivers": [{"feature": label(f), "pct": round((float(np.exp(v)) - 1) * 100, 1)} for f, v in contrib],
    })

(out_dir / "forecast-2019.json").write_text(json.dumps({
    "model": best,
    "source": "SmokeTrail (github.com/Asadalk/smoketrail-delhi), 2019 test season, evaluated once",
    "days": days,
}, indent=1))

feat = pd.read_parquet("data/processed/features.parquet")
season = feat[feat["in_season"] == 1].sort_values("date")
(out_dir / "pm25-daily.json").write_text(json.dumps({
    "source": "Delhi daily PM2.5 (Kaggle city_day, from CPCB), 15 Sep–15 Dec 2015–2019, via SmokeTrail",
    "days": [[str(d)[:10], round(float(p), 1)] for d, p in zip(season["date"], season["pm25"]) if pd.notna(p)],
}))
print(f"forecast days: {len(days)}, season days: {len(season)}")
