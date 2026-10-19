# Experiment log

| Date | Owner | Commit | Dataset window | Model | Seed | MAE | GPU hours | USD spent | Notes |
|---|---|---|---|---|---|---|---|---|---|
| 2026-10-20 | B (agent) | n/a (no git) | train<=2023-08-31, val Sep-Oct, test Nov-Dec | all ablations, ID-embedding semantic | 42 | stf_kan:temporal_sem: test 1.112; linear 1.093; ma4 1.124 | 0 (local CPU, 30.5s) | 0 | STF-KAN ~= linear baseline; MiniLM not installed locally |
| 2026-10-20 | B (agent) | n/a | same splits | lean STF-KAN (no Freq-KAN; LS-RFFT branch; 1-layer Time-KAN; sem 16) | 42,7,2026 | temporal 1.100+/-0.002; stf_kan 1.107+/-0.009; linear 1.093 | 0 (CPU ~15 s) | 0 | ~2x faster, 4,970 vs ~11.5k params; accuracy unchanged; 80% band test coverage 80.2-80.5% |
| 2026-10-20 | B (agent) | n/a | same splits | lean STF-KAN + MiniLM all-MiniLM-L6-v2@1110a24 (384->16) | 42,7,2026 | stf_kan 1.106+/-0.001; temporal_sem 1.105+/-0.004; temporal 1.099; linear 1.093 | 0 (CPU ~35-41 s incl. MiniLM load) | 0 | full stf_kan chosen by val in 2/3 seeds; served seed 2026; test 80% band coverage 80.0%; still not better than linear on test |
| 2026-10-20 | B (agent) | n/a | same splits; 2,610 series (global+country) | STF-KAN + pooled global input + log-count input + ridge-initialised AR branch, L1 loss, MiniLM@1110a24 | 42,7,2026 (served 2026) | all: 2.437-2.439 vs best baseline 2.445; global: 1.092-1.095 vs 1.089; floor 0.84/1.89 | 0 (CPU ~6 min) | 0 | 80% band test coverage 81.1-81.3% |
