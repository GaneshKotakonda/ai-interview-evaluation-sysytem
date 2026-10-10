"""Download the identity-verification models into backend/models.

    python backend/download_models.py            (from the repository root)

Each file is checked against a pinned SHA-256 so a changed or corrupted
download is rejected. Already-downloaded files are verified and skipped.

  * NVIDIA NeMo TitaNet-small speaker embeddings (ONNX export from sherpa-onnx releases)
  * OpenCV Zoo YuNet face detector and SFace face recogniser
"""
import hashlib
import os
import sys
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import config  # noqa: E402

MODELS = {
    "nemo_en_titanet_small.onnx": (
        "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/"
        "nemo_en_titanet_small.onnx",
        "ad4a1802485d8b34c722d2a9d04249662f2ece5d28a7a039063ca22f515a789e",
    ),
    "face_detection_yunet_2023mar.onnx": (
        "https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/"
        "face_detection_yunet/face_detection_yunet_2023mar.onnx",
        "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4",
    ),
    "face_recognition_sface_2021dec.onnx": (
        "https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/"
        "face_recognition_sface/face_recognition_sface_2021dec.onnx",
        "0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79",
    ),
}


def sha256(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def main() -> int:
    os.makedirs(config.IDENTITY_MODEL_DIR, exist_ok=True)
    for name, (url, expected) in MODELS.items():
        path = os.path.join(config.IDENTITY_MODEL_DIR, name)
        if os.path.isfile(path) and sha256(path) == expected:
            print(f"ok       {name}")
            continue
        print(f"download {name}")
        temporary = f"{path}.part"
        urllib.request.urlretrieve(url, temporary)
        if sha256(temporary) != expected:
            os.remove(temporary)
            print(f"checksum mismatch for {name}", file=sys.stderr)
            return 1
        os.replace(temporary, path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
