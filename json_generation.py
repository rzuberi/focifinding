import os
import numpy as np
import pandas as pd
from math import pi, sqrt
from skimage.io import imread
from skimage.color import rgba2rgb, rgb2gray
from skimage.measure import regionprops
import json

# --- Configuration ---
base_dir = "images/A1"
rad51_dir = os.path.join(base_dir, "rad51")
dapi_dir = os.path.join(base_dir, "dapi")
seg_dir = os.path.join(base_dir, "dapi")
output_json_dir = "data"
os.makedirs(output_json_dir, exist_ok=True)

rad51_thresholds = [0.15, 0.2, 0.25]
prob_thresholds = [0.3, 0.365, 0.4]

min_sigma = 1
max_sigma = 4

# --- Utility: blob detection ---
def detect_blobs(img, seg, threshold):
    from skimage.feature import blob_log
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
rad51_tiles = sorted([f for f in os.listdir(rad51_dir) if f.endswith(".png") and "Probabilities" not in f])
tile_index = []

for tile_filename in rad51_tiles:
    tile_id = tile_filename.replace(".png", "")
    tile_index.append(tile_id)
    rad51_path = os.path.join(rad51_dir, tile_filename)
    dapi_path = os.path.join(dapi_dir, tile_filename)
    seg_path = os.path.join(seg_dir, tile_id + "_seg.npy")
    prob_path = os.path.join(rad51_dir, tile_id + "_Probabilities.npy")

    if not os.path.exists(seg_path):
        print(f"⚠️ Segmentation not found for {tile_id}, skipping.")
        continue

    rad51_raw = imread(rad51_path)
    dapi_raw = imread(dapi_path)

    if rad51_raw.ndim == 3:
        rad51_rgb = rgba2rgb(rad51_raw) if rad51_raw.shape[2] == 4 else rad51_raw
        rad51_gray = (rgb2gray(rad51_rgb) * 255).astype(np.uint8)
    else:
        rad51_gray = rad51_raw

    if dapi_raw.ndim == 3:
        dapi_rgb = rgba2rgb(dapi_raw) if dapi_raw.shape[2] == 4 else dapi_raw
        dapi_gray = (rgb2gray(dapi_rgb) * 255).astype(np.uint8)
    else:
        dapi_gray = dapi_raw

    prob = np.load(prob_path) if os.path.exists(prob_path) else None
    if prob is not None and prob.ndim == 3 and prob.shape[-1] == 2:
        prob = prob[..., 1]
    if prob is not None:
        prob_norm = (prob - prob.min()) / (prob.max() - prob.min())
    else:
        prob_norm = None

    seg = np.load(seg_path, allow_pickle=True).item()['masks']
    regions = regionprops(seg)

    nuclei_data = []

    rad51_norm = (rad51_gray - rad51_gray.min()) / (rad51_gray.max() - rad51_gray.min())

    for r in regions:
        region_id = r.label
        area = r.area
        centroid = [float(c) for c in r.centroid]
        coords = list(zip(*np.where(seg == region_id)))

        data = {
            "region_id": region_id,
            "area": area,
            "centroid": centroid,
            "pixel_coords": coords
        }

        for th in rad51_thresholds:
            counts, area_pix, coord_list = detect_blobs(rad51_norm, seg, th)
            data[f"rad51_count_th{th}"] = counts.get(region_id, 0)
            data[f"rad51_area_th{th}"] = area_pix.get(region_id, 0) / area if area > 0 else 0
            data[f"rad51_coords_th{th}"] = [[int(y), int(x)] for nid, x, y, sigma in coord_list if nid == region_id]

        for th in prob_thresholds:
            if prob_norm is not None:
                counts, area_pix, coord_list = detect_blobs(prob_norm, seg, th)
                data[f"prob_count_th{th}"] = counts.get(region_id, 0)
                data[f"prob_area_th{th}"] = area_pix.get(region_id, 0) / area if area > 0 else 0
                data[f"prob_coords_th{th}"] = [[int(y), int(x)] for nid, x, y, sigma in coord_list if nid == region_id]

        nuclei_data.append(data)

    tile_json = {
        "tile_id": tile_id,
        "rad51_image": f"images/A1/rad51/{tile_id}.png",
        "dapi_image": f"images/A1/dapi/{tile_id}.png",
        "nuclei": nuclei_data
    }

    def convert_numpy(obj):
        if isinstance(obj, (np.integer, np.int32, np.int64)):
            return int(obj)
        elif isinstance(obj, (np.floating, np.float32, np.float64)):
            return float(obj)
        elif isinstance(obj, (np.ndarray,)):
            return obj.tolist()
        return obj

    with open(os.path.join(output_json_dir, f"{tile_id}.json"), "w") as f:
        json.dump(tile_json, f, indent=2, default=convert_numpy)

    print(f"✅ Saved JSON for {tile_id}")

with open(os.path.join(output_json_dir, "index.json"), "w") as f:
    json.dump({"A1": tile_index}, f, indent=2)

print("✅ Saved index.json")