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

rad51_thresholds = [0.15, 0.2, 0.25]
prob_thresholds = [0.3, 0.365, 0.4]

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

# --- Process all tiles ---
df_all = []
all_tiles = sorted([f for f in os.listdir(rad51_dir) if f.endswith(".png") and "Probabilities" not in f])

for first_image in all_tiles:
    tile_id = first_image.replace(".png", "")
    print(tile_id)

    rad51_path = os.path.join(rad51_dir, first_image)
    dapi_path = os.path.join(dapi_dir, first_image)
    seg_path = os.path.join(seg_dir, tile_id + "_seg.npy")
    prob_path = os.path.join(rad51_dir, tile_id + "_Probabilities.npy")

    if not os.path.exists(seg_path):
        print(f"⚠️ Skipping {tile_id}: no segmentation file")
        continue

    rad51_raw = imread(rad51_path)
    dapi_raw = imread(dapi_path)

    if rad51_raw.ndim == 3:
        rad51_rgb = rgba2rgb(rad51_raw) if rad51_raw.shape[2] == 4 else rad51_raw
        rad51_gray = (rgb2gray(rad51_rgb) * 255).astype(np.uint8)
    else:
        rad51_rgb = cv2.cvtColor(rad51_raw, cv2.COLOR_GRAY2RGB)
        rad51_gray = rad51_raw

    if dapi_raw.ndim == 3:
        dapi_raw = rgba2rgb(dapi_raw) if dapi_raw.shape[2] == 4 else dapi_raw
        dapi = (rgb2gray(dapi_raw) * 255).astype(np.uint8)
    else:
        dapi = dapi_raw

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
    
    for r in regions:
        print(len(regions))
        region_id = r.label
        area = r.area
        if area == 0:
            continue

        data = {
            "image_id": "A1",
            "tile_id": tile_id,
            "region_id": region_id,
            "area": area
        }

        rad51_norm = (rad51_gray - rad51_gray.min()) / (rad51_gray.max() - rad51_gray.min())

        for th in rad51_thresholds:
            counts, area_pix, coords = detect_blobs(rad51_norm, seg, th)
            data[f"rad51_count_th{th}"] = counts.get(region_id, 0)
            data[f"rad51_area_th{th}"] = area_pix.get(region_id, 0) / area if area > 0 else 0

        for th in prob_thresholds:
            if prob_norm is not None:
                counts, area_pix, coords = detect_blobs(prob_norm, seg, th)
                data[f"prob_count_th{th}"] = counts.get(region_id, 0)
                data[f"prob_area_th{th}"] = area_pix.get(region_id, 0) / area if area > 0 else 0

        df_all.append(data)

# --- Save CSV ---
pd.DataFrame(df_all).to_csv(f"{output_dir}/foci_per_nucleus_multi_threshold.csv", index=False)
print("📊 Saved: foci_per_nucleus_multi_threshold.csv")