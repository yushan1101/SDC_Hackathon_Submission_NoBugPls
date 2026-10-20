"""Frequency branch, zero trainable parameters.

- Gate features: linear detrend -> rFFT -> <=3 low bins (amplitude, phase).
- Forecast: joint least-squares fit of [level, trend, cos/sin at the same rFFT bins k=1..3],
  extrapolated. Fitting trend and harmonics *jointly* matters: detrending first leaks a cycle into
  the slope, so plain rFFT extrapolation drifts. The fit is one fixed (H x N) matrix -> one matmul.
A 12-week window only shows periods N/k = 12, 6, 4 weeks; it cannot prove annual seasonality, so
the branch is masked when the window is incomplete or flat.
"""
import math
from functools import lru_cache

import numpy as np
import torch

N_BINS = 3


def spectral_features(x: torch.Tensor, mask: torch.Tensor, n_bins: int = N_BINS):
    """x, mask: (B, W) -> feats (B, 2*n_bins) [amplitude, phase/pi], reliable (B,) bool."""
    n = x.shape[-1]
    tc = torch.arange(n, dtype=x.dtype, device=x.device) - (n - 1) / 2
    slope = (x * tc).sum(-1, keepdim=True) / (tc * tc).sum()
    spec = torch.fft.rfft(x - x.mean(-1, keepdim=True) - slope * tc, dim=-1)[:, 1:n_bins + 1]
    amp = 2 * spec.abs() / n
    reliable = (mask.min(-1).values > 0) & (amp.sum(-1) > 1e-3)
    return torch.cat([amp, torch.angle(spec) / math.pi], -1), reliable


@lru_cache
def _projection(n: int, horizon: int, n_bins: int) -> np.ndarray:
    basis = lambda t: np.column_stack([np.ones_like(t), t - (n - 1) / 2] +
                                      [f(2 * np.pi * k * t / n) for k in range(1, n_bins + 1) for f in (np.cos, np.sin)])
    return basis(np.arange(n, n + horizon, dtype=float)) @ np.linalg.pinv(basis(np.arange(n, dtype=float)))


def fft_forecast(x: torch.Tensor, horizon: int, n_bins: int = N_BINS) -> torch.Tensor:
    """x: (B, N) centered window -> (B, horizon) trend + harmonic extrapolation."""
    m = torch.as_tensor(_projection(x.shape[-1], horizon, n_bins), dtype=x.dtype, device=x.device)
    return x @ m.T
