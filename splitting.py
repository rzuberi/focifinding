from skimage import io
import os

# Load the composite image
img = io.imread('/home/zuberi01/Downloads/Rad51_A1.png')  # or .png, .jpg, etc.

# Define grid dimensions
rows, cols = 3, 5
tile_h = img.shape[0] // rows
tile_w = img.shape[1] // cols

# Output folder
output_dir = 'split_tiles'
os.makedirs(output_dir, exist_ok=True)

# Split and save
for i in range(rows):
    for j in range(cols):
        tile = img[i*tile_h:(i+1)*tile_h, j*tile_w:(j+1)*tile_w]
        idx = i * cols + j
        io.imsave(os.path.join(output_dir, f'tile_{idx+1:02d}.png'), tile)
