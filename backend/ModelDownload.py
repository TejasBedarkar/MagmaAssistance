"""
download_models.py

Pre-downloads/caches the models used by this project so that later runs
don't have to fetch them on first use:

    1. Whisper speech-to-text model (via openai-whisper)              -> ./models/whisper
<<<<<<< HEAD
    2. hexgrad/Kokoro-82M text-to-speech model (+ voice packs)         -> ./KokoroTTS/models/kokoro-82m
=======
    2. microsoft/VibeVoice-Realtime-0.5B text-to-speech model          -> ./VibeVoiceTTS/models/vibevoice-realtime-0.5b
>>>>>>> 02e86db2a04e8c9d90530a261555a3f28a31bf27
    3. sentence-transformers embedding model (ERP tool retrieval)      -> ./ERP/models/all-MiniLM-L6-v2

Each model is downloaded into its own separate directory (see defaults below).

Requirements:
    pip install openai-whisper huggingface_hub

Usage:
    python download_models.py
<<<<<<< HEAD
    python download_models.py --whisper-model base --skip-kokoro
    python download_models.py --whisper-dir ./models/whisper --kokoro-dir ./KokoroTTS/models/kokoro-82m --tool-rag-dir ./ERP/models/all-MiniLM-L6-v2
=======
    python download_models.py --whisper-model base --skip-vibevoice
    python download_models.py --whisper-dir ./models/whisper --vibevoice-dir ./models/vibevoice-realtime-0.5b --tool-rag-dir ./ERP/models/all-MiniLM-L6-v2
>>>>>>> 02e86db2a04e8c9d90530a261555a3f28a31bf27
"""

import argparse
import os

import whisper
from huggingface_hub import snapshot_download


<<<<<<< HEAD
KOKORO_REPO_ID = "hexgrad/Kokoro-82M"
TOOL_RAG_REPO_ID = "sentence-transformers/all-MiniLM-L6-v2"

DEFAULT_WHISPER_DIR = "./models/whisper"
DEFAULT_KOKORO_DIR = "./KokoroTTS/models/kokoro-82m"
=======
VIBEVOICE_REPO_ID = "microsoft/VibeVoice-Realtime-0.5B"
TOOL_RAG_REPO_ID = "sentence-transformers/all-MiniLM-L6-v2"

DEFAULT_WHISPER_DIR = "./models/whisper"
DEFAULT_VIBEVOICE_DIR = "./VibeVoiceTTS/models/vibevoice-realtime-0.5b"
>>>>>>> 02e86db2a04e8c9d90530a261555a3f28a31bf27
DEFAULT_TOOL_RAG_DIR = "./ERP/models/all-MiniLM-L6-v2"


def download_whisper_model(model_size: str = "base", download_dir: str = DEFAULT_WHISPER_DIR):
    os.makedirs(download_dir, exist_ok=True)
    print(f"[Whisper] Downloading '{model_size}' model to '{download_dir}'...")
    whisper.load_model(model_size, download_root=download_dir)
    print(f"[Whisper] '{model_size}' model ready at: {download_dir}\n")
    return download_dir


<<<<<<< HEAD
def download_kokoro_model(local_dir: str = DEFAULT_KOKORO_DIR):
    """Download the Kokoro-82M TTS model (weights + voice packs) from Hugging
    Face into its own directory so it loads from disk instead of hitting the
    Hub on every run."""
    os.makedirs(local_dir, exist_ok=True)
    print(f"[Kokoro] Downloading '{KOKORO_REPO_ID}' to '{local_dir}'...")
    path = snapshot_download(repo_id=KOKORO_REPO_ID, local_dir=local_dir)
    print(f"[Kokoro] Model downloaded to: {path}\n")
=======
def download_vibevoice_model(local_dir: str = DEFAULT_VIBEVOICE_DIR):
    """Download the VibeVoice-Realtime-0.5B model from Hugging Face into its own directory."""
    os.makedirs(local_dir, exist_ok=True)
    print(f"[VibeVoice] Downloading '{VIBEVOICE_REPO_ID}' to '{local_dir}'...")
    path = snapshot_download(repo_id=VIBEVOICE_REPO_ID, local_dir=local_dir)
    print(f"[VibeVoice] Model downloaded to: {path}\n")
>>>>>>> 02e86db2a04e8c9d90530a261555a3f28a31bf27
    return path


def download_tool_rag_model(local_dir: str = DEFAULT_TOOL_RAG_DIR):
    """Download the sentence-transformers embedding model used by
    ERP/tool_rag.py for ERP tool retrieval, into its own directory so it
    loads from disk instead of hitting the Hub on every run."""
    os.makedirs(local_dir, exist_ok=True)
    print(f"[ToolRAG] Downloading '{TOOL_RAG_REPO_ID}' to '{local_dir}'...")
    path = snapshot_download(repo_id=TOOL_RAG_REPO_ID, local_dir=local_dir)
    print(f"[ToolRAG] Model downloaded to: {path}\n")
    return path


def main():
<<<<<<< HEAD
    parser = argparse.ArgumentParser(description="Download Whisper and Kokoro models.")
=======
    parser = argparse.ArgumentParser(description="Download Whisper and VibeVoice models.")
>>>>>>> 02e86db2a04e8c9d90530a261555a3f28a31bf27
    parser.add_argument(
        "--whisper-model",
        default="base",
        choices=["tiny", "base", "small", "medium", "large"],
        help="Which Whisper model size to download (default: base).",
    )
    parser.add_argument(
        "--whisper-dir",
        default=DEFAULT_WHISPER_DIR,
        help=f"Local directory to store the Whisper model (default: {DEFAULT_WHISPER_DIR}).",
    )
    parser.add_argument(
<<<<<<< HEAD
        "--kokoro-dir",
        default=DEFAULT_KOKORO_DIR,
        help=f"Local directory to store the Kokoro model (default: {DEFAULT_KOKORO_DIR}).",
=======
        "--vibevoice-dir",
        default=DEFAULT_VIBEVOICE_DIR,
        help=f"Local directory to store the VibeVoice model (default: {DEFAULT_VIBEVOICE_DIR}).",
>>>>>>> 02e86db2a04e8c9d90530a261555a3f28a31bf27
    )
    parser.add_argument(
        "--tool-rag-dir",
        default=DEFAULT_TOOL_RAG_DIR,
        help=f"Local directory to store the ToolRAG embedding model (default: {DEFAULT_TOOL_RAG_DIR}).",
    )
    parser.add_argument("--skip-whisper", action="store_true", help="Skip downloading the Whisper model.")
<<<<<<< HEAD
    parser.add_argument("--skip-kokoro", action="store_true", help="Skip downloading the Kokoro model.")
=======
    parser.add_argument("--skip-vibevoice", action="store_true", help="Skip downloading the VibeVoice model.")
>>>>>>> 02e86db2a04e8c9d90530a261555a3f28a31bf27
    parser.add_argument("--skip-tool-rag", action="store_true", help="Skip downloading the ToolRAG embedding model.")
    args = parser.parse_args()

    if not args.skip_whisper:
        download_whisper_model(args.whisper_model, args.whisper_dir)

<<<<<<< HEAD
    if not args.skip_kokoro:
        download_kokoro_model(args.kokoro_dir)
=======
    if not args.skip_vibevoice:
        download_vibevoice_model(args.vibevoice_dir)
>>>>>>> 02e86db2a04e8c9d90530a261555a3f28a31bf27

    if not args.skip_tool_rag:
        download_tool_rag_model(args.tool_rag_dir)

    print("All requested models are downloaded and ready.")


if __name__ == "__main__":
    main()