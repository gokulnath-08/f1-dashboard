
>     <script>
          function switchTab(tabId, btnElement) {
              document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
              document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
              document.getElementById(tabId).classList.add('active');
              btnElement.classList.add('active');
              if (tabId === 'tab-radar') setTimeout(() => {
                  resizeThreeJS();
                  updateMapOverlays();
              }, 10);
          }
  
          const mapContainer = document.getElementById('track-map-container');
          const mapWrapper = mapContainer.closest('.map-wrapper');
          const mapLabelLayer = document.getElementById('map-label-layer');
          const mapZoomIn = document.getElementById('map-zoom-in');
          const mapZoomOut = document.getElementById('map-zoom-out');
          const scene = new THREE.Scene();
          let aspect = mapContainer.clientWidth / mapContainer.clientHeight || 1;
          let trackViewSize = 1200;
          let trackBaseViewSize = 1200;
          let trackZoom = 1;
          const trackViewCenter = new THREE.Vector3(0, 0, 0);
          const camera = new THREE.OrthographicCamera(-trackViewSize * aspect, trackViewSize * aspect, trackViewSize, 
-trackViewSize, 1, 2000);
          camera.position.set(0, 500, 0);
          camera.lookAt(0, 0, 0);
  
          const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
          renderer.setSize(mapContainer.clientWidth || 400, mapContainer.clientHeight || 400);
          mapContainer.appendChild(renderer.domElement);
  
          const gridHelper = new THREE.GridHelper(20000, 400, 0x0e0e18, 0x0e0e18);
          scene.add(gridHelper);
  
          const trackMaterial = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 });
          const trackGeometry = new THREE.BufferGeometry();
          const trackLine = new THREE.Line(trackGeometry, trackMaterial);
          trackLine.renderOrder = 0;
          trackLine.frustumCulled = false;
          scene.add(trackLine);
  
          const gGraph = document.getElementById('g-graph');
          const gGraphCtx = gGraph.getContext('2d');
          const gHistory = [];
          let maxGSeen = 0;
          let lastValidG = 0;
          let lastSpeedMs = null;
          let lastGSampleTime = 0;
          let lastCurrentMsForG = -1;
          const MAX_REASONABLE_DRIVER_G = 60;
          const MAX_REASONABLE_SENSOR_G = 8;
          const G_ACCELERATION = 9.80665;
  
          const carMeshes = [];
          const carScreenData = [];
          let latestMapData = null;
          let selectedCarIndex = null;
          const raycaster = new THREE.Raycaster();
          const pointer = new THREE.Vector2();
          const mapPointers = new Map();
          let isMapPanning = false;
          let lastPanPoint = null;
          let lastPinchDistance = 0;
          let suppressNextMapClick = false;
          const carGeometry = new THREE.CircleGeometry(16, 32);
          for (let i = 0; i < 24; i++) {
              const mat = new THREE.MeshBasicMaterial({ color: 0xFFFFFF });
              const mesh = new THREE.Mesh(carGeometry, mat);
              mesh.rotation.x = -Math.PI / 2;
              mesh.visible = false;
              mesh.userData.carIndex = i;
              scene.add(mesh);
              carMeshes.push(mesh);
          }
  
          function createSectorLine(color) {
              const geometry = new THREE.PlaneGeometry(250, 6);
              const material = new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.8, blending: 
THREE.AdditiveBlending });
              const mesh = new THREE.Mesh(geometry, material);
              mesh.rotation.order = 'YXZ';
              mesh.rotation.x = -Math.PI / 2;
              mesh.visible = false;
              mesh.renderOrder = -1;
              scene.add(mesh);
              return mesh;
          }
  
          const startLineMesh = createSectorLine(0xffd700); // Yellow
          const sector1LineMesh = createSectorLine(0xff00ff); // Purple
          const sector2LineMesh = createSectorLine(0x00ffff); // Cyan
          const customSectorMeshes = [];
  
          window.lastTrackPointsLength = 0;
          window.lastTrackPointsLengthCustom = 0;
          function animate() {
              requestAnimationFrame(animate);
              renderer.render(scene, camera);
              updateMapOverlays();
          }
          animate();
  
          function updateTrackCameraBounds() {
              const width = mapContainer.clientWidth || 400;
              const height = mapContainer.clientHeight || 400;
              aspect = width / height;
              trackViewSize = trackBaseViewSize / trackZoom;
              camera.left = -trackViewSize * aspect;
              camera.right = trackViewSize * aspect;
              camera.top = trackViewSize;
              camera.bottom = -trackViewSize;
              camera.position.set(trackViewCenter.x, 500, trackViewCenter.z);
              camera.lookAt(trackViewCenter.x, 0, trackViewCenter.z);
              camera.updateProjectionMatrix();
          }
  
          function resizeThreeJS() {
              if (mapContainer.clientWidth === 0) return;
              const width = mapContainer.clientWidth;
              const height = mapContainer.clientHeight;
              renderer.setSize(width, height);
              updateTrackCameraBounds();
          }
          window.addEventListener('resize', () => {
              resizeThreeJS();
              drawGGraph();
          });
  
          function setMapZoom(nextZoom) {
              trackZoom = Math.max(0.65, Math.min(5, nextZoom));
              updateTrackCameraBounds();
              updateMapOverlays();
          }
  
          function panTrackMap(deltaX, deltaY) {
              const height = mapContainer.clientHeight || 1;
              const worldPerPixel = (trackViewSize * 2) / height;
              trackViewCenter.x -= deltaX * worldPerPixel;
              trackViewCenter.z -= deltaY * worldPerPixel;
              updateTrackCameraBounds();
              updateMapOverlays();
          }
  
          function getPointerDistance(points) {
              const dx = points[0].clientX - points[1].clientX;
              const dy = points[0].clientY - points[1].clientY;
              return Math.hypot(dx, dy);
          }
  
          function getPointerMidpoint(points) {
              return {
                  x: (points[0].clientX + points[1].clientX) / 2,
                  y: (points[0].clientY + points[1].clientY) / 2
              };
          }
  
          mapZoomIn.addEventListener('click', event => {
              event.stopPropagation();
              setMapZoom(trackZoom * 1.2);
          });
          mapZoomOut.addEventListener('click', event => {
              event.stopPropagation();
              setMapZoom(trackZoom / 1.2);
          });
          mapWrapper.addEventListener('wheel', event => {
              event.preventDefault();
              setMapZoom(trackZoom * (event.deltaY < 0 ? 1.12 : 1 / 1.12));
          }, { passive: false });
  
          mapWrapper.addEventListener('pointerdown', event => {
              if (!event.target.closest('#track-map-container, #map-label-layer')) return;
              event.currentTarget.setPointerCapture(event.pointerId);
              mapPointers.set(event.pointerId, event);
              suppressNextMapClick = false;
  
              const points = Array.from(mapPointers.values());
              if (points.length === 1) {
                  isMapPanning = true;
                  lastPanPoint = { x: event.clientX, y: event.clientY };
              } else if (points.length === 2) {
                  isMapPanning = false;
                  lastPinchDistance = getPointerDistance(points);
                  lastPanPoint = getPointerMidpoint(points);
              }
          });
  
          mapWrapper.addEventListener('pointermove', event => {
              if (!mapPointers.has(event.pointerId)) return;
              event.preventDefault();
              mapPointers.set(event.pointerId, event);
              const points = Array.from(mapPointers.values());
  
              if (points.length === 1 && isMapPanning && lastPanPoint) {
                  const point = points[0];
                  const deltaX = point.clientX - lastPanPoint.x;
                  const deltaY = point.clientY - lastPanPoint.y;
                  if (Math.abs(deltaX) + Math.abs(deltaY) > 2) suppressNextMapClick = true;
                  panTrackMap(deltaX, deltaY);
                  lastPanPoint = { x: point.clientX, y: point.clientY };
              } else if (points.length === 2) {
                  const distance = getPointerDistance(points);
                  const midpoint = getPointerMidpoint(points);
                  if (lastPinchDistance > 0) {
                      setMapZoom(trackZoom * (distance / lastPinchDistance));
                      suppressNextMapClick = true;
                  }
                  if (lastPanPoint) panTrackMap(midpoint.x - lastPanPoint.x, midpoint.y - lastPanPoint.y);
                  lastPinchDistance = distance;
                  lastPanPoint = midpoint;
              }
          }, { passive: false });
  
          function endMapPointer(event) {
              mapPointers.delete(event.pointerId);
              const points = Array.from(mapPointers.values());
              if (points.length === 1) {
                  isMapPanning = true;
                  lastPanPoint = { x: points[0].clientX, y: points[0].clientY };
                  lastPinchDistance = 0;
              } else {
                  isMapPanning = false;
                  lastPanPoint = null;
                  lastPinchDistance = 0;
              }
          }
  
          mapWrapper.addEventListener('pointerup', endMapPointer);
          mapWrapper.addEventListener('pointercancel', endMapPointer);
  
          mapWrapper.addEventListener('click', event => {
              if (suppressNextMapClick) {
                  suppressNextMapClick = false;
                  return;
              }
              const rect = renderer.domElement.getBoundingClientRect();
              pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
              pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
              raycaster.setFromCamera(pointer, camera);
              const hits = raycaster.intersectObjects(carMeshes.filter(mesh => mesh.visible), false);
              selectedCarIndex = hits.length > 0 ? hits[0].object.userData.carIndex : null;
              updateMapOverlays();
          });
  
          function calculatePitStrategy(data) {
              const maxWear = Math.max(data.car.wear.fl, data.car.wear.fr, data.car.wear.rl, data.car.wear.rr);
              const weather = data.session.weather;
              const currentCompound = data.car.compound.toUpperCase();
              const lapsRemaining = data.session.lapsLeft || (data.session.lapsTotal - data.lap.lapNum);
              const pitStatus = data.lap.pitStatus;
  
              if (pitStatus === "PITTING" || pitStatus === "IN PIT LANE") return { text: "IN PITS", color: "#000", 
bgColor: "var(--fia-yellow)", border: "none" };
              const isRaining = weather === "Light Rain" || weather === "Heavy Rain" || weather === "Storm";
              const onDryTyres = !currentCompound.includes("INTER") && !currentCompound.includes("WET");
  
              if (isRaining && onDryTyres) return { text: "BOX FOR WETS", color: "#FFF", bgColor: "var(--f1-red)", 
border: "none" };
              if (!isRaining && (currentCompound.includes("INTER") || currentCompound.includes("WET"))) return { text: 
"BOX FOR SLICKS", color: "#FFF", bgColor: "var(--f1-red)", border: "none" };
              if (maxWear > 70) return { text: "PUNCTURE RISK: BOX", color: "#FFF", bgColor: "var(--f1-red)", border: 
"none" };
              else if (maxWear > 55) return { text: "PIT WINDOW OPEN", color: "#000", bgColor: "var(--fia-yellow)", 
border: "none" };
              else if (maxWear > 45) return { text: "PREPARE TO BOX", color: "var(--fia-yellow)", bgColor: 
"var(--f1-dark)", border: "1px solid var(--fia-yellow)" };
              if (lapsRemaining <= 2 && maxWear < 70 && lapsRemaining > 0) return { text: "PUSH TO END", color: 
"#000", bgColor: "var(--fia-purple)", border: "none" };
              return { text: "STAY OUT", color: "var(--fia-green)", bgColor: "var(--f1-dark)", border: "1px solid 
var(--fia-green)" };
          }
  
          let ws;
  
          function getWebSocketUrls() {
              const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
              const urls = [`${protocol}//${window.location.host}`];
              const nodeUrl = `${protocol}//${window.location.hostname}:3000`;
              const legacyUrl = `${protocol}//${window.location.hostname}:8085`;
              if (!urls.includes(nodeUrl)) urls.push(nodeUrl);
              if (!urls.includes(legacyUrl)) urls.push(legacyUrl);
              return urls;
          }
  
          let currentCustomSectors = ['', ''];
  
          function promptAddSector() {
              document.getElementById('sec1-input').value = currentCustomSectors[0];
              document.getElementById('sec2-input').value = Number(currentCustomSectors[1]) - 
Number(currentCustomSectors[0]);
              document.getElementById('sector-modal').style.display = 'flex';
          }
  
          function submitSectors() {
              const s1 = document.getElementById('sec1-input').value.trim();
              const s2 = document.getElementById('sec2-input').value.trim();
              
              currentCustomSectors = [s1, s2];
  
              if (ws && ws.readyState === WebSocket.OPEN) {
                  ws.send(JSON.stringify({ action: 'resetSectors' }));
                  
                  const ms1 = parseInt(s1, 10);
                  const ms2 = parseInt(s2, 10);
                  
                  if (ms1 > 0) ws.send(JSON.stringify({ action: 'addSector', timeMs: ms1 }));
                  if (ms2 > 0) ws.send(JSON.stringify({ action: 'addSector', timeMs: ms2 }));
              }
              
              document.getElementById('sector-modal').style.display = 'none';
          }
  
          function setText(id, value) {
              const el = document.getElementById(id);
              if (!el) return;
              const next = String(value);
              if (el.innerText !== next) el.innerText = next;
          }
  
          function setElementText(el, value) {
              if (!el) return;
              const next = String(value);
              if (el.innerText !== next) el.innerText = next;
          }
  
          function setHtml(id, value) {
              const el = document.getElementById(id);
              if (!el) return;
              if (el.innerHTML !== value) el.innerHTML = value;
          }
  
          function setElementHtml(el, value) {
              if (!el) return;
              if (el.innerHTML !== value) el.innerHTML = value;
          }
  
          function setStyle(el, prop, value) {
              if (!el || el.style[prop] === value) return;
              el.style[prop] = value;
          }
  
          function setStyleById(id, prop, value) {
              setStyle(document.getElementById(id), prop, value);
          }
  
          function getTeamColorHex(teamColor) {
              if (typeof teamColor === 'number') return teamColor;
              if (typeof teamColor !== 'string') return 0xFFFFFF;
              const parsed = parseInt(teamColor.replace('#', '0x'), 16);
              return Number.isFinite(parsed) ? parsed : 0xFFFFFF;
          }
  
          function getTeamColorCss(driver, data) {
              const teamColor = driver?.teamColor ?? data?.allCars?.[driver?.carIndex]?.teamColor;
              const hex = getTeamColorHex(teamColor).toString(16).padStart(6, '0').slice(-6);
              return `#${hex}`;
          }
  
          function escapeHtml(value) {
              return String(value ?? '').replace(/[&<>"']/g, char => ({
                  '&': '&amp;',
                  '<': '&lt;',
                  '>': '&gt;',
                  '"': '&quot;',
                  "'": '&#39;'
              })[char]);
          }
  
          function getDriverName(data, carIndex) {
              return data?.participants?.[carIndex] ? data.participants[carIndex] : `CAR ${carIndex}`;
          }
  
          function getDriverAbbr(name, carIndex) {
              const clean = String(name || '').replace(/[^a-z0-9 ]/gi, '').trim();
              if (!clean) return `C${carIndex}`;
              const parts = clean.split(/\s+/);
              const source = parts.length > 1 ? parts[parts.length - 1] : clean;
              return source.slice(0, 3).toUpperCase();
          }
  
          function getLeaderboardDriver(data, carIndex) {
              return Array.isArray(data?.leaderboard) ? data.leaderboard.find(driver => driver.carIndex === carIndex) 
: null;
          }
  
          function getTrackGapToFront(data, driver) {
              const rows = Array.isArray(data?.leaderboard) ? data.leaderboard : [];
              const trackLength = data?.session?.trackLength || 0;
              const currDistance = Number(driver.lapDistance ?? data?.allCars?.[driver.carIndex]?.lapDistance ?? 0);
  
              if (!trackLength || !Number.isFinite(currDistance)) return driver?.gapText || '--';
  
              let nearestGap = Infinity;
              rows.forEach(row => {
                  if (row.carIndex === driver.carIndex || row.pitStatus > 0) return;
                  const rowDistance = Number(row.lapDistance ?? data?.allCars?.[row.carIndex]?.lapDistance ?? 0);
                  if (!Number.isFinite(rowDistance)) return;
  
                  let gap = rowDistance - currDistance;
                  if (gap <= 0) gap += trackLength;
                  if (gap > 0 && gap < nearestGap) nearestGap = gap;
              });
  
              return Number.isFinite(nearestGap) ? `${Math.round(nearestGap)} m` : 'CLEAR';
          }
  
          function getPopupGapText(data, driver) {
              const sessionType = data?.session?.type || '';
              const isRace = sessionType.includes('Race') || sessionType.includes('Sprint');
              if (isRace) return driver?.gapText || '--';
              return getTrackGapToFront(data, driver);
          }
  
          function isRaceSession(data) {
              const sessionType = data?.session?.type || '';
              return sessionType.includes('Race') || sessionType.includes('Sprint');
          }
  
          function worldToMapScreen(position) {
              const projected = position.clone().project(camera);
              return {
                  x: (projected.x * 0.5 + 0.5) * (mapContainer.clientWidth || 1),
                  y: (-projected.y * 0.5 + 0.5) * (mapContainer.clientHeight || 1)
              };
          }
  
          function updateMapOverlays() {
              if (!latestMapData || !mapLabelLayer || mapContainer.clientWidth === 0) return;
  
              let labelsHtml = '';
              carScreenData.length = 0;
              const showPitCallouts = isRaceSession(latestMapData);
              carMeshes.forEach(mesh => {
                  if (!mesh.visible) return;
                  const carIndex = mesh.userData.carIndex;
                  const driver = getLeaderboardDriver(latestMapData, carIndex) || { carIndex };
                  const inPit = driver.pitStatus === 1 || driver.pitStatus === 2;
                  const name = getDriverName(latestMapData, carIndex);
                  const abbr = getDriverAbbr(name, carIndex);
                  const teamColor = getTeamColorCss(driver, latestMapData);
                  const point = worldToMapScreen(mesh.position);
  
                  carScreenData.push({ carIndex, x: point.x, y: point.y });
                  if (showPitCallouts || !inPit) {
                      labelsHtml += `<div class="driver-callout" style="left:${point.x}px; top:${point.y}px; 
color:${teamColor};">${escapeHtml(abbr)}</div>`;
                  }
              });
  
              if (selectedCarIndex !== null) {
                  const selected = carScreenData.find(car => car.carIndex === selectedCarIndex);
                  const driver = getLeaderboardDriver(latestMapData, selectedCarIndex) || { carIndex: selectedCarIndex 
};
                  if (selected) {
                      const name = getDriverName(latestMapData, selectedCarIndex);
                      const team = driver.teamName || latestMapData?.allCars?.[selectedCarIndex]?.teamName || 
'Unknown';
                      const teamColor = getTeamColorCss(driver, latestMapData);
                      labelsHtml += `<div class="track-popup" style="left:${selected.x}px; top:${selected.y}px; 
color:${teamColor};">
                          <div class="name">${escapeHtml(name.toUpperCase())}</div>
                          <div class="meta"><span>Team</span><span>${escapeHtml(team)}</span></div>
                          <div class="meta"><span>Gap Front</span><span>${escapeHtml(getPopupGapText(latestMapData, 
driver))}</span></div>
                      </div>`;
                  } else {
                      selectedCarIndex = null;
                  }
              }
              // start marker is now a 3D mesh
  
              // Draw custom sector labels
              if (typeof customSectorMeshes !== 'undefined') {
                  customSectorMeshes.forEach((mesh, idx) => {
                      if (mesh.visible) {
                          const point = worldToMapScreen(mesh.position);
                          let labelText = '';
                          let color = '#ffaa00';
                          if (idx === 0) {
                              labelText = 'FINISH';
                              color = '#ffd700';
                          } else {
                              labelText = `S${idx}`;
                          }
                          labelsHtml += `<div style="position: absolute; left:${point.x}px; top:${point.y}px; 
transform: translate(-50%, -150%); color:${color}; font-size: 0.7rem; font-family: 'Roboto Mono', monospace; 
font-weight: bold; pointer-events: none; text-shadow: 0 0 4px #000;">${labelText}</div>`;
                      }
                  });
              }
  
              if (mapLabelLayer.innerHTML !== labelsHtml) mapLabelLayer.innerHTML = labelsHtml;
          }
  
          function animateClassificationSwap(container, nextHtml, nextOrder) {
              if (!container) return;
  
              const previousOrder = container.dataset.order ? container.dataset.order.split(',') : [];
              const shouldAnimate = previousOrder.length > 0 && previousOrder.join(',') !== nextOrder.join(',');
              const firstRects = new Map();
  
              if (shouldAnimate) {
                  container.querySelectorAll('.lb-row[data-car-index]').forEach(row => {
                      firstRects.set(row.dataset.carIndex, row.getBoundingClientRect());
                  });
              }
  
              if (container.innerHTML !== nextHtml) container.innerHTML = nextHtml;
              container.dataset.order = nextOrder.join(',');
  
              if (!shouldAnimate) return;
  
              container.querySelectorAll('.lb-row[data-car-index]').forEach(row => {
                  const first = firstRects.get(row.dataset.carIndex);
                  if (!first) return;
  
                  const last = row.getBoundingClientRect();
                  const deltaY = first.top - last.top;
                  if (Math.abs(deltaY) < 1) return;
  
                  row.animate([
                      { transform: `translateY(${deltaY}px)`, zIndex: 2 },
                      { transform: 'translateY(0)', zIndex: 2 }
                  ], {
                      duration: 360,
                      easing: 'cubic-bezier(0.2, 0, 0, 1)'
                  });
              });
          }
  
          function clampPercent(value) {
              const number = Number(value);
              if (!Number.isFinite(number)) return 0;
              return Math.max(0, Math.min(100, number));
          }
  
          function getWearColor(wearPercent) {
              const w = Math.max(0, Math.min(100, wearPercent));
              // Map: 0% wear → green (hue 130), ~40% → yellow (hue 55), 70%+ → red (hue 0)
              let hue;
              if (w <= 30) {
                  hue = 130 - (w / 30) * 40; // 130 → 90
              } else if (w <= 55) {
                  hue = 90 - ((w - 30) / 25) * 50; // 90 → 40
              } else {
                  hue = 40 - ((w - 55) / 45) * 40; // 40 → 0
              }
              hue = Math.max(0, hue);
              const saturation = 85 + (w / 100) * 15; // 85% → 100%
              const lightness = w > 70 ? 48 : 50;
              return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
          }
  
          function updateCarTyreVisual(wearData, compound) {
              ['fl', 'fr', 'rl', 'rr'].forEach(corner => {
                  const wear = Math.round(wearData[corner] || 0);
                  const color = getWearColor(wear);
  
                  // Update SVG tyre rectangle color
                  const tyreRect = document.getElementById(`tyre-rect-${corner}`);
                  if (tyreRect) {
                      tyreRect.setAttribute('fill', color);
                  }
  
                  // Update SVG wear percentage text
                  const tyrePct = document.getElementById(`tyre-pct-${corner}`);
                  if (tyrePct) {
                      tyrePct.textContent = `${wear}%`;
                  }
  
                  // Update wear bar in data panel
                  const wearBar = document.getElementById(`wear-bar-${corner}`);
                  if (wearBar) {
                      wearBar.style.width = `${wear}%`;
                      wearBar.style.backgroundColor = color;
                  }
  
                  // Update wear text in data panel
                  const wearText = document.getElementById(`wear-text-${corner}`);
                  if (wearText) {
                      wearText.textContent = `${wear}% Wear`;
                      wearText.style.color = color;
                  }
              });
  
              // Update compound label on car SVG
              const compVal = document.getElementById('car-compound-value');
              if (compVal) compVal.textContent = (compound || '--').toUpperCase();
  
              // Also update the bottom row displays
              setText('tyre-compound-display', compound || '--');
          }
  
          function drawGGraph() {
              const dpr = window.devicePixelRatio || 1;
              const width = gGraph.clientWidth || 300;
              const height = gGraph.clientHeight || 90;
              if (gGraph.width !== Math.floor(width * dpr) || gGraph.height !== Math.floor(height * dpr)) {
                  gGraph.width = Math.floor(width * dpr);
                  gGraph.height = Math.floor(height * dpr);
              }
  
              gGraphCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
              gGraphCtx.clearRect(0, 0, width, height);
              gGraphCtx.fillStyle = '#06060e';
              gGraphCtx.fillRect(0, 0, width, height);
  
              const graphLeft = 36;
              const graphRight = width - 6;
              const graphTop = 6;
              const graphBottom = height - 14;
              const graphHeight = graphBottom - graphTop;
              const graphWidth = graphRight - graphLeft;
              const graphMax = Math.max(4, Math.ceil(maxGSeen));
  
              gGraphCtx.strokeStyle = 'rgba(255,255,255,0.05)';
              gGraphCtx.lineWidth = 1;
              gGraphCtx.fillStyle = '#6e6e80';
              gGraphCtx.font = '10px Roboto Mono, monospace';
              gGraphCtx.textAlign = 'right';
              gGraphCtx.textBaseline = 'middle';
              for (let i = 0; i <= 4; i++) {
                  const value = (graphMax / 4) * i;
                  const y = graphBottom - (i / 4) * graphHeight;
                  gGraphCtx.beginPath();
                  gGraphCtx.moveTo(graphLeft, y);
                  gGraphCtx.lineTo(graphRight, y);
                  gGraphCtx.stroke();
                  gGraphCtx.fillText(`${value.toFixed(0)}G`, graphLeft - 6, y);
              }
  
              if (gHistory.length < 2) return;
  
              // Draw gradient fill under line
              gGraphCtx.beginPath();
              gHistory.forEach((value, index) => {
                  const x = graphLeft + (index / (gHistory.length - 1)) * graphWidth;
                  const y = graphBottom - (Math.min(value, graphMax) / graphMax) * graphHeight;
                  if (index === 0) gGraphCtx.moveTo(x, y);
                  else gGraphCtx.lineTo(x, y);
              });
              gGraphCtx.lineTo(graphRight, graphBottom);
              gGraphCtx.lineTo(graphLeft, graphBottom);
              gGraphCtx.closePath();
              const gradient = gGraphCtx.createLinearGradient(0, graphTop, 0, graphBottom);
              gradient.addColorStop(0, 'rgba(255, 214, 10, 0.15)');
              gradient.addColorStop(1, 'rgba(255, 214, 10, 0)');
              gGraphCtx.fillStyle = gradient;
              gGraphCtx.fill();
  
              // Draw the line
              gGraphCtx.strokeStyle = '#ffd60a';
              gGraphCtx.lineWidth = 2;
              gGraphCtx.lineJoin = 'round';
              gGraphCtx.lineCap = 'round';
              gGraphCtx.beginPath();
              gHistory.forEach((value, index) => {
                  const x = graphLeft + (index / (gHistory.length - 1)) * graphWidth;
                  const y = graphBottom - (Math.min(value, graphMax) / graphMax) * graphHeight;
                  if (index === 0) gGraphCtx.moveTo(x, y);
                  else gGraphCtx.lineTo(x, y);
              });
              gGraphCtx.stroke();
  
              // Glow dot at the latest point
              if (gHistory.length > 0) {
                  const lastX = graphRight;
                  const lastVal = gHistory[gHistory.length - 1];
                  const lastY = graphBottom - (Math.min(lastVal, graphMax) / graphMax) * graphHeight;
                  gGraphCtx.fillStyle = '#ffd60a';
                  gGraphCtx.shadowColor = 'rgba(255, 214, 10, 0.6)';
                  gGraphCtx.shadowBlur = 8;
                  gGraphCtx.beginPath();
                  gGraphCtx.arc(lastX, lastY, 3, 0, Math.PI * 2);
                  gGraphCtx.fill();
                  gGraphCtx.shadowBlur = 0;
              }
          }
  
          function getGForceFeel(latG, longG, totalG) {
              const absLat = Math.abs(latG);
              const absLong = Math.abs(longG);
  
              if (totalG >= 3.5) return { text: 'LIMIT LOAD', color: 'var(--f1-red)' };
              if (absLong >= 2.2 && longG < 0) return { text: 'HEAVY BRAKING', color: 'var(--f1-red)' };
              if (absLong >= 1.8 && longG > 0) return { text: 'HARD LAUNCH', color: 'var(--fia-green)' };
              if (absLat >= 2.2) return { text: 'HIGH CORNERING', color: 'var(--fia-yellow)' };
              if (totalG >= 1.3) return { text: 'LOADED', color: 'var(--fia-blue)' };
              return { text: 'STABLE', color: 'var(--text-muted)' };
          }
  
          function getKinematicG(speedKmh, currentMs) {
              const speedMs = Number(speedKmh) / 3.6;
              if (!Number.isFinite(speedMs) || lastSpeedMs === null || lastGSampleTime === 0 || currentMs < 
lastGSampleTime) {
                  lastSpeedMs = speedMs;
                  lastGSampleTime = currentMs;
                  return 0;
              }
  
              const dt = (currentMs - lastGSampleTime) / 1000;
              const deltaSpeed = Math.abs(speedMs - lastSpeedMs);
              lastSpeedMs = speedMs;
              lastGSampleTime = currentMs;
              return dt > 0 ? (deltaSpeed / dt) / G_ACCELERATION : 0;
          }
  
          function updateGForceDisplay(latG, longG, speedKmh, currentMs) {
              if (currentMs === lastCurrentMsForG) return; // Paused or no time change
              lastCurrentMsForG = currentMs;
  
              const sensorG = Math.hypot(latG, longG);
              const speedChangeG = getKinematicG(speedKmh, currentMs);
              const sensorLooksValid = sensorG <= MAX_REASONABLE_SENSOR_G;
              const experiencedG = Math.min(
                  MAX_REASONABLE_DRIVER_G,
                  Math.max(sensorLooksValid ? sensorG : 0, speedChangeG)
              );
              const gFeel = !sensorLooksValid && speedChangeG < 0.5
                  ? { text: 'SENSOR SPIKE', color: 'var(--fia-yellow)' }
                  : getGForceFeel(latG, longG, experiencedG);
  
              lastValidG = experiencedG;
              maxGSeen = Math.max(maxGSeen, experiencedG);
              gHistory.push(experiencedG);
              if (gHistory.length > 180) gHistory.shift();
  
              setText('g-total', `${experiencedG.toFixed(2)} G`);
              setText('g-max', `${maxGSeen.toFixed(2)} G`);
              setText('g-feel', gFeel.text);
              setStyleById('g-feel', 'color', gFeel.color);
              drawGGraph();
          }
  
          function connectWebSocket(urlIndex = 0) {
              const urls = getWebSocketUrls();
              ws = new WebSocket(urls[urlIndex]);
              ws.onopen = () => { setText('ws-status', 'CONNECTED'); setStyleById('ws-status', 'color', 
'var(--fia-green)'); };
              ws.onerror = () => {
                  if (urlIndex + 1 < urls.length) {
                      connectWebSocket(urlIndex + 1);
                      return;
                  }
                  setText('ws-status', 'OFFLINE');
                  setStyleById('ws-status', 'color', 'var(--f1-red)');
              };
              ws.onmessage = handleTelemetryMessage;
          }
  
          function formatMs(ms) {
              if (!ms || ms === 0) return "--:--.---";
              const m = Math.floor(ms / 60000);
              const s = Math.floor((ms % 60000) / 1000);
              const milli = ms % 1000;
              return `${m}:${s.toString().padStart(2, '0')}.${milli.toString().padStart(3, '0')}`;
          }
  
          function handleTelemetryMessage(event) {
              const data = JSON.parse(event.data);
              const playerLbData = data.leaderboard ? data.leaderboard.find(d => d.carIndex === data.playerIndex) : 
null;
  
              setText('track-name', data.session.trackName.toUpperCase());
              setText('session-type', data.session.type.toUpperCase());
              setText('weather', data.session.weather.toUpperCase());
              setText('track-temp', `${data.session.trackTemp} °C`);
  
              // New Distance & Laps metrics mapping
              setText('lap-num', data.lap.lapNum);
              setText('laps-total', data.session.lapsTotal);
              setText('laps-left', data.session.lapsLeft || 0);
              setText('track-length', `${(data.session.trackLength / 1000).toFixed(3)} km`);
              setText('race-dist', `${(data.session.raceDistance / 1000).toFixed(3)} km`);
              setText('pos', '--');
  
              const flagBox = document.getElementById('fia-flag');
              setElementText(flagBox, `${data.car.flag} FLAG`);
              if (data.car.flag === 'YELLOW') { setStyle(flagBox, 'backgroundColor', 'var(--fia-yellow)'); 
setStyle(flagBox, 'color', '#000'); }
              else if (data.car.flag === 'RED') { setStyle(flagBox, 'backgroundColor', 'var(--f1-red)'); 
setStyle(flagBox, 'color', '#FFF'); }
              else if (data.car.flag === 'BLUE') { setStyle(flagBox, 'backgroundColor', 'var(--fia-blue)'); 
setStyle(flagBox, 'color', '#000'); }
              else { setStyle(flagBox, 'backgroundColor', 'var(--fia-green)'); setStyle(flagBox, 'color', '#000'); }
  
              setText('sc-status', data.session.sc);
  
              if (data.penalties) {
                  setText('pen-time', data.penalties.timePenalties > 0 ? `${data.penalties.timePenalties} s` : '0 s');
                  setText('pen-warn', data.penalties.warnings || 0);
                  setText('pen-cc', data.penalties.cornerCuts || 0);
                  setText('pen-dt-sg', `${data.penalties.driveThrough || 0} / ${data.penalties.stopGo || 0}`);
                  document.getElementById('lap-invalid-row').style.display = data.penalties.invalidLap === 1 ? 'flex' 
: 'none';
              }
              setText('pit-status', data.lap.pitStatus);
              setText('tyre-compound', data.car.compound);
              setText('tyre-age', `${data.car.tyreAge} Laps`);
              setText('gap-front', data.lap.gapFront || '+0.000');
  
              const stratBox = document.getElementById('strategy-box');
              const strategyInfo = calculatePitStrategy(data);
              setElementText(stratBox, strategyInfo.text);
              setStyle(stratBox, 'color', strategyInfo.color);
              setStyle(stratBox, 'backgroundColor', strategyInfo.bgColor);
              setStyle(stratBox, 'border', strategyInfo.border);
  
              setText('lap-current', formatMs(data.lap.currentMs));
              
              let dLiveEl = document.getElementById('delta-live');
              let dRefEl = document.getElementById('delta-reference');
  
              if (data.lap.ghostLapTimeMs && data.lap.ghostLapTimeMs > 0) {
                  setElementText(dRefEl, `Ref: ${formatMs(data.lap.ghostLapTimeMs)}`);
              } else {
                  setElementText(dRefEl, `Ref: --:--.---`);
              }
  
              if (data.lap.liveDeltaToRecord !== undefined && data.lap.liveDeltaToRecord !== 0) {
                  const diffLive = data.lap.liveDeltaToRecord;
                  if (diffLive <= 0) {
                      setElementText(dLiveEl, `vs PB: ${(diffLive / 1000).toFixed(3)}s`);
                      setStyle(dLiveEl, 'color', 'var(--fia-green)');
                  } else {
                      setElementText(dLiveEl, `vs PB: +${(diffLive / 1000).toFixed(3)}s`);
                      setStyle(dLiveEl, 'color', 'var(--f1-red)');
                  }
              } else {
                  setElementText(dLiveEl, 'vs PB: --');
                  setStyle(dLiveEl, 'color', 'var(--text-muted)');
              }
  
              setText('lap-last', formatMs(data.lap.lastMs));
              setText('lap-best', formatMs(data.lap.bestMs));
              
              if (data.lap.s1 > 0) setText('lap-s1', "S1: " + (data.lap.s1 / 1000).toFixed(3));
              else setText('lap-s1', "S1: --.---");
              
              if (data.lap.s2 > 0) setText('lap-s2', "S2: " + (data.lap.s2 / 1000).toFixed(3));
              else setText('lap-s2', "S2: --.---");
              
              if (data.lap.s3 > 0) setText('lap-s3', "S3: " + (data.lap.s3 / 1000).toFixed(3));
              else setText('lap-s3', "S3: --.---");
              
              const recordMs = data.session.allTimeFastestLapMs === Infinity ? 0 : data.session.allTimeFastestLapMs;
              setText('lap-record', formatMs(recordMs));
              setText('record-driver', data.session.allTimeFastestDriver !== 'Unknown' ? 
`(${data.session.allTimeFastestDriver})` : '');
  
              let dRecordEl = document.getElementById('delta-record');
              if (recordMs > 0 && data.lap.bestMs > 0) {
                  const diffRecord = data.lap.bestMs - recordMs;
                  if (diffRecord <= 0) {
                      setElementText(dRecordEl, `vs PB: ${(diffRecord / 1000).toFixed(3)}s`);
                      setStyle(dRecordEl, 'color', 'var(--fia-purple)');
                  } else {
                      setElementText(dRecordEl, `vs PB: +${(diffRecord / 1000).toFixed(3)}s`);
                      setStyle(dRecordEl, 'color', 'var(--f1-red)');
                  }
              } else {
                  setElementText(dRecordEl, 'vs PB: --');
                  setStyle(dRecordEl, 'color', 'var(--text-muted)');
              }
  
              let dPrevEl = document.getElementById('delta-prev');
              let dBestEl = document.getElementById('delta-best');
  
              if (playerLbData && playerLbData.lapHistory && playerLbData.lapHistory.length > 1) {
                  const hist = playerLbData.lapHistory;
                  const len = hist.length;
                  const lastValidMs = len >= 2 ? hist[len - 2] : 0;
                  const prevValidMs = len >= 3 ? hist[len - 3] : 0;
  
                  if (lastValidMs > 0) {
                      let oldPB = Infinity;
                      for (let i = 0; i < len - 2; i++) { if (hist[i] > 0 && hist[i] < oldPB) oldPB = hist[i]; }
  
                      if (oldPB === Infinity) {
                          setElementText(dBestEl, 'Delta: BENCHMARK');
                          setStyle(dBestEl, 'color', 'var(--fia-purple)');
                      } else {
                          const diffBest = lastValidMs - oldPB;
                          if (diffBest <= 0) {
                              setElementText(dBestEl, `Delta: ${(diffBest / 1000).toFixed(3)}s`);
                              setStyle(dBestEl, 'color', 'var(--fia-purple)');
                          } else {
                              setElementText(dBestEl, `Delta: +${(diffBest / 1000).toFixed(3)}s`);
                              setStyle(dBestEl, 'color', 'var(--f1-red)');
                          }
                      }
                  } else {
                      setElementText(dBestEl, 'Delta: INVALID LAP');
                      setStyle(dBestEl, 'color', 'var(--fia-yellow)');
                  }
  
                  if (lastValidMs > 0 && prevValidMs > 0) {
                      const diffPrev = lastValidMs - prevValidMs;
                      if (diffPrev <= 0) {
                          setElementText(dPrevEl, `vs Prev: ${(diffPrev / 1000).toFixed(3)}s`);
                          setStyle(dPrevEl, 'color', 'var(--fia-green)');
                      } else {
                          setElementText(dPrevEl, `vs Prev: +${(diffPrev / 1000).toFixed(3)}s`);
                          setStyle(dPrevEl, 'color', 'var(--f1-red)');
                      }
                  }
              }
  
              if (data.allCars && data.allCars.length === 24) {
                  latestMapData = data;
  
                  if (data.startLine && data.startLine.yaw !== undefined) {
                      startLineMesh.position.set(data.startLine.x, 0, data.startLine.z);
                      startLineMesh.rotation.y = -data.startLine.yaw;
                      startLineMesh.visible = true;
                  }
                  if (data.sector1 && data.sector1.yaw !== undefined) {
                      sector1LineMesh.position.set(data.sector1.x, 0, data.sector1.z);
                      sector1LineMesh.rotation.y = -data.sector1.yaw;
                      sector1LineMesh.visible = true;
                  }
                  if (data.sector2 && data.sector2.yaw !== undefined) {
                      sector2LineMesh.position.set(data.sector2.x, 0, data.sector2.z);
                      sector2LineMesh.rotation.y = -data.sector2.yaw;
                      sector2LineMesh.visible = true;
                  }
  
                  if (data.trackPoints && data.trackPoints.length !== window.lastTrackPointsLength) {
                      window.lastTrackPointsLength = data.trackPoints.length;
                      if (data.trackPoints.length > 0) {
                          let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
                          const threePts = [];
                          data.trackPoints.forEach(pt => {
                              if (pt.x < minX) minX = pt.x;
                              if (pt.x > maxX) maxX = pt.x;
                              if (pt.z < minZ) minZ = pt.z;
                              if (pt.z > maxZ) maxZ = pt.z;
                              threePts.push(new THREE.Vector3(pt.x, 0, pt.z));
                          });
                          if (threePts.length > 2) {
                              threePts.push(threePts[0].clone());
                          }
                          trackGeometry.setFromPoints(threePts);
  
                          const centerX = (minX + maxX) / 2;
                          const centerZ = (minZ + maxZ) / 2;
                          const maxDim = Math.max(maxX - minX, maxZ - minZ);
                          const newViewSize = (maxDim / 2) + 200;
  
                          trackViewCenter.set(centerX, 0, centerZ);
                          trackBaseViewSize = Math.max(300, newViewSize);
                          gridHelper.position.set(centerX, -1, centerZ);
                          updateTrackCameraBounds();
                      }
                  }
  
                  if (data.customSectorLines) {
                      data.customSectorLines.forEach((sectorObj, i) => {
                          let mesh = customSectorMeshes[i];
                          if (!mesh) {
                              mesh = createSectorLine(i === 0 ? 0xffd700 : 0xffaa00);
                              customSectorMeshes.push(mesh);
                          }
                          
                          if (sectorObj && sectorObj.x !== undefined && sectorObj.z !== undefined) {
                              mesh.position.set(sectorObj.x, 0, sectorObj.z);
                              if (sectorObj.yaw !== undefined) mesh.rotation.y = -sectorObj.yaw;
                              mesh.visible = true;
                          }
                      });
                      
                      for (let i = data.customSectorLines.length; i < customSectorMeshes.length; i++) {
                          customSectorMeshes[i].visible = false;
                      }
                  }
  
                  for (let i = 0; i < 24; i++) {
                      const carData = data.allCars[i];
                      const mesh = carMeshes[i];
  
                      if (carData.x === 0 && carData.z === 0) {
                          mesh.visible = false;
                      } else {
                          mesh.visible = true;
                          mesh.position.set(carData.x, 0, carData.z);
                          const teamHex = getTeamColorHex(carData.teamColor);
                          mesh.material.color.setHex(teamHex);
  
                          if (i === data.playerIndex) {
                              mesh.scale.set(1.5, 1.5, 1.5);
                              mesh.renderOrder = 999;
                          } else {
                              mesh.scale.set(1, 1, 1);
                              mesh.renderOrder = 1;
                          }
                      }
                  }
              }
  
              setText('speed', data.inputs.speed);
              setText('gear', data.inputs.gear);
              setText('rpm', data.inputs.rpm);
              setText('steer', data.inputs.steer.toFixed(2));
              setText('drs', data.inputs.drs);
              setStyleById('drs', 'color', data.inputs.drs === 'OPEN' ? 'var(--fia-green)' : 'var(--text-main)');
              setStyleById('throttle', 'width', `${clampPercent(data.inputs.throttle)}%`);
              setText('thr-val', `${Math.round(data.inputs.throttle)}%`);
              setStyleById('brake', 'width', `${clampPercent(data.inputs.brake)}%`);
              setText('brk-val', `${Math.round(data.inputs.brake)}%`);
              setStyleById('clutch', 'width', `${clampPercent(data.inputs.clutch)}%`);
              setText('clu-val', `${data.inputs.clutch}%`);
  
              setText('g-lat', `${data.motion.gLat.toFixed(2)}`);
              setText('g-long', `${data.motion.gLong.toFixed(2)}`);
              updateGForceDisplay(data.motion.gLat, data.motion.gLong, data.inputs.speed, data.lap.currentMs);
              setText('pitch', `${data.motion.pitch.toFixed(2)}`);
              setText('roll', `${data.motion.roll.toFixed(2)}`);
              setStyleById('susp-fl', 'width', `${clampPercent(Math.abs(data.motion.susp.fl * 15))}%`);
              setStyleById('susp-fr', 'width', `${clampPercent(Math.abs(data.motion.susp.fr * 15))}%`);
              setStyleById('susp-rl', 'width', `${clampPercent(Math.abs(data.motion.susp.rl * 15))}%`);
              setStyleById('susp-rr', 'width', `${clampPercent(Math.abs(data.motion.susp.rr * 15))}%`);
  
              setText('engine-temp', `${data.car.engineTemp} °C`);
              ['fl', 'fr', 'rl', 'rr'].forEach(c => {
                  setText(`temp-surf-${c}`, data.car.surfTemp[c]);
                  setText(`temp-in-${c}`, data.car.inTemp[c]);
                  setText(`press-${c}`, data.car.press[c].toFixed(1));
                  setText(`brake-temp-${c}`, data.car.brakeTemp[c]);



