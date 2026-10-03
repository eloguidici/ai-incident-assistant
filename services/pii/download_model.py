"""Build-only verified TLS download; no runtime credentials or downloads."""

import hashlib
import json
from pathlib import Path
import shutil

from huggingface_hub import hf_hub_download


def install_model() -> None:
    """Install pinned model/tokenizer in /opt/model; raise on any download failure."""
    lock = json.loads(Path("model-lock.json").read_text())
    destination = Path("/opt/model")
    destination.mkdir(parents=True, exist_ok=True)
    for repository, revision, filenames in (
        (lock["model"], lock["revision"], ("gliner_config.json", "model.safetensors")),
        (lock["tokenizer"], lock["tokenizerRevision"], ("config.json", "tokenizer_config.json", "spm.model")),
    ):
        for filename in filenames:
            source = hf_hub_download(repository, filename, revision=revision, cache_dir="/tmp/model-download")
            shutil.copyfile(source, destination / filename)
    # The backbone architecture and tokenizer are local; GLiNER supplies all weights.
    configuration = json.loads((destination / "gliner_config.json").read_text())
    configuration["model_name"] = str(destination)
    (destination / "gliner_config.json").write_text(json.dumps(configuration))
    lock["filesSha256"] = {
        path.name: hashlib.file_digest(path.open("rb"), "sha256").hexdigest()
        for path in sorted(destination.iterdir()) if path.is_file()
    }
    (destination / "manifest.json").write_text(json.dumps(lock, indent=2))


if __name__ == "__main__":
    install_model()
