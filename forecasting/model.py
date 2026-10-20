"""STF-KAN (lean): Time-KAN + parameter-free RFFT branch + MiniLM projection + linear AR anchor,
gated fusion, one head.

The AR branch is a linear map window->horizon initialised at the train-set ridge solution, so the
fused model starts at the strongest baseline and the KAN/semantic branches only learn corrections.

Each branch predicts a 4-week delta from the window mean (scaled units); the level is added once
after fusion. No Frequency-KAN, no direction head (derived from the forecast), no uncertainty head
(interval comes from validation errors, see train.py).
Ablation ladder (SDLC 5.5): temporal | temporal_sem | stf_kan.
"""
import torch
from torch import nn

from forecasting.frequency import N_BINS, fft_forecast, spectral_features
from forecasting.kan import KAN
from forecasting.temporal import trend_features

VARIANTS = ("temporal", "temporal_sem", "stf_kan")


class STFKAN(nn.Module):
    def __init__(self, n_roles, n_skills, window=12, horizon=4, hidden=16, sem_dim=16,
                 text_emb: torch.Tensor | None = None, variant="stf_kan", ar_init=None, grid=8):
        super().__init__()
        assert variant in VARIANTS
        self.variant, self.horizon = variant, horizon
        self.time = KAN([4 * window + 3, hidden], grid)  # one KAN layer over [x, mask, pooled global x, log counts, trend]
        # semantic: frozen MiniLM rows (384-d) projected to sem_dim, else learned role/skill IDs
        if text_emb is not None:
            self.register_buffer("text_emb", text_emb.float())
            self.sem_in = nn.Linear(text_emb.shape[1], sem_dim)
        else:
            self.text_emb = None
            self.role_emb = nn.Embedding(n_roles, sem_dim // 2)
            self.skill_emb = nn.Embedding(n_skills, sem_dim // 2)
        self.head = nn.Linear(hidden, horizon)            # time prediction
        self.head_sem = nn.Linear(sem_dim + hidden, horizon)  # time state conditioned on role/skill
        self.ar = nn.Linear(2 * window, horizon)  # linear AR over [x, pooled global x]
        if ar_init is not None:  # (W (window, horizon), b (horizon,)) from closed-form ridge on scaled train windows
            with torch.no_grad():
                self.ar.weight.copy_(torch.as_tensor(ar_init[0]).T)
                self.ar.bias.copy_(torch.as_tensor(ar_init[1]))
        self.n_branch = 4
        self.gate = nn.Linear(hidden + sem_dim + 2 * N_BINS + 2, self.n_branch * horizon)
        nn.init.zeros_(self.gate.weight)
        with torch.no_grad():  # start with the gate favouring the AR anchor
            self.gate.bias.view(self.n_branch, horizon)[3] = 2.0

    def semantic(self, role, skill, series):
        if self.text_emb is not None:
            return self.sem_in(self.text_emb[series])
        return torch.cat([self.role_emb(role), self.skill_emb(skill)], -1)

    def forward(self, x, mask, xg, logn, role, skill, series, return_gate=False):
        """x, xg: (B,W) scaled windows centered on x's mean; mask: observed=1; logn: scaled log ad counts."""
        h_t = self.time(torch.cat([x, mask, xg, logn, trend_features(x)], -1))
        h_s = self.semantic(role, skill, series)
        f, reliable = spectral_features(x, mask)
        ys = torch.stack([self.head(h_t), fft_forecast(x, self.horizon),
                          self.head_sem(torch.cat([h_s, h_t], -1)), self.ar(torch.cat([x, xg], -1))], 1)  # (B,4,H)

        quality = torch.stack([logn.mean(-1), reliable.to(x.dtype)], -1)
        logits = self.gate(torch.cat([h_t, h_s, f, quality], -1)).view(-1, self.n_branch, self.horizon)
        allow = torch.ones(x.shape[0], self.n_branch, dtype=torch.bool, device=x.device)
        if self.variant != "stf_kan":
            allow[:, 1] = False
        if self.variant == "temporal":
            allow[:, 2] = False
        allow[:, 1] &= reliable  # never force a frequency weight without a trustworthy signal
        alpha = logits.masked_fill(~allow[..., None], float("-inf")).softmax(1)
        y = (alpha * ys).sum(1)
        return (y, alpha) if return_gate else y


class Ensemble(nn.Module):
    """Mean of independently trained members (deep ensemble); reduces seed variance."""

    def __init__(self, members: list[nn.Module]):
        super().__init__()
        self.members = nn.ModuleList(members)

    def forward(self, *inputs):
        return torch.stack([m(*inputs) for m in self.members]).mean(0)
