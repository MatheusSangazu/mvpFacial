"""
vector_math - Logica matematica para comparacao de embeddings faciais.
Usa similaridade por cosseno conforme ADR-004.
"""
import numpy as np


def similaridade_cosseno(vetor_a: list[float], vetor_b: list[float]) -> float:
    """Calcula a similaridade por cosseno entre dois vetores (0..1)."""
    a = np.array(vetor_a)
    b = np.array(vetor_b)
    produto = np.dot(a, b)
    norma = np.linalg.norm(a) * np.linalg.norm(b)
    if norma == 0:
        return 0.0
    return float(produto / norma)


def melhor_score(embedding_atual: list[float], vetores_cadastrados: list[list[float]]) -> float:
    """
    Compara o embedding atual contra todos os cadastrados.
    Retorna o score MAXIMO (ADR-004 - nao usa media).
    """
    scores = [
        similaridade_cosseno(embedding_atual, vc)
        for vc in vetores_cadastrados
    ]
    return max(scores) if scores else 0.0
