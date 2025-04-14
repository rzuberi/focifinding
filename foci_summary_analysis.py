import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns
import os

# Load the CSV
csv_path = "outputs/foci_per_nucleus_multi_threshold.csv"
df = pd.read_csv(csv_path)

# --- Biologically Relevant Overview ---
os.makedirs("outputs/analysis", exist_ok=True)

overview_stats = {
    "Total nuclei analyzed": [len(df)],
    "Mean area (pixels)": [df['area'].mean()],
    "Median area (pixels)": [df['area'].median()],
    "Std area (pixels)": [df['area'].std()],
    "Min area (pixels)": [df['area'].min()],
    "Max area (pixels)": [df['area'].max()],
}

overview_df = pd.DataFrame(overview_stats)
overview_df.to_csv("outputs/analysis/summary_overview.csv", index=False)
print("\n===== General Overview =====")
print(overview_df.to_string(index=False))

# --- Per-method Summary ---
foci_methods = [col for col in df.columns if col.startswith("rad51_count") or col.startswith("prob_count")]
area_methods = [col for col in df.columns if col.startswith("rad51_area") or col.startswith("prob_area")]

summary_data = []
for count_col in foci_methods:
    area_col = count_col.replace("_count_", "_area_")
    values = df[count_col]
    area_vals = df[area_col] if area_col in df.columns else pd.Series([None] * len(df))
    method_label = count_col.replace("_count_", ": ")
    summary_data.append({
        "Method": method_label,
        "Avg Foci/Nucleus": values.mean(),
        "Median Foci/Nucleus": values.median(),
        "Std Foci/Nucleus": values.std(),
        "% Nuclei with ≥1 Foci": (values > 0).mean() * 100,
        "Max Foci Observed": values.max(),
        "Avg Foci Area Fraction": area_vals.mean(),
        "Median Foci Area Fraction": area_vals.median(),
        "Std Foci Area Fraction": area_vals.std()
    })

summary_df = pd.DataFrame(summary_data)
summary_df.to_csv("outputs/analysis/summary_by_method.csv", index=False)
print("\n===== Summary of Foci Detection by Method =====")
print(summary_df.to_string(index=False))

# --- Plot distributions ---
plt.figure(figsize=(12, 6))
for col in foci_methods:
    sns.kdeplot(df[col], label=col.replace("_count_", ": "))
plt.title("Distribution of Foci Counts per Nucleus (Biological Scale)")
plt.xlabel("Number of RAD51 Foci per Nucleus")
plt.ylabel("Density")
plt.legend()
plt.tight_layout()
plt.savefig("outputs/analysis/foci_count_distributions.png")
plt.close()

plt.figure(figsize=(12, 6))
for col in area_methods:
    sns.kdeplot(df[col], label=col.replace("_area_", ": "))
plt.title("Distribution of RAD51+ Area Fraction per Nucleus")
plt.xlabel("RAD51+ Area Fraction")
plt.ylabel("Density")
plt.legend()
plt.tight_layout()
plt.savefig("outputs/analysis/foci_area_distributions.png")
plt.close()

print("\n✅ Full analysis complete. Summaries and plots saved in outputs/analysis/")
