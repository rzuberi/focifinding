// script.js

document.addEventListener("DOMContentLoaded", () => {
  // Settings and state variables
  let selectedMethod = "rad51";
  let selectedThreshold = "0.2";
  // displayMode now supports "rad51", "dapi", and "h2ax"
  let displayMode = "rad51";
  let showFoci = true;
  let showLabels = true;
  let showOutlines = true;
  let infoInPanel = true;

  // DOM Elements
  const methodSelect = document.getElementById("methodSelect");
  const thresholdSelect = document.getElementById("thresholdSelect");
  const toggleFoci = document.getElementById("toggleFoci");
  const toggleLabels = document.getElementById("toggleLabels");
  const toggleOutlines = document.getElementById("toggleOutlines");
  const displayImageMode = document.getElementById("displayMode");
  const toggleInfo = document.getElementById("toggleInfo");
  const infoPanel = document.getElementById("infoPanel");
  const datasetSelect = document.getElementById("datasetSelect");
  const tileGrid = document.getElementById("tileGrid");
  const magnifierCanvas = document.getElementById("magnifierCanvas");
  // Channel selector buttons (if needed, for now they’re not active)
  const zoomRad51Btn = document.getElementById("zoomRad51");
  const zoomDapiBtn = document.getElementById("zoomDapi");

  // Application state variables
  let dataset = "A1";
  let canvasScale = 0.4; // This scale is used for merging tiles into the overview.
  let currentTileList = [];
  const tileCache = new Map();
  let lockedNucleus = null; // stores the nucleus when a user clicks on it (to lock dashboard view)
  let nucleiRegions = [];   // stores each nucleus's bounding box and data for hover/click detection

  // Fetch the tile index and preload JSON data for each tile.
  fetch("data/index.json")
    .then(res => res.json())
    .then(index => {
      currentTileList = index[dataset] || [];
      if (currentTileList.length > 0) preloadAndRender(currentTileList);
    });

  datasetSelect.addEventListener("change", e => {
    dataset = e.target.value;
    fetch("data/index.json")
      .then(res => res.json())
      .then(index => {
        currentTileList = index[dataset] || [];
        if (currentTileList.length > 0) preloadAndRender(currentTileList);
      });
  });

  // Helper function: Compute the outline edge pixels from pixel coordinates.
  function getEdgePixels(coords, width, height) {
    const mask = new Array(height).fill(0).map(() => new Array(width).fill(false));
    coords.forEach(([y, x]) => {
      if (x >= 0 && x < width && y >= 0 && y < height) mask[y][x] = true;
    });
    const edge = [];
    coords.forEach(([y, x]) => {
      const neighbors = [[0, 1], [1, 0], [0, -1], [-1, 0]];
      for (const [dy, dx] of neighbors) {
        const ny = y + dy;
        const nx = x + dx;
        if (ny < 0 || ny >= height || nx < 0 || nx >= width || !mask[ny][nx]) {
          edge.push([y, x]);
          break;
        }
      }
    });
    return edge;
  }

  // Preload JSON for each tile.
  function preloadAndRender(tileList) {
    const promises = tileList.map(tileId => {
      return fetch(`data/${tileId}.json`)
        .then(res => res.json())
        .then(data => { tileCache.set(tileId, data); });
    });
    Promise.all(promises).then(() => {
      renderMergedCanvas(tileList);
    });
  }

  // Render the merged overview canvas (with downscaled tiles and overlays),
  // and record each nucleus's bounding box.
  function renderMergedCanvas(tileList) {
    tileGrid.innerHTML = "";
    const mergedCanvas = document.createElement("canvas");
    const mergedCtx = mergedCanvas.getContext("2d");
    const cols = 5;
    const rows = Math.ceil(tileList.length / cols);

    // Get tile images for the overview based on the displayMode.
    // Add support for h2ax here.
    const promises = tileList.map(tileId => {
      const data = tileCache.get(tileId);
      let imgPath;
      if (displayMode === "rad51") {
        imgPath = data.rad51_image;
      } else if (displayMode === "dapi") {
        imgPath = data.dapi_image;
      } else if (displayMode === "h2ax") {
        imgPath = data.h2ax_image;
      }
      return new Promise(resolve => {
        const img = new Image();
        img.onload = () => resolve({ tileId, data, img });
        img.onerror = () => resolve({ tileId, data, img: null });
        img.src = imgPath;
      });
    });

    Promise.all(promises).then(results => {
      const validResults = results.filter(r => r.img);
      if (validResults.length === 0) return;
      const tileWidth = validResults[0].img.width;
      const tileHeight = validResults[0].img.height;
      mergedCanvas.width = cols * tileWidth * canvasScale;
      mergedCanvas.height = rows * tileHeight * canvasScale;
      nucleiRegions = []; // Clear any prior region data

      // For each valid tile, draw it scaled into mergedCanvas and then add overlays.
      validResults.forEach(({ tileId, data, img }, idx) => {
        const col = idx % cols;
        const row = Math.floor(idx / cols);
        const offsetX = col * tileWidth * canvasScale;
        const offsetY = row * tileHeight * canvasScale;

        // Create a temporary canvas to draw a scaled version of the tile.
        const scaledImgCanvas = document.createElement("canvas");
        scaledImgCanvas.width = tileWidth * canvasScale;
        scaledImgCanvas.height = tileHeight * canvasScale;
        const scaledCtx = scaledImgCanvas.getContext("2d");
        scaledCtx.drawImage(img, 0, 0, scaledImgCanvas.width, scaledImgCanvas.height);
        mergedCtx.drawImage(scaledImgCanvas, offsetX, offsetY);

        // Process each nucleus in the tile.
        data.nuclei.forEach(nuc => {
          const coords = nuc.pixel_coords;
          if (!Array.isArray(coords)) return;
          // Draw outlines.
          if (showOutlines) {
            const edges = getEdgePixels(coords, tileWidth, tileHeight);
            edges.forEach(([y, x]) => {
              mergedCtx.fillStyle = "lime";
              mergedCtx.fillRect(offsetX + x * canvasScale, offsetY + y * canvasScale, 1, 1);
            });
          }
          // Draw labels.
          if (showLabels && nuc.centroid) {
            mergedCtx.fillStyle = "yellow";
            mergedCtx.font = "10px Arial";
            mergedCtx.textAlign = "center";
            mergedCtx.textBaseline = "middle";
            mergedCtx.fillText(nuc.region_id, offsetX + nuc.centroid[1] * canvasScale, offsetY + nuc.centroid[0] * canvasScale);
          }
          // Draw foci markers.
          const fociKey = `${selectedMethod}_coords_th${selectedThreshold}`;
          if (showFoci && Array.isArray(nuc[fociKey])) {
            mergedCtx.fillStyle = (selectedMethod === "rad51") ? "cyan" : "magenta";
            nuc[fociKey].forEach(([y, x]) => {
              mergedCtx.beginPath();
              mergedCtx.arc(offsetX + x * canvasScale, offsetY + y * canvasScale, 2, 0, 2 * Math.PI);
              mergedCtx.fill();
            });
          }
          // Compute the bounding box for the nucleus.
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          coords.forEach(([y, x]) => {
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
          });
          const box = {
            x: offsetX + minX * canvasScale,
            y: offsetY + minY * canvasScale,
            width: (maxX - minX + 1) * canvasScale,
            height: (maxY - minY + 1) * canvasScale
          };
          nucleiRegions.push({ tileId, nuc, box, offsetX, offsetY, tileWidth, tileHeight, data });
        });
      });

      // ----- High-Resolution Magnifier Code -----
      // Instead of sampling from the merged (downscaled) view, use the full-res tile.
      mergedCanvas.addEventListener("mousemove", e => {
        const rect = mergedCanvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        const magnifierSize = 70; // Output size in pixels
        const zoomFactor = 2;     // Magnification factor for the magnifier

        // Determine the scaled dimensions of each tile.
        const scaledTileWidth = tileWidth * canvasScale;
        const scaledTileHeight = tileHeight * canvasScale;
        // Find the tile over which the mouse hovers.
        const col = Math.floor(mouseX / scaledTileWidth);
        const row = Math.floor(mouseY / scaledTileHeight);
        const index = row * cols + col;
        if (index < validResults.length) {
          const tileInfo = validResults[index];
          const tileOffsetX = col * scaledTileWidth;
          const tileOffsetY = row * scaledTileHeight;
          // Convert to raw tile coordinates.
          const localX = (mouseX - tileOffsetX) / canvasScale;
          const localY = (mouseY - tileOffsetY) / canvasScale;
          const regionSize = magnifierSize / zoomFactor;
          magnifierCanvas.width = magnifierSize;
          magnifierCanvas.height = magnifierSize;
          const ctx = magnifierCanvas.getContext("2d");
          ctx.imageSmoothingEnabled = true;
          ctx.clearRect(0, 0, magnifierCanvas.width, magnifierCanvas.height);
          ctx.drawImage(
            tileInfo.img,
            localX - regionSize / 2, localY - regionSize / 2, regionSize, regionSize,
            0, 0, magnifierSize, magnifierSize
          );
        }
      });
      // -------------------------------------------------

      // Helper: Determine which nucleus region (if any) is at mouse coordinates.
      function getNucleusAtPosition(mouseX, mouseY) {
        for (const region of nucleiRegions) {
          const { box } = region;
          if (
            mouseX >= box.x &&
            mouseX <= box.x + box.width &&
            mouseY >= box.y &&
            mouseY <= box.y + box.height
          ) {
            return region;
          }
        }
        return null;
      }

      // On mousemove over the merged canvas, update the dashboard (if not locked).
      mergedCanvas.addEventListener("mousemove", e => {
        if (lockedNucleus) return;
        const rect = mergedCanvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        const hoveredRegion = getNucleusAtPosition(mouseX, mouseY);
        if (hoveredRegion) {
          updateDashboard(hoveredRegion);
        } else {
          clearDashboard();
        }
      });

      // On click over the merged canvas, lock the dashboard.
      mergedCanvas.addEventListener("click", e => {
        const rect = mergedCanvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        const clickedRegion = getNucleusAtPosition(mouseX, mouseY);
        if (clickedRegion) {
          lockedNucleus = clickedRegion;
          updateDashboard(clickedRegion);
        }
      });

      // Clear the lock when the "Clear Info Lock" button is clicked.
      document.getElementById("clearSelection").addEventListener("click", () => {
        lockedNucleus = null;
        clearDashboard();
      });

      tileGrid.appendChild(mergedCanvas);
    });
  }

  // Update the dashboard: update the info panel and render zoomed views.
  function updateDashboard(region) {
    infoPanel.innerHTML = `<table border="1" style="width:100%;color:white;">
      <tr><th>Region ID</th><td>${region.nuc.region_id}</td></tr>
      <tr><th>Area</th><td>${region.nuc.area}</td></tr>
      <tr><th>Foci Count</th><td>${region.nuc[`${selectedMethod}_count_th${selectedThreshold}`]}</td></tr>
    </table>`;
    const zoomFactor = 4;
    // Render raw views (first row; without any overlays)
    renderZoomView(region, zoomFactor, "rad51", document.getElementById("rad51Raw"), false);
    renderZoomView(region, zoomFactor, "dapi", document.getElementById("dapiRaw"), false);
    renderZoomView(region, zoomFactor, "h2ax", document.getElementById("h2axRaw"), false);
    // Render annotated views (second row; draw only foci markers—not outlines or labels)
    renderZoomView(region, zoomFactor, "rad51", document.getElementById("rad51Annotated"), true);
    renderZoomView(region, zoomFactor, "dapi", document.getElementById("dapiAnnotated"), true);
    renderZoomView(region, zoomFactor, "h2ax", document.getElementById("h2axAnnotated"), true);
  }

  // Clear the dashboard: clear the info panel and all zoom canvases.
  function clearDashboard() {
    infoPanel.innerHTML = "";
    ["rad51Raw", "rad51Annotated", "dapiRaw", "dapiAnnotated", "h2axRaw", "h2axAnnotated"].forEach(id => {
      const cnv = document.getElementById(id);
      const ctx = cnv.getContext("2d");
      ctx.clearRect(0, 0, cnv.width, cnv.height);
    });
  }

  // Helper function: render a zoomed view using the original tile image.
  // The parameter "withOverlays" now, when true, draws only the foci markers
  // (no outlines or labels) for the annotated view.
  function renderZoomView(region, zoomFactor, channel, canvas, withOverlays) {
    const tileData = tileCache.get(region.tileId);
    if (!tileData) return;
    let imgPath;
    if (channel === "rad51") {
      imgPath = tileData.rad51_image;
    } else if (channel === "dapi") {
      imgPath = tileData.dapi_image;
    } else if (channel === "h2ax") {
      imgPath = tileData.h2ax_image;
    }
    const img = new Image();
    img.onload = () => {
      // Convert region.box from merged-canvas coordinates to tile (raw) coordinates.
      const tileBox = {
        x: (region.box.x - region.offsetX) / canvasScale,
        y: (region.box.y - region.offsetY) / canvasScale,
        width: region.box.width / canvasScale,
        height: region.box.height / canvasScale
      };
      canvas.width = tileBox.width * zoomFactor;
      canvas.height = tileBox.height * zoomFactor;
      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(
        img,
        tileBox.x,
        tileBox.y,
        tileBox.width,
        tileBox.height,
        0,
        0,
        canvas.width,
        canvas.height
      );
      // If overlays should be added (for annotated views), draw ONLY the foci markers.
      if (withOverlays) {
        if (showFoci) {
          const fociKey = `${selectedMethod}_coords_th${selectedThreshold}`;
          if (Array.isArray(region.nuc[fociKey])) {
            ctx.fillStyle = (selectedMethod === "rad51") ? "cyan" : "magenta";
            region.nuc[fociKey].forEach(([y, x]) => {
              if (
                x >= tileBox.x &&
                x < tileBox.x + tileBox.width &&
                y >= tileBox.y &&
                y < tileBox.y + tileBox.height
              ) {
                ctx.beginPath();
                ctx.arc((x - tileBox.x) * zoomFactor, (y - tileBox.y) * zoomFactor, 2 * zoomFactor, 0, 2 * Math.PI);
                ctx.fill();
              }
            });
          }
        }
      }
    };
    img.src = imgPath;
  }

  // UI event listeners for controls:
  methodSelect.addEventListener("change", e => {
    selectedMethod = e.target.value;
    redrawTiles();
  });

  thresholdSelect.addEventListener("change", e => {
    selectedThreshold = e.target.value;
    redrawTiles();
  });

  displayImageMode.addEventListener("change", e => {
    displayMode = e.target.value;
    redrawTiles();
  });

  toggleFoci.addEventListener("click", () => {
    showFoci = !showFoci;
    toggleFoci.classList.toggle("active", showFoci);
    redrawTiles();
  });

  toggleLabels.addEventListener("click", () => {
    showLabels = !showLabels;
    toggleLabels.classList.toggle("active", showLabels);
    redrawTiles();
  });

  toggleOutlines.addEventListener("click", () => {
    showOutlines = !showOutlines;
    toggleOutlines.classList.toggle("active", showOutlines);
    redrawTiles();
  });

  toggleInfo.addEventListener("click", () => {
    infoInPanel = !infoInPanel;
    toggleInfo.classList.toggle("active", infoInPanel);
  });

  function redrawTiles() {
    if (!currentTileList.length) return;
    renderMergedCanvas(currentTileList);
  }
});
