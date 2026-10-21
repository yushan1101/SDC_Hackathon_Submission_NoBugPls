"""12-week trend features (works on normalized windows)."""
import torch


def trend_features(x: torch.Tensor) -> torch.Tensor:
    """x: (B, W) -> (B, 3) = [OLS slope, last-minus-first, last 4-week mean minus first 4-week mean]."""
    t = torch.arange(x.shape[-1], dtype=x.dtype, device=x.device)
    t = t - t.mean()
    slope = (x * t).sum(-1) / (t * t).sum()
    return torch.stack([slope, x[:, -1] - x[:, 0], x[:, -4:].mean(-1) - x[:, :4].mean(-1)], -1)
