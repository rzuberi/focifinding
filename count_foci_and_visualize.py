import os
import numpy as np
from math import pi
from skimage.io import imread, imsave
from skimage.feature import blob_log
import cv2
from skimage.color import rgba2rgb, rgb2gray
from skimage.measure import regionprops
import pandas as pd

# --- Configuration ---
base_dir = "images/A1"
rad51_dir = os.path.join(base_dir, "rad51")
dapi_dir = os.path.join(base_dir, "dapi")
seg_dir = os.path.join(base_dir, "dapi")

RAD51_BLOB_THRESHOLD = 0.2
PROB_BLOB_THRESHOLD = 0.365
min_sigma = 1
max_sigma = 4

# --- Output directories ---
os.makedirs("outputs/annotated_rad51", exist_ok=True)
os.makedirs("outputs/annotated_dapi", exist_ok=True)

df_all = []

for fname in sorted(os.listdir(rad51_dir)):
    if not fname.endswith(".png") or "_Probabilities" in fname:
        continue

    tile_id = fname.replace(".png", "")
    rad51_path = os.path.join(rad51_dir, fname)
    dapi_path = os.path.join(dapi_dir, fname)
    seg_path = os.path.join(seg_dir, tile_id + "_seg.npy")
    prob_path = os.path.join(rad51_dir, tile_id + "_Probabilities.npy")

    if not os.path.exists(seg_path):
        print(f"❌ Segmentation not found for {tile_id}")
        continue

    # Load RAD51
    rad51_raw = imread(rad51_path)
    if rad51_raw.ndim == 3:
        if rad51_raw.shape[2] == 4:
            rad51_rgb = rgba2rgb(rad51_raw)
        else:
            rad51_rgb = rad51_raw
        rad51 = (rgb2gray(rad51_rgb) * 255).astype(np.uint8)
    else:
        rad51 = rad51_raw

    # Load DAPI
    dapi_raw = imread(dapi_path)
    if dapi_raw.ndim == 3:
        if dapi_raw.shape[2] == 4:
            dapi_rgb = rgba2rgb(dapi_raw)
        else:
            dapi_rgb = dapi_raw
        dapi = (rgb2gray(dapi_rgb) * 255).astype(np.uint8)
    else:
        dapi = dapi_raw

    # Load segmentation
    loaded = np.load(seg_path, allow_pickle=True).item()
    seg = loaded['masks']

    # ---- RAD51 foci detection ----
    rad51_norm = (rad51 - rad51.min()) / (rad51.max() - rad51.min())
    blobs_rad51 = blob_log(rad51_norm, min_sigma=min_sigma, max_sigma=max_sigma, threshold=RAD51_BLOB_THRESHOLD)
    foci_coords_rad51 = blobs_rad51[:, :2].astype(int)

    foci_counts_rad51 = {}
    foci_pixels_rad51 = {}
    for y, x, sigma in blobs_rad51:
        if 0 <= y < seg.shape[0] and 0 <= x < seg.shape[1]:
            nuc_id = seg[int(y), int(x)]
            if nuc_id > 0:
                foci_counts_rad51[nuc_id] = foci_counts_rad51.get(nuc_id, 0) + 1
                foci_pixels_rad51[nuc_id] = foci_pixels_rad51.get(nuc_id, 0) + pi * sigma**2

    # ---- Probability foci detection ----
    foci_counts_probs = {}
    foci_pixels_probs = {}

    if os.path.exists(prob_path):
        prob = np.load(prob_path)
        prob_vis = ((prob - prob.min()) / (prob.max() - prob.min()) * 255).astype(np.uint8)
        imsave(f"outputs/annotated_rad51/{tile_id}_probabilities.png", prob_vis)

        prob_norm = (prob - prob.min()) / (prob.max() - prob.min())
        blobs_probs = blob_log(prob_norm, min_sigma=min_sigma, max_sigma=max_sigma, threshold=PROB_BLOB_THRESHOLD)
        foci_coords_probs = blobs_probs[:, :2].astype(int)

        for blob in blobs_probs:
            if len(blob) >= 3:
                y, x, sigma = blob[:3]
                if 0 <= y < seg.shape[0] and 0 <= x < seg.shape[1]:
                    nuc_id = seg[int(y), int(x)]
                    if nuc_id > 0:
                        foci_counts_probs[nuc_id] = foci_counts_probs.get(nuc_id, 0) + 1
                        foci_pixels_probs[nuc_id] = foci_pixels_probs.get(nuc_id, 0) + pi * sigma**2

            else:
                foci_coords_probs = []
                print(f"⚠️ Probabilities file not found for {tile_id}")

    # ---- CSV: nucleus stats ----
    regions = regionprops(seg)
    rows = []
    for r in regions:
        region_id = r.label
        area = r.area
        count_r = foci_counts_rad51.get(region_id, 0)
        count_p = foci_counts_probs.get(region_id, 0)
        pix_r = foci_pixels_rad51.get(region_id, 0)
        pix_p = foci_pixels_probs.get(region_id, 0)

        rows.append({
            'region_id': region_id,
            'image_id': 'A1',
            'tile_id': tile_id,
            'area': area,
            'foci_count_rad51': count_r,
            'foci_count_probs': count_p,
            'foci_fraction_rad51': pix_r / area if area > 0 else 0,
            'foci_fraction_probs': pix_p / area if area > 0 else 0
        })

    df_all.append(pd.DataFrame(rows))

    # ---- Overlays ----
    rad51_vis = cv2.cvtColor(rad51, cv2.COLOR_GRAY2BGR)
    dapi_vis = cv2.cvtColor(dapi, cv2.COLOR_GRAY2BGR)

    for y, x in foci_coords_rad51:
        cv2.circle(rad51_vis, (int(x), int(y)), radius=3, color=(0, 255, 255), thickness=3)
        cv2.circle(dapi_vis, (int(x), int(y)), radius=3, color=(0, 255, 0), thickness=3)

    imsave(f"outputs/annotated_rad51/{tile_id}_rad51_foci.png", rad51_vis)
    imsave(f"outputs/annotated_dapi/{tile_id}_dapi_foci.png", dapi_vis)

    print(f"✅ {tile_id}: {len(blobs_rad51)} foci in RAD51, {len(foci_coords_probs)} in Probabilities")

# ---- Final CSV ----
final_df = pd.concat(df_all, ignore_index=True)
final_df.to_csv("outputs/foci_per_nucleus.csv", index=False)
print("📊 Saved CSV: outputs/foci_per_nucleus.csv")
