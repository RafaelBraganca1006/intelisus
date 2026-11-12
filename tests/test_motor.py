"""Testes do motor Python do gêmeo (rodar com: make test)."""
import sys
from datetime import date
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "pipeline"))

from gemeo import permanencia as pm  # noqa: E402
from gemeo import previsao as pv  # noqa: E402
from gemeo.segmentos import censo  # noqa: E402


def test_pascoa_e_feriados():
    assert pv.pascoa(2024) == date(2024, 3, 31)
    assert pv.pascoa(2026) == date(2026, 4, 5)
    f = pv.feriados(2026)
    assert f["carnaval_ter"] == date(2026, 2, 17)
    assert f["corpus_christi"] == date(2026, 6, 4)


def test_censo_por_eventos():
    # paciente A: dias 0-2 (sai no 3); paciente B: dia 1 (sai no 2)
    c = censo(np.array([0, 1]), np.array([3, 2]), np.array([0, 0]), 1, 5)
    assert c[0].tolist() == [1, 2, 1, 0, 0]


def test_propagar_estado_estacionario():
    """Com λ constante e hazard constante h, a ocupação converge para λ/h (Little)."""
    A1 = pm.A_MAX + 1
    h = 0.2
    h0 = np.full((1, A1), h)
    lam = np.full((1, 400), 50.0)
    est = np.zeros((1, A1))
    m, dp, _ = pv.propagar(est, lam, h0, np.ones((1, 400)), None)
    # censo à meia-noite conta a chegada do dia: λ·Σ(1-h)^a = λ/h
    assert abs(m[0, -1] - 50 / h) / (50 / h) < 0.01
    assert abs(dp[0, -1] ** 2 - m[0, -1]) / m[0, -1] < 0.02  # Poisson: var = média


def test_propagar_existentes_saem():
    A1 = pm.A_MAX + 1
    est = np.zeros((1, A1))
    est[0, 0] = 100
    m, _, _ = pv.propagar(est, np.zeros((1, 10)), np.full((1, A1), 0.5), np.ones((1, 10)), None)
    assert np.allclose(m[0, :3], [50, 25, 12.5])


def test_separavel_recupera_efeitos():
    rng = np.random.default_rng(0)
    a = np.array([1.1, 1.1, 1.1, 1.1, 1.2, 0.8, 0.7])
    b = np.array([1.0, 1.0, 1.0, 1.05, 1.1, 1.3])
    f = np.array([1.0, 0.7])
    m = (f[:, None, None] * b[None, :, None] * a[None, None, :]).reshape(1, -1)
    den = rng.uniform(1e4, 2e4, size=m.shape)
    num = den * m
    est = pm.separavel(num, den)
    est = est / est[0, 14:21].mean() * m[0, 14:21].mean()
    assert np.allclose(est, m, rtol=1e-3)


def test_faixa_mes():
    assert pm.faixa_mes(date(2026, 2, 1)) == 0
    assert pm.faixa_mes(date(2026, 2, 28)) == 5
    assert pm.faixa_mes(date(2026, 2, 27)) == 4
    assert pm.faixa_mes(date(2026, 3, 26)) == 3
    assert pm.faixa_mes(date(2026, 3, 10)) == 2
