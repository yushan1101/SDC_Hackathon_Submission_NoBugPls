"""Compact KAN layer.

ponytail: Gaussian-RBF basis (FastKAN, Li 2024) instead of true B-splines; RBFs approximate
cubic B-splines closely and are far simpler/faster. Swap to efficient-kan B-splines if an
ablation ever shows it matters.
"""
import torch
from torch import nn


class KANLayer(nn.Module):
    """y = W_base·silu(x) + W_spline·phi(x), phi = RBF grid per input feature."""

    def __init__(self, in_dim: int, out_dim: int, grid: int = 8, grid_range: float = 3.0):
        super().__init__()
        self.register_buffer("centers", torch.linspace(-grid_range, grid_range, grid))
        self.inv_width = (grid - 1) / (2 * grid_range)
        self.norm = nn.LayerNorm(in_dim)
        self.base = nn.Linear(in_dim, out_dim)
        self.spline = nn.Linear(in_dim * grid, out_dim, bias=False)
        nn.init.normal_(self.spline.weight, std=0.1 / (in_dim * grid) ** 0.5)

    def forward(self, x):
        x = self.norm(x)
        phi = torch.exp(-((x[..., None] - self.centers) * self.inv_width) ** 2)
        return self.base(nn.functional.silu(x)) + self.spline(phi.flatten(-2))


class KAN(nn.Sequential):
    def __init__(self, dims: list[int], grid: int = 8):
        super().__init__(*[KANLayer(a, b, grid) for a, b in zip(dims[:-1], dims[1:])])
