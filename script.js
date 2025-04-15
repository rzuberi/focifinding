// script.js

document.addEventListener("DOMContentLoaded", () => {
  // Settings and state variables
  let selectedMethod = "rad51";
  let selectedThreshold = "0.2";
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
  // (Channel selector buttons can be enhanced later)
  const zoomRad51Btn = document.getElementById("zoomRad51");
  const zoomDapiBtn = document.getElementById("zoomDapi");

  // Application state
  let dataset = "A1";
  let canvasScale = 0.4;
  let currentTileList = [];
  const tileCache = new Map();
  let lockedNucleus = null;       // Lock for dashboard updates via click
  let nucleiRegions = [];         // Array to record drawn nucleus info

  // Fetch tile index and preload tile JSONs
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

  // Helper: Compute edge pixels for a set of coordinates.
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

  // Preload JSON data for each tile
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

  // Merge tile images onto a single canvas, draw overlays, and record each nucleus region.
  function renderMergedCanvas(tileList) {
    tileGrid.innerHTML = "";
    const mergedCanvas = document.createElement("canvas");
    const mergedCtx = mergedCanvas.getContext("2d");
    const cols = 5;
    const rows = Math.ceil(tileList.length / cols);

    // Get image data for each tile based on the display mode.
    const promises = tileList.map(tileId => {
      const data = tileCache.get(tileId);
      const imgPath = (displayMode === "rad51") ? data.rad51_image : data.dapi_image;
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
      nucleiRegions = [];  // Reset the regions array

      validResults.forEach(({ tileId, data, img }, idx) => {
        const col = idx % cols;
        const row = Math.floor(idx / cols);
        const offsetX = col * tileWidth * canvasScale;
        const offsetY = row * tileHeight * canvasScale;

        // Scale the tile image.
        const scaledImgCanvas = document.createElement("canvas");
        scaledImgCanvas.width = tileWidth * canvasScale;
        scaledImgCanvas.height = tileHeight * canvasScale;
        const scaledCtx = scaledImgCanvas.getContext("2d");
        scaledCtx.drawImage(img, 0, 0, scaledImgCanvas.width, scaledImgCanvas.height);

        // Draw the scaled image onto the merged canvas.
        mergedCtx.drawImage(scaledImgCanvas, offsetX, offsetY);

        // Draw overlays on this tile and record each nucleus region.
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
          // Draw foci.
          const fociKey = `${selectedMethod}_coords_th${selectedThreshold}`;
          if (showFoci && Array.isArray(nuc[fociKey])) {
            mergedCtx.fillStyle = (selectedMethod === "rad51") ? "cyan" : "magenta";
            nuc[fociKey].forEach(([y, x]) => {
              mergedCtx.beginPath();
              mergedCtx.arc(offsetX + x * canvasScale, offsetY + y * canvasScale, 2, 0, 2 * Math.PI);
              mergedCtx.fill();
            });
          }
          // Compute the bounding box for this nucleus.
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          coords.forEach(coord => {
            const [y, x] = coord;
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
          // Save this nucleus for later dashboard updates.
          nucleiRegions.push({ tileId, nuc, box, offsetX, offsetY, tileWidth, tileHeight, data });
        });
      });

      // Magnifier: show zoomed area around mouse position.
      mergedCanvas.addEventListener("mousemove", e => {
        const rect = mergedCanvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        const magnifierSize = 70;
        magnifierCanvas.width = magnifierSize;
        magnifierCanvas.height = magnifierSize;
        const ctx = magnifierCanvas.getContext("2d");
        ctx.imageSmoothingEnabled = false;
        ctx.clearRect(0, 0, magnifierCanvas.width, magnifierCanvas.height);
        ctx.drawImage(
          mergedCanvas,
          mouseX - magnifierSize / 2,
          mouseY - magnifierSize / 2,
          magnifierSize,
          magnifierSize,
          0,
          0,
          magnifierSize,
          magnifierSize
        );
      });

      // Helper: return the nucleus region at the given mouse coordinates.
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

      // On mousemove, if no nucleus is locked, update the dashboard.
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

      // On click, lock the dashboard to that nucleus.
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

  // Update dashboard: update info table and render zoom views.
  function updateDashboard(region) {
    // Update info table.
    infoPanel.innerHTML = `<table border="1" style="width:100%;color:white;">
      <tr><th>Region ID</th><td>${region.nuc.region_id}</td></tr>
      <tr><th>Area</th><td>${region.nuc.area}</td></tr>
      <tr><th>Foci Count</th><td>${region.nuc[`${selectedMethod}_count_th${selectedThreshold}`]}</td></tr>
    </table>`;

    const zoomFactor = 4;
    // Render raw views (without overlays):
    renderZoomView(region, zoomFactor, "rad51", document.getElementById("rad51Raw"), false);
    renderZoomView(region, zoomFactor, "dapi", document.getElementById("dapiRaw"), false);
    // Render annotated views (with overlays):
    renderZoomView(region, zoomFactor, "rad51", document.getElementById("rad51Annotated"), true);
    renderZoomView(region, zoomFactor, "dapi", document.getElementById("dapiAnnotated"), true);
  }

  // Clear dashboard contents.
  function clearDashboard() {
    infoPanel.innerHTML = "";
    ["rad51Raw", "rad51Annotated", "dapiRaw", "dapiAnnotated"].forEach(id => {
      const cnv = document.getElementById(id);
      const ctx = cnv.getContext("2d");
      ctx.clearRect(0, 0, cnv.width, cnv.height);
    });
  }

  // Helper: Render a zoomed view of the nucleus from the given channel.
  // If withOverlays is true, draw outlines, labels, and foci.
  function renderZoomView(region, zoomFactor, channel, canvas, withOverlays) {
    const tileData = tileCache.get(region.tileId);
    if (!tileData) return;
    const imgPath = (channel === "rad51") ? tileData.rad51_image : tileData.dapi_image;
    const img = new Image();
    img.onload = () => {
      // Convert region.box (merged canvas coordinates) to tile (original) coordinates.
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
      // Draw the raw portion
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
      if (withOverlays) {
        // Draw outlines:
        if (showOutlines) {
          const edges = getEdgePixels(region.nuc.pixel_coords, region.tileWidth, region.tileHeight);
          ctx.fillStyle = "lime";
          edges.forEach(([y, x]) => {
            if (
              x >= tileBox.x &&
              x < tileBox.x + tileBox.width &&
              y >= tileBox.y &&
              y < tileBox.y + tileBox.height
            ) {
              ctx.fillRect((x - tileBox.x) * zoomFactor, (y - tileBox.y) * zoomFactor, zoomFactor, zoomFactor);
            }
          });
        }
        // Draw labels:
        if (showLabels && region.nuc.centroid) {
          ctx.fillStyle = "yellow";
          ctx.font = "10px Arial";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(
            region.nuc.region_id,
            (region.nuc.centroid[1] - tileBox.x) * zoomFactor,
            (region.nuc.centroid[0] - tileBox.y) * zoomFactor
          );
        }
        // Draw foci:
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

  // UI event listeners for controls
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

  // Redraw tiles when controls change.
  function redrawTiles() {
    if (!currentTileList.length) return;
    renderMergedCanvas(currentTileList);
  }
});
