"""Text embedding backends.

Production uses `paraphrase-multilingual-MiniLM-L12-v2` through fastembed
(ONNX, CPU-only, ~220 MB). It was trained so that a sentence and its
translation land close together, which is exactly what cross-lingual story
clustering needs, and it runs comfortably on a free GitHub Actions runner.
"""

from __future__ import annotations

import hashlib
import logging
import re
from pathlib import Path
from typing import Protocol

import numpy as np

log = logging.getLogger(__name__)

EMBEDDING_DIM = 384  # must match vector(384) in db/schema.sql


class Embedder(Protocol):
    dim: int

    def embed(self, texts: list[str]) -> np.ndarray:
        """Return an (n, dim) float32 array of unit-length vectors."""
        ...


def l2_normalize(matrix: np.ndarray) -> np.ndarray:
    matrix = np.asarray(matrix, dtype=np.float32)
    norms = np.linalg.norm(matrix, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    return matrix / norms


class FastEmbedder:
    def __init__(self, model_name: str, cache_dir: Path):
        from fastembed import TextEmbedding  # imported lazily: heavy

        cache_dir.mkdir(parents=True, exist_ok=True)
        log.info("loading embedding model %s", model_name)
        self._model = TextEmbedding(model_name=model_name, cache_dir=str(cache_dir))
        self.dim = EMBEDDING_DIM

    def embed(self, texts: list[str]) -> np.ndarray:
        if not texts:
            return np.zeros((0, self.dim), dtype=np.float32)
        vectors = np.array(list(self._model.embed(texts, batch_size=64)), dtype=np.float32)
        if vectors.shape[1] != self.dim:
            raise ValueError(
                f"Model returns {vectors.shape[1]}-dim vectors but the schema expects {self.dim}. "
                "Change vector(384) in db/schema.sql and EMBEDDING_DIM together."
            )
        return l2_normalize(vectors)


class HashingEmbedder:
    """Deterministic bag-of-words embedder. For tests only: it cannot match
    a Hindi headline to its English counterpart."""

    _token = re.compile(r"[\w\u0900-\u097F]+", re.UNICODE)

    def __init__(self, dim: int = EMBEDDING_DIM):
        self.dim = dim

    def embed(self, texts: list[str]) -> np.ndarray:
        out = np.zeros((len(texts), self.dim), dtype=np.float32)
        for row, text in enumerate(texts):
            for token in self._token.findall(text.lower()):
                digest = hashlib.md5(token.encode("utf-8")).digest()
                out[row, int.from_bytes(digest[:4], "little") % self.dim] += 1.0
        return l2_normalize(out)


def make_embedder(kind: str, model_name: str, cache_dir: Path) -> Embedder:
    if kind == "fastembed":
        return FastEmbedder(model_name, cache_dir)
    if kind == "hashing":
        log.warning("using the hashing embedder: fine for tests, useless for real clustering")
        return HashingEmbedder()
    raise ValueError(f"Unknown EMBEDDER {kind!r} (use 'fastembed' or 'hashing')")
