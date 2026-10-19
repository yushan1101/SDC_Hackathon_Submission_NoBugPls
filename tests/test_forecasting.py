import numpy as np
import pandas as pd
import pytest

torch = pytest.importorskip("torch")
from forecasting.datasets import SPLITS, Series, fit_scale, windows  # noqa: E402
from forecasting.frequency import spectral_features  # noqa: E402
from forecasting.inference import forecast, to_tensors  # noqa: E402
from forecasting.model import VARIANTS, STFKAN  # noqa: E402

WEEKS = np.array([str(d.date()) for d in pd.date_range("2023-01-02", periods=52, freq="7D")])


def fake_series():
    rng = np.random.default_rng(0)
    v = 30 + np.cumsum(rng.normal(0, 1, (4, 52)), 1)
    v[0, 5:8] = np.nan
    keys = [("A", "x", "global"), ("A", "y", "global"), ("B", "x", "global"), ("B", "y", "US")]
    return Series(["A", "B"], ["x", "y"], keys, WEEKS, v, np.full_like(v, 200.0))


def test_windows_chronological_no_leak():
    s = fake_series()
    for split, (lo, hi) in SPLITS.items():
        for t0 in windows(s, split)["t0"]:
            tgt = WEEKS[t0 + 12:t0 + 16]
            assert lo <= tgt[0] and tgt[-1] <= hi
    assert fit_scale(s) > 0


def test_frequency_masked_on_missing():  # T-07
    x = torch.randn(2, 12)
    mask = torch.ones(2, 12)
    mask[0, 3] = 0
    _, reliable = spectral_features(x, mask)
    assert reliable.tolist() == [False, True]


@pytest.mark.parametrize("variant", VARIANTS)
def test_one_batch_shapes_and_grads(variant):
    b = windows(fake_series(), "train")
    m = STFKAN(2, 2, variant=variant)
    inputs, _ = to_tensors({k: v[:16] for k, v in b.items()}, 1.0)
    y, alpha = m(*inputs, return_gate=True)
    assert y.shape == (16, 4)
    if variant != "stf_kan":
        assert torch.all(alpha[:, 1] == 0)  # frequency branch masked
    y.sum().backward()
    assert m.time[0].spline.weight.grad is not None


def test_cpu_fallback_without_checkpoint(tmp_path):  # T-13
    f = forecast("A", "y", series=fake_series(), ckpt=tmp_path / "missing.pt")
    assert forecast("B", "y", series=fake_series(), ckpt=tmp_path / "m.pt", geography="US")["predicted_percent"]
    assert f["model_id"] == "baseline:ma4" and f["is_historical_backtest"] and len(f["predicted_percent"]) == 4


def test_fft_branch_extrapolates_pure_harmonic():
    from forecasting.frequency import fft_forecast
    t = torch.arange(16, dtype=torch.float64)
    for sig, tol in ((0.3 * t, 1e-9),                       # pure trend: exact
                     (torch.sin(2 * torch.pi * t / 6) + 0.2 * t, 1e-9)):  # trend + 6-week cycle: exact
        c = sig[:12].mean()
        err = (fft_forecast((sig[:12] - c)[None], 4)[0] - (sig[12:] - c)).abs().max()
        assert err < tol


def test_noise_floor_and_pooling():
    from forecasting.datasets import noise_floor_mae
    w = windows(fake_series(), "test")
    assert w["xg"].shape == w["x"].shape and 0 < noise_floor_mae(w) < 5


def test_ar_branch_starts_at_ridge():
    m = STFKAN(2, 2, ar_init=(np.zeros((24, 4)), np.ones(4)))
    b = windows(fake_series(), "train")
    inputs, _ = to_tensors({k: v[:4] for k, v in b.items()}, 1.0)
    _, alpha = m(*inputs, return_gate=True)
    assert torch.allclose(m.ar.bias, torch.ones(4)) and (alpha[:, 3] > 0.5).all()  # gate favours the anchor at init


def test_forecast_checks_reject_bad_output():
    from validation.forecast_checks import check_forecast
    good = forecast("A", "y", series=fake_series(), ckpt="missing.pt")
    assert check_forecast(good) == [] and good["direction"] in ("up", "down", "flat")
    bad = good | {"predicted_percent": [120, 1, 1], "is_historical_backtest": False}
    assert {i.code for i in check_forecast(bad)} == {"forecast_horizon", "forecast_bounds", "forecast_label"}


def test_ensemble_checkpoint_loads_and_averages(tmp_path):
    from forecasting.inference import load_model
    from forecasting.model import Ensemble
    s = fake_series()
    members = [STFKAN(2, 2, hidden=8, sem_dim=8, grid=5).state_dict() for _ in range(3)]
    ck = {"members": members, "variant": "stf_kan", "roles": s.roles, "skills": s.skills, "keys": s.keys, "window": 12,
          "horizon": 4, "scale": 1.0, "text_emb": None, "selected": "stf_kan:ensemble", "interval_q80_pp": [1.0] * 4,
          "hparams": {"hidden": 8, "sem_dim": 8, "grid": 5}}
    torch.save(ck, tmp_path / "e.pt")
    m, _ = load_model(tmp_path / "e.pt")
    assert isinstance(m, Ensemble) and len(m.members) == 3
    inputs, _ = to_tensors({k: v[:5] for k, v in windows(s, "train").items()}, 1.0)
    with torch.no_grad():
        mean = torch.stack([mm(*inputs) for mm in m.members]).mean(0)
        assert torch.allclose(m(*inputs), mean)
    f = forecast("A", "y", series=s, ckpt=tmp_path / "e.pt")
    assert f["model_id"] == "stf_kan:stf_kan x3 ensemble" and f["lower_percent"] is not None
