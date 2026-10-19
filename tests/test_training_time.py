import pytest
from tools.training_time import weeks_required

def test_feasibility_hours():
    assert weeks_required(88, 6) == 15

def test_invalid_hours():
    with pytest.raises(ValueError):
        weeks_required(10, 0)
