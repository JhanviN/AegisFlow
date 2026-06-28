"""PII masking engine combining Presidio and Hugging Face NER."""

from __future__ import annotations

import logging
import os
import re
from dataclasses import dataclass
from typing import Any

from presidio_analyzer import AnalyzerEngine
from presidio_anonymizer import AnonymizerEngine
from presidio_anonymizer.entities import OperatorConfig
from transformers import pipeline

logger = logging.getLogger(__name__)

MODEL_NAME = os.getenv("MODEL_NAME", "elastic/distilbert-base-uncased-finetuned-conll03-english")
LABEL_PREFIX = "AEGIS_"


@dataclass
class MaskResult:
    masked_text: str
    mapping: dict[str, str]
    entities_found: int
    engine: str


class PiiMaskingEngine:
    def __init__(self) -> None:
        self._analyzer = AnalyzerEngine()
        self._anonymizer = AnonymizerEngine()
        self._ner_pipeline = pipeline(
            "ner",
            model=MODEL_NAME,
            aggregation_strategy="simple",
        )
        self._entity_counter = 0
        logger.info("PII masking engine initialized with model %s", MODEL_NAME)

    def _next_placeholder(self, entity_type: str) -> str:
        self._entity_counter += 1
        safe_type = re.sub(r"[^A-Z0-9_]", "_", entity_type.upper())
        return f"{LABEL_PREFIX}{safe_type}_{self._entity_counter}"

    def _merge_entities(
        self,
        presidio_results: list[Any],
        hf_results: list[dict[str, Any]],
    ) -> list[tuple[int, int, str, str]]:
        """Merge Presidio and HF NER detections, deduplicating overlaps."""
        entities: list[tuple[int, int, str, str]] = []

        for result in presidio_results:
            entities.append(
                (result.start, result.end, result.entity_type, "presidio")
            )

        for result in hf_results:
            entity_group = result.get("entity_group", result.get("entity", "MISC"))
            start = int(result["start"])
            end = int(result["end"])
            mapped_type = self._map_hf_label(entity_group)
            entities.append((start, end, mapped_type, "hf_ner"))

        entities.sort(key=lambda e: (e[0], -(e[1] - e[0])))
        merged: list[tuple[int, int, str, str]] = []
        for start, end, etype, source in entities:
            if any(start < m_end and end > m_start for m_start, m_end, _, _ in merged):
                continue
            merged.append((start, end, etype, source))

        return sorted(merged, key=lambda e: e[0], reverse=True)

    @staticmethod
    def _map_hf_label(label: str) -> str:
        mapping = {
            "PER": "PERSON",
            "PERSON": "PERSON",
            "ORG": "ORGANIZATION",
            "ORGANIZATION": "ORGANIZATION",
            "LOC": "LOCATION",
            "LOCATION": "LOCATION",
            "MISC": "MISC",
        }
        return mapping.get(label.upper().replace("B-", "").replace("I-", ""), label)

    def mask(self, text: str) -> MaskResult:
        self._entity_counter = 0
        mapping: dict[str, str] = {}

        presidio_results = self._analyzer.analyze(
            text=text,
            language="en",
            entities=None,
        )

        hf_results = self._ner_pipeline(text)
        merged = self._merge_entities(presidio_results, hf_results)

        masked = text
        for start, end, entity_type, _source in merged:
            original = text[start:end]
            if not original.strip():
                continue

            placeholder = self._next_placeholder(entity_type)
            if placeholder not in mapping:
                mapping[placeholder] = original
            masked = masked[:start] + placeholder + masked[end:]

        return MaskResult(
            masked_text=masked,
            mapping=mapping,
            entities_found=len(mapping),
            engine="presidio+hf_ner",
        )

    def mask_with_presidio_only(self, text: str) -> MaskResult:
        """Fallback using Presidio operators when HF pipeline unavailable."""
        self._entity_counter = 0
        mapping: dict[str, str] = {}

        results = self._analyzer.analyze(text=text, language="en")
        operators: dict[str, OperatorConfig] = {}

        for result in results:
            entity_type = result.entity_type
            if entity_type not in operators:
                placeholder = self._next_placeholder(entity_type)
                mapping[placeholder] = text[result.start : result.end]
                operators[entity_type] = OperatorConfig(
                    "replace", {"new_value": placeholder}
                )

        anonymized = self._anonymizer.anonymize(
            text=text,
            analyzer_results=results,
            operators=operators,
        )

        return MaskResult(
            masked_text=anonymized.text,
            mapping=mapping,
            entities_found=len(mapping),
            engine="presidio_only",
        )


_engine: PiiMaskingEngine | None = None


def get_engine() -> PiiMaskingEngine:
    global _engine
    
    if _engine is None:
        _engine = PiiMaskingEngine()
    return _engine
