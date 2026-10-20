"""Tests run from the repository root: put src/ on the import path and run from src/ (where data/ lives)."""
import os
import sys
from pathlib import Path

SRC = Path(__file__).resolve().parents[1] / "src"
sys.path.insert(0, str(SRC))
sys.path.insert(0, str(Path(__file__).resolve().parent))  # tests import helpers from each other (test_graph.req)
os.chdir(SRC)
