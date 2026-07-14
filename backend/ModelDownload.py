"""
ModelDownload.py
>>>>>>> origin/development

Pre-downloads/caches the models used by this project so that later runs
don't have to fetch them on first use:

    1. Whisper speech-to-text model (via openai-whisper)              -> ./models/whisper
    2. hexgrad/Kokoro-82M text-to-speech model (+ voice packs)         -> ./KokoroTTS/models/kokoro-82m
    3. sentence-transformers embedding model (ERP tool retrieval)      -> ./ERP/models/all-MiniLM-L6-v2

Each model is downloaded into its own separate directory (see defaults below).

Requirements:

    pip install openai-whisper huggingface-hub sentence-transformers


Usage:
    python download_models.py
    python download_models.py --whisper-model base --skip-kokoro
    python download_models.py --whisper-dir ./models/whisper --kokoro-dir ./KokoroTTS/models/kokoro-82m --tool-rag-dir ./ERP/models/all-MiniLM-L6-v2
"""

import argparse
import os

import whisper
from huggingface_hub import snapshot_download


KOKORO_REPO_ID = "hexgrad/Kokoro-82M"
TOOL_RAG_REPO_ID = "sentence-transformers/all-MiniLM-L6-v2"

DEFAULT_WHISPER_DIR = "./models/whisper"
DEFAULT_KOKORO_DIR = "./KokoroTTS/models/kokoro-82m"
DEFAULT_TOOL_RAG_DIR = "./ERP/models/all-MiniLM-L6-v2"


def download_whisper_model(model_size: str = "base", download_dir: str = DEFAULT_WHISPER_DIR):

    """Download and cache the Whisper model in a specific local directory."""
    print(f"[Whisper] Downloading size '{model_size}' to '{download_dir}'...")
    os.makedirs(download_dir, exist_ok=True)
    whisper.load_model(model_size, download_root=download_dir)
    print("[Whisper] Model downloaded successfully.\n")

    return download_dir


def download_kokoro_model(local_dir: str = DEFAULT_KOKORO_DIR):
    """Download the Kokoro-82M TTS model (weights + voice packs) from Hugging
    Face into its own directory so it loads from disk instead of hitting the
    Hub on every run."""
    os.makedirs(local_dir, exist_ok=True)
    print(f"[Kokoro] Downloading '{KOKORO_REPO_ID}' to '{local_dir}'...")
    path = snapshot_download(repo_id=KOKORO_REPO_ID, local_dir=local_dir)
    print(f"[Kokoro] Model downloaded to: {path}\n")
    return path


def download_tool_rag_model(local_dir: str = DEFAULT_TOOL_RAG_DIR):

    """Download the tool RAG embedding model into its own directory."""
    print(f"[ToolRAG] Downloading '{TOOL_RAG_REPO_ID}' to '{local_dir}'...")
    os.makedirs(local_dir, exist_ok=True)

    path = snapshot_download(repo_id=TOOL_RAG_REPO_ID, local_dir=local_dir)
    print(f"[ToolRAG] Model downloaded to: {path}\n")
    return path


def main():
    parser = argparse.ArgumentParser(description="Download Whisper and Kokoro models.")
    parser.add_argument(
        "--whisper-model",
        default="base",

        help=f"Size of the Whisper model to download (default: base).",
    )
    parser.add_argument(
        "--whisper-dir",
        default=DEFAULT_WHISPER_DIR,
        help=f"Local directory to store the Whisper model (default: {DEFAULT_WHISPER_DIR}).",
    )
    parser.add_argument(
        "--kokoro-dir",
        default=DEFAULT_KOKORO_DIR,
        help=f"Local directory to store the Kokoro model (default: {DEFAULT_KOKORO_DIR}).",
    )
    parser.add_argument(
        "--tool-rag-dir",
        default=DEFAULT_TOOL_RAG_DIR,
        help=f"Local directory to store the ToolRAG embedding model (default: {DEFAULT_TOOL_RAG_DIR}).",
    )
    parser.add_argument("--skip-whisper", action="store_true", help="Skip downloading the Whisper model.")
    parser.add_argument("--skip-kokoro", action="store_true", help="Skip downloading the Kokoro model.")
    parser.add_argument("--skip-tool-rag", action="store_true", help="Skip downloading the ToolRAG embedding model.")
    args = parser.parse_args()

    if not args.skip_whisper:
        download_whisper_model(args.whisper_model, args.whisper_dir)

    if not args.skip_kokoro:
        download_kokoro_model(args.kokoro_dir)

    if not args.skip_tool_rag:
        download_tool_rag_model(args.tool_rag_dir)



if __name__ == "__main__":
    main()