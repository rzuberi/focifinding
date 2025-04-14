import os
import numpy as np
import matplotlib.pyplot as plt
from skimage.io import imread
from skimage.feature import blob_log
from skimage.color import rgba2rgb, rgb2gray

# Paths
base_dir = "images/A1"
rad51_dir = os.path.join(base_dir, "rad51")
seg_dir = os.path.join(base_dir, "dapi")

# Blob detection thresholds to compare
thresholds = [0.2,0.25,0.3,0.35,0.4]
min_sigma = 1
max_sigma = 4

# Output directory
os.makedirs("outputs", exist_ok=True)

# Dictionary to store foci count distributions per threshold
threshold_foci_distributions = {}

for threshold in thresholds:
    all_foci_counts = []

    for fname in sorted(os.listdir(rad51_dir)):
        if not fname.endswith(".png"):
            continue

        tile_id = fname.replace(".png", "")
        rad51_path = os.path.join(rad51_dir, fname)
        seg_path = os.path.join(seg_dir, tile_id + "_seg.npy")

        if not os.path.exists(seg_path):
            print(f"Segmentation not found for {tile_id}")
            continue

        # Load and convert RAD51 image
        rad51_raw = imread(rad51_path)
        if rad51_raw.ndim == 3:
            if rad51_raw.shape[2] == 4:
                rad51_rgb = rgba2rgb(rad51_raw)
            else:
                rad51_rgb = rad51_raw
            rad51 = (rgb2gray(rad51_rgb) * 255).astype(np.uint8)
        else:
            rad51 = rad51_raw

        # Load segmentation mask
        loaded = np.load(seg_path, allow_pickle=True).item()
        seg = loaded['masks']

        # Detect foci using current threshold
        rad51_norm = (rad51 - rad51.min()) / (rad51.max() - rad51.min())
        blobs = blob_log(rad51_norm, min_sigma=min_sigma, max_sigma=max_sigma, threshold=threshold)
        foci_coords = blobs[:, :2].astype(int)

        # Count foci per nucleus
        foci_counts = {}
        for y, x in foci_coords:
            if 0 <= y < seg.shape[0] and 0 <= x < seg.shape[1]:
                nuc_id = seg[y, x]
                if nuc_id > 0:
                    foci_counts[nuc_id] = foci_counts.get(nuc_id, 0) + 1

        for label in np.unique(seg):
            if label == 0:
                continue
            all_foci_counts.append(foci_counts.get(label, 0))

    threshold_foci_distributions[threshold] = all_foci_counts
    print(f"Threshold {threshold:.3f}: {len(all_foci_counts)} nuclei processed")

# ---- Plotting ----

# Determine shared axis limits
all_counts = [count for counts in threshold_foci_distributions.values() for count in counts]
max_foci = max(max(all_counts), 10)
bins = range(0, max_foci + 2)

fig, axs = plt.subplots(len(thresholds), 1, figsize=(8, 3 * len(thresholds)), sharex=True, sharey=True)

for ax, threshold in zip(axs, thresholds):
    counts = threshold_foci_distributions[threshold]
    ax.hist(
        counts,
        bins=bins,
        edgecolor="black",
        alpha=0.7,
        color="steelblue"
    )
    ax.set_title(f"Threshold = {threshold:.3f}")
    ax.set_ylabel("Nuclei")

axs[-1].set_xlabel("Number of Foci per Nucleus")
fig.suptitle("Foci per Nucleus Distribution Across Thresholds", fontsize=14, y=1.01)
fig.tight_layout()

# Save the figure
plt.savefig("outputs/foci_distribution_panels.png", dpi=300, bbox_inches='tight')
plt.close()

print("📊 Saved multi-panel histogram: outputs/foci_distribution_panels.png")
