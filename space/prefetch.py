"""Download every OCR weight at image build time (YOLO11n, EfficientNetV2-L,
11 PARSeq language checkpoints, English PARSeq from torch.hub)."""
import torch
from IndicPhotoOCR.ocr import OCR
from IndicPhotoOCR.recognition.parseq_recogniser import PARseqrecogniser, model_info

ocr = OCR(device="cpu", detector="yolo", identifier_lang="auto", identifier_type="efficientnet")
rec = PARseqrecogniser()
for lang in model_info:
    rec.ensure_model(lang)
torch.hub.load("baudm/parseq", "parseq", pretrained=True, trust_repo=True)
print("all OCR weights cached")
