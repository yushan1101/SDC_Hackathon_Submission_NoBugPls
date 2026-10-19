#!/usr/bin/env bash
# RunPod (single GPU, PyTorch template). Budget rule: STOP the Pod as soon as this finishes.
# Local CPU run of the full ablation took ~30 s, so one short session is enough; S1-S4 are caps, not targets.
#   bash scripts/run_training.sh            # 3 seeds, MiniLM semantic branch
set -euo pipefail
cd "$(dirname "$0")/.."
pip install -q -e '.[ai]'

mkdir -p data/raw
[ -f data/raw/data_jobs.csv ] || curl -L -o data/raw/data_jobs.csv \
  https://huggingface.co/datasets/Ashy24/data_jobs/resolve/main/data_jobs.csv
[ -f data/snapshots/weekly_skill_demand.csv ] || python scripts/prepare_jobs.py --input data/raw/data_jobs.csv
pytest -q

for seed in ${SEEDS:-42 7 2026}; do
  python forecasting/train.py --model all --window 12 --horizon 4 --batch-size 64 --epochs 30 \
    --device cuda --seed "$seed" --save-dir "/workspace/checkpoints/seed$seed"
done
python forecasting/evaluate.py --checkpoint /workspace/checkpoints/seed42/stf_kan_best.pt
echo "Copy /workspace/checkpoints/<best seed>/ to ./artifacts/ locally, then stop the Pod."
