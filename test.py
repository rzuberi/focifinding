import numpy as np

seg = np.load("/home/zuberi01/Documents/Development/phd/focifinding/images/A1/dapi/tile_01_seg.npy", allow_pickle=True)
print(type(seg))
print(seg.shape)
print(seg)
