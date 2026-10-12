#!/usr/bin/env python3
"""把音频转成带词级时间戳的 JSON。苹果芯片优先用 MLX，其余系统用 faster-whisper。"""

from __future__ import annotations

import argparse
import json
import sys

MLX_MODELS = {
    "precise": "mlx-community/whisper-large-v3-turbo",
    "fast": "mlx-community/whisper-medium-mlx",
}
FASTER_MODELS = {
    "precise": "large-v3-turbo",
    "fast": "medium",
}


def word_row(word: str, start: float, end: float) -> dict:
    return {"word": word or "", "start": float(start), "end": float(end)}


def write_payload(path: str, language: str, model: str, segments: list) -> None:
    payload = {"language": language, "model": model, "segments": segments}
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False)
    print(
        json.dumps({"language": language, "segments": len(segments)}, ensure_ascii=False),
        flush=True,
    )


def transcribe_mlx(audio: str, quality: str, language: str) -> tuple[str, str, list]:
    import mlx_whisper

    repo = MLX_MODELS[quality]
    kwargs = {"path_or_hf_repo": repo, "word_timestamps": True, "verbose": False}
    if language:
        kwargs["language"] = language
    print(f"模型 {repo}", file=sys.stderr, flush=True)
    result = mlx_whisper.transcribe(audio, **kwargs)
    segments = []
    for seg in result.get("segments") or []:
        words = []
        for word in seg.get("words") or []:
            if word.get("start") is None or word.get("end") is None:
                continue
            words.append(word_row(word.get("word") or "", word["start"], word["end"]))
        segments.append(
            {
                "start": float(seg.get("start") or 0),
                "end": float(seg.get("end") or 0),
                "text": seg.get("text") or "",
                "words": words,
            }
        )
    return repo, result.get("language") or language or "", segments


def transcribe_faster(audio: str, quality: str, language: str) -> tuple[str, str, list]:
    from faster_whisper import WhisperModel

    name = FASTER_MODELS[quality]
    print(f"模型 {name}", file=sys.stderr, flush=True)
    model = None
    last_error = ""
    for device, compute in (("cuda", "float16"), ("cpu", "int8")):
        try:
            model = WhisperModel(name, device=device, compute_type=compute)
            break
        except Exception as exc:
            last_error = str(exc)
    if model is None:
        raise RuntimeError(last_error or "无法加载转写模型")

    kwargs = {"word_timestamps": True}
    if language:
        kwargs["language"] = language
    iterator, info = model.transcribe(audio, **kwargs)
    segments = []
    for seg in iterator:
        words = []
        for word in seg.words or []:
            if word.start is None or word.end is None:
                continue
            words.append(word_row(word.word or "", word.start, word.end))
        segments.append(
            {
                "start": float(seg.start or 0),
                "end": float(seg.end or 0),
                "text": seg.text or "",
                "words": words,
            }
        )
    detected = getattr(info, "language", "") or language or ""
    return name, detected, segments


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("audio")
    parser.add_argument("--output", required=True)
    parser.add_argument("--quality", choices=["precise", "fast"], default="precise")
    parser.add_argument("--language", default="")
    args = parser.parse_args()

    try:
        import mlx_whisper  # noqa: F401
    except ImportError:
        mlx_whisper = None
    try:
        import faster_whisper  # noqa: F401
    except ImportError:
        faster_whisper = None

    if mlx_whisper is not None:
        model, language, segments = transcribe_mlx(args.audio, args.quality, args.language)
    elif faster_whisper is not None:
        model, language, segments = transcribe_faster(args.audio, args.quality, args.language)
    else:
        print(
            "没有可用的转写库。苹果芯片请安装 mlx-whisper；Windows 和其他系统请安装 faster-whisper。",
            file=sys.stderr,
        )
        sys.exit(2)

    write_payload(args.output, language, model, segments)


if __name__ == "__main__":
    main()
