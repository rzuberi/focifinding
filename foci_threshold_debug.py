import os
import numpy as np
import pandas as pd
from math import pi, sqrt
from skimage.io import imread, imsave
from skimage.feature import blob_log
from skimage.color import rgba2rgb, rgb2gray
from skimage.measure import regionprops
import matplotlib.pyplot as plt
import cv2
import random

# --- Configuration ---
base_dir = "images/A1"
rad51_dir = os.path.join(base_dir, "rad51")
dapi_dir = os.path.join(base_dir, "dapi")
seg_dir = os.path.join(base_dir, "dapi")

output_dir = "outputs"
os.makedirs(output_dir, exist_ok=True)
os.makedirs(f"{output_dir}/visuals", exist_ok=True)

rad51_thresholds = [0.05, 0.10, 0.15, 0.2, 0.25]
prob_thresholds = [0.2, 0.25, 0.3, 0.35, 0.4]

min_sigma = 1
max_sigma = 4

# --- Utility: blob detection ---
def detect_blobs(img, seg, threshold):
    blobs = blob_log(img, min_sigma=min_sigma, max_sigma=max_sigma, threshold=threshold)
    counts = {}
    area_pix = {}
    coords = []
    for blob in blobs:
        if len(blob) < 3:
            continue
        y, x, sigma = blob[:3]
        y, x = int(y), int(x)
        if 0 <= y < seg.shape[0] and 0 <= x < seg.shape[1]:
            nuc_id = seg[y, x]
            if nuc_id > 0:
                counts[nuc_id] = counts.get(nuc_id, 0) + 1
                area_pix[nuc_id] = area_pix.get(nuc_id, 0) + pi * sigma**2
                coords.append((nuc_id, x, y, sigma))
    return counts, area_pix, coords

# --- Generate debug nucleus visuals from first image ---
first_image = sorted([f for f in os.listdir(rad51_dir) if f.endswith(".png") and "Probabilities" not in f])[0]
tile_id = first_image.replace(".png", "")

rad51_path = os.path.join(rad51_dir, first_image)
dapi_path = os.path.join(dapi_dir, first_image)
seg_path = os.path.join(seg_dir, tile_id + "_seg.npy")
prob_path = os.path.join(rad51_dir, tile_id + "_Probabilities.npy")

rad51_raw = imread(rad51_path)
if rad51_raw.ndim == 3:
    rad51_rgb = rgba2rgb(rad51_raw) if rad51_raw.shape[2] == 4 else rad51_raw
else:
    rad51_rgb = cv2.cvtColor(rad51_raw, cv2.COLOR_GRAY2RGB)

rad51_gray = (rgb2gray(rad51_rgb) * 255).astype(np.uint8)

prob = np.load(prob_path) if os.path.exists(prob_path) else None
if prob is not None:
    if prob.shape[-1] == 2:
        prob = prob[..., 1]  # Take the second channel
    if prob.ndim != 2:
        raise ValueError(f"Expected 2D probability image but got shape: {prob.shape}")
    prob_norm = (prob - prob.min()) / (prob.max() - prob.min())
else:
    prob_norm = None

seg = np.load(seg_path, allow_pickle=True).item()['masks']
regions = regionprops(seg)
random.seed(42)
region_ids = [r.label for r in regions if r.area > 0]
selected_nuclei = random.sample(region_ids, min(20, len(region_ids)))

for r in regions:
    region_id = r.label
    area = r.area
    if area == 0 or region_id not in selected_nuclei:
        continue

    crop = r.bbox
    minr, minc, maxr, maxc = crop
    pad = 10
    minr, minc = max(0, minr - pad), max(0, minc - pad)
    maxr, maxc = min(seg.shape[0], maxr + pad), min(seg.shape[1], maxc + pad)

    base_crop = (rad51_rgb[minr:maxr, minc:maxc] * 255).astype(np.uint8) if rad51_rgb.max() <= 1 else rad51_rgb[minr:maxr, minc:maxc]

    panels = [base_crop.copy()]
    titles = ["Nucleus\n(no overlay)"]

    rad51_norm = (rad51_gray - rad51_gray.min()) / (rad51_gray.max() - rad51_gray.min())

    for th in rad51_thresholds:
        counts, area_pix, coords = detect_blobs(rad51_norm, seg, th)
        sub = base_crop.copy()
        for nid, x, y, sigma in coords:
            if nid == region_id:
                cx, cy = x - minc, y - minr
                cv2.circle(sub, (cx, cy), int(sqrt(2) * sigma), (0, 255, 255), 1)
        panels.append(sub)
        titles.append(f"RAD51\nth={th:.3f}")

    for th in prob_thresholds:
        if prob_norm is not None:
            counts, area_pix, coords = detect_blobs(prob_norm, seg, th)
            sub = base_crop.copy()
            for nid, x, y, sigma in coords:
                if nid == region_id:
                    cx, cy = x - minc, y - minr
                    cv2.circle(sub, (cx, cy), int(sqrt(2) * sigma), (255, 0, 255), 1)
            panels.append(sub)
            titles.append(f"Prob\nth={th:.3f}")

    if panels:
        concat = cv2.hconcat(panels)
        fig, ax = plt.subplots(figsize=(len(panels) * 3, 3))
        ax.imshow(cv2.cvtColor(concat, cv2.COLOR_BGR2RGB))
        ax.axis('off')
        for i, title in enumerate(titles):
            ax.text(i * concat.shape[1] // len(panels) + 10, -10, title, color='black', fontsize=8,
                    backgroundcolor='white', fontweight='bold', va='top')
        vis_path = f"{output_dir}/visuals/debug_nucleus_{region_id}.png"
        fig.savefig(vis_path, bbox_inches='tight', dpi=200)
        plt.close(fig)
        print(f"✅ Saved: {vis_path}")
