"use strict";
const $ = id => document.getElementById(id);
const regions = EVData.region(EVBoundaries);
const stationInput = $("stations"), tariffInput = $("tariffs");
const provinceInput = $("province"), districtInput = $("district"), speedInput = $("speed");
const searchInput = $("search"), status = $("status"), results = $("results"), details = $("details");
const download = $("download"), downloadTariffs = $("download-tariffs"), more = $("more");
const canvas = $("map"), ctx = canvas.getContext("2d");
const collator = new Intl.Collator("ko");
const format = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 8 });
const rateBands = ["30 kW 미만", "30~49 kW", "50~99 kW", "100~199 kW", "200 kW 이상"];
const bandMaximums = [30, 50, 100, 200, Infinity];
const rateProviders = new Map(EVBuiltInRates.map(row => [row[0], row]));
const tariffAliases = new Map([
  ["환경부(한국자동차환경협회)", "기후에너지환경부"],
  ["환경부", "기후에너지환경부"],
  ["한전", "한국전력공사"]
]);

let source, stationData, tariffData;
let builtInData, usingBuiltIn = false;
let stationError = "", tariffError = "";
let stationRevision = 0, tariffRevision = 0;
let stationLoading = false, tariffLoading = false;
let visible = [], selected = null, limit = 60;
let mapPath, bounds, points = [], transform, drag;
let zoom = 1, offsetX = 0, offsetY = 0;
const aspect = Math.cos(36 * Math.PI / 180);
const paths = new Map();

function sorted(items, field) {
  return [...items].sort((a, b) => collator.compare(field(a), field(b)));
}
function chooseDistricts() {
  const districts = [...regions.districts.values()].filter(d => d.province === provinceInput.value && d.name);
  districtInput.replaceChildren(new Option("전체", ""));
  for (const district of sorted(districts, d => d.name)) districtInput.add(new Option(district.name, district.id));
  districtInput.disabled = districts.length === 0;
}
provinceInput.add(new Option("전국", ""));
for (const [id, name] of sorted(regions.provinces, p => p[1])) provinceInput.add(new Option(name, id));
chooseDistricts();

function inRegion(station) {
  return (!provinceInput.value || station.province === provinceInput.value)
    && (!districtInput.value || station.district === districtInput.value);
}
function mapped(station) {
  return station.lat !== null && station.lon !== null;
}
function providerRate(provider) {
  return rateProviders.get(tariffAliases.get(provider) ?? provider);
}
function stationTariffs(station) {
  const entries = tariffData?.tariffs.get(station.id);
  if (!entries?.length) return [];
  const chargerIds = new Set(station.chargers.map(item => item.id).filter(Boolean));
  return entries.filter(item => !item.charger || chargerIds.has(item.charger));
}
function priceRange(amounts, label) {
  let low = Infinity;
  let high = -Infinity;
  for (const amount of amounts) {
    low = Math.min(low, amount);
    high = Math.max(high, amount);
  }
  if (!amounts.length) return "요금 정보 없음";
  const range = low === high ? format.format(low) : format.format(low) + "–" + format.format(high);
  return range + "원/kWh · " + label;
}
function listPrice(station) {
  const entries = stationTariffs(station);
  if (entries.length) return priceRange(entries.map(item => item.price), "충전소 요금 자료");
  const rate = providerRate(station.provider);
  if (!rate) return "요금 정보 없음";
  const amounts = rate.slice(2);
  if (!station.chargers.length || station.chargers.some(item => !item.kw)) {
    return priceRange(amounts.filter(amount => amount !== null), "운영사 전체 구간 안내가");
  }
  const bands = new Set(station.chargers.map(item => bandMaximums.findIndex(max => item.kw < max)));
  const knownAmounts = [...bands].map(index => amounts[index]).filter(amount => amount !== null);
  if (!knownAmounts.length) return "해당 출력 구간 요금 정보 없음";
  const label = knownAmounts.length === bands.size ? "운영사 안내가" : "확인된 출력 구간 안내가";
  return priceRange(knownAmounts, label);
}
function refresh(resetMap = false) {
  const stations = stationData?.stations ?? [];
  const query = searchInput.value.trim().toLowerCase();
  visible = stations.filter(station => inRegion(station)
    && (!speedInput.value || (station.chargers.length
      ? station.chargers.some(item => item.speeds.includes(speedInput.value))
      : speedInput.value === "미분류"))
    && (!query || (station.name + " " + station.address).toLowerCase().includes(query)));
  if (!visible.includes(selected)) selected = null;
  const invalid = stations.filter(s => !s.district).length;
  const withoutPin = visible.filter(s => !mapped(s)).length;
  const messages = [];
  if (stationLoading) messages.push("충전소 CSV를 읽는 중입니다…");
  else if (stationError) messages.push(stationError);
  else if (!stationData) messages.push("표시할 충전소 자료가 없습니다.");
  else {
    messages.push("충전소 " + format.format(visible.length) + "곳");
    messages.push("지도 표시 " + format.format(visible.length - withoutPin) + "곳");
    if (withoutPin) messages.push("좌표 없이 목록에 표시 " + format.format(withoutPin) + "곳");
    if (usingBuiltIn) messages.push("기본 자료 · 운영사 요금 " + format.format(rateProviders.size) + "개사");
    if (invalid) messages.push("전체 자료에서 지역 미분류 " + format.format(invalid) + "곳");
    if (stationData.skipped) messages.push("형식 오류 " + format.format(stationData.skipped) + "행 제외");
    if (stationData.omitted) messages.push("삭제 표시 " + format.format(stationData.omitted) + "행 제외");
  }
  if (tariffLoading) messages.push("요금 CSV를 읽는 중입니다…");
  if (tariffError) messages.push(tariffError);
  if (tariffData?.skipped) messages.push("요금 오류 " + format.format(tariffData.skipped) + "행 제외");
  status.textContent = messages.join(" · ");
  download.disabled = !source;
  downloadTariffs.disabled = !stationData;
  renderList();
  renderDetails();
  if (resetMap) fitRegion();
  else draw();
}
function element(tag, value) {
  const node = document.createElement(tag);
  node.textContent = value;
  return node;
}
function selectStation(station, button) {
  selected = station;
  renderDetails();
  if (button) {
    results.querySelector('[aria-pressed="true"]')?.setAttribute("aria-pressed", "false");
    button.setAttribute("aria-pressed", "true");
  } else renderList();
  draw();
}
function renderList() {
  const items = document.createDocumentFragment();
  for (const station of visible.slice(0, limit)) {
    const row = document.createElement("li");
    const button = element("button", station.name);
    button.type = "button";
    button.setAttribute("aria-pressed", String(station === selected));
    button.append(element("span", station.address || "주소 정보 없음"));
    const price = element("span", listPrice(station));
    price.className = "station-price";
    button.append(price);
    button.onclick = () => selectStation(station, button);
    row.append(button);
    items.append(row);
  }
  results.replaceChildren(items);
  more.hidden = visible.length <= limit;
}
function renderDetails() {
  details.replaceChildren(element("h2", selected?.name ?? "충전소 상세"));
  if (!selected) {
    details.append(element("p", "지도 또는 목록에서 충전소를 선택하세요."));
    return;
  }
  details.append(element("p", selected.address || "주소 정보 없음"));
  if (selected.provider) details.append(element("p", "운영기관 " + selected.provider));
  if (selected.hours) details.append(element("p", "이용시간 " + selected.hours));
  if (selected.restriction) details.append(element("p", "이용 제한 " + selected.restriction));
  if (!mapped(selected)) details.append(element("p", "지도에 표시할 좌표가 없습니다."));
  else if (selected.locationSource) details.append(element("p", "지도 좌표 " + selected.locationSource));
  const chargers = document.createElement("ul");
  for (const item of selected.chargers) {
    const label = [item.id && "충전기 " + item.id, item.type && "유형 " + item.type,
      item.capacity || [item.speeds.join(" / "), item.kw && format.format(item.kw) + " kW"].filter(Boolean).join(" · "),
      item.count && "등록 " + format.format(item.count) + "기"].filter(Boolean);
    chargers.append(element("li", label.join(" · ")));
  }
  details.append(selected.chargers.length ? chargers : element("p", "충전기 세부 자료가 없습니다."), element("h2", "충전요금"));
  const entries = stationTariffs(selected);
  const rates = document.createElement("ul");
  if (entries.length) {
    for (const item of entries) {
      const label = [format.format(item.price) + "원/kWh", item.charger && "충전기 " + item.charger,
        item.label, item.date && item.date + "부터"].filter(Boolean);
      rates.append(element("li", label.join(" · ")));
    }
  } else {
    const rate = providerRate(selected.provider);
    if (!rate) {
      details.append(element("p", "기본 자료에서 이 충전소의 요금을 확인할 수 없습니다."));
      return;
    }
    const [provider, date, ...amounts] = rate;
    details.append(element("p", provider + " 출력별 안내가 · 갱신일 " + date));
    details.append(element("p", "결제 방식과 현장 조건에 따라 실제 요금이 달라질 수 있습니다."));
    for (const [index, amount] of amounts.entries()) {
      if (amount !== null) rates.append(element("li", rateBands[index] + " · " + format.format(amount) + "원/kWh"));
    }
  }
  details.append(rates);
}
function geometryPath() {
  let path = new Path2D();
  const extent = [Infinity, Infinity, -Infinity, -Infinity];
  for (const { properties: p, geometry } of EVBoundaries) {
    if (provinceInput.value && p.sido !== provinceInput.value) continue;
    if (districtInput.value && p.sido + "/" + p.sgg !== districtInput.value) continue;
    const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
    for (const polygon of polygons) {
      for (const ring of polygon) {
        ring.forEach(([lon, lat], index) => {
          const x = lon * aspect, y = -lat;
          if (index === 0) path.moveTo(x, y);
          else path.lineTo(x, y);
          extent[0] = Math.min(extent[0], x);
          extent[1] = Math.min(extent[1], y);
          extent[2] = Math.max(extent[2], x);
          extent[3] = Math.max(extent[3], y);
        });
        path.closePath();
      }
    }
  }
  if (!Number.isFinite(extent[0])) path = new Path2D();
  return { path, extent: Number.isFinite(extent[0]) ? extent : [125 * aspect, -40, 132 * aspect, -33] };
}
function fitRegion() {
  const key = provinceInput.value + "|" + districtInput.value;
  if (!paths.has(key)) {
    if (paths.size >= 4) paths.delete(paths.keys().next().value);
    paths.set(key, geometryPath());
  }
  ({ path: mapPath, extent: bounds } = paths.get(key));
  zoom = 1; offsetX = 0; offsetY = 0;
  draw();
}
function draw() {
  if (!bounds) return;
  const { width, height } = canvas.getBoundingClientRect();
  if (!width || !height) return;
  const ratio = window.devicePixelRatio || 1;
  const pixelWidth = Math.round(width * ratio), pixelHeight = Math.round(height * ratio);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth; canvas.height = pixelHeight;
  }
  const [left, top, right, bottom] = bounds;
  const scale = Math.min((width - 48) / Math.max(.001, right - left), (height - 72) / Math.max(.001, bottom - top)) * zoom;
  const tx = width / 2 + offsetX - scale * (left + right) / 2;
  const ty = height / 2 + offsetY - scale * (top + bottom) / 2;
  transform = { scale, tx, ty };
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.fillStyle = "#e7f1ee";
  ctx.fillRect(0, 0, width, height);
  ctx.save();
  ctx.transform(scale, 0, 0, scale, tx, ty);
  ctx.fillStyle = "#fafcf9";
  ctx.strokeStyle = "#97b2a4";
  ctx.lineWidth = .65 / scale;
  ctx.fill(mapPath, "evenodd");
  ctx.stroke(mapPath);
  ctx.restore();
  points = [];
  ctx.beginPath();
  for (const station of visible) {
    if (!mapped(station)) continue;
    const x = station.lon * aspect * scale + tx, y = -station.lat * scale + ty;
    if (x < -8 || x > width + 8 || y < -8 || y > height + 8) continue;
    points.push({ station, x, y });
    ctx.moveTo(x + 3, y);
    ctx.arc(x, y, 3, 0, Math.PI * 2);
  }
  ctx.fillStyle = "#17684f";
  ctx.fill();
  const point = points.find(item => item.station === selected);
  if (point) {
    ctx.beginPath();
    ctx.arc(point.x, point.y, 7, 0, Math.PI * 2);
    ctx.fillStyle = "#b64c13";
    ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}
function adjustZoom(factor, anchor) {
  const next = Math.min(40, Math.max(.65, zoom * factor));
  if (anchor && transform) {
    const rect = canvas.getBoundingClientRect();
    const ratio = next / zoom;
    offsetX = ratio * offsetX + (1 - ratio) * (anchor.x - rect.width / 2);
    offsetY = ratio * offsetY + (1 - ratio) * (anchor.y - rect.height / 2);
  }
  zoom = next;
  draw();
}
function position(event) {
  const rect = canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}
canvas.addEventListener("wheel", event => {
  event.preventDefault();
  adjustZoom(event.deltaY < 0 ? 1.25 : .8, position(event));
}, { passive: false });
canvas.addEventListener("pointerdown", event => {
  if (!event.isPrimary || event.button !== 0) return;
  drag = { x: event.clientX, y: event.clientY, dx: offsetX, dy: offsetY, id: event.pointerId };
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener("pointermove", event => {
  if (drag?.id !== event.pointerId) return;
  const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
  if (!drag.moved && Math.hypot(dx, dy) < 4) return;
  drag.moved = true;
  offsetX = drag.dx + dx; offsetY = drag.dy + dy;
  draw();
});
canvas.addEventListener("pointerup", event => {
  if (drag?.id !== event.pointerId) return;
  if (!drag.moved) {
    const { x, y } = position(event);
    let nearest, distance = 10;
    for (const point of points) {
      const candidate = Math.hypot(x - point.x, y - point.y);
      if (candidate < distance) { nearest = point; distance = candidate; }
    }
    if (nearest) selectStation(nearest.station);
  }
  drag = null;
});
canvas.addEventListener("lostpointercapture", () => { drag = null; });
$("zoom-in").onclick = () => adjustZoom(1.4);
$("zoom-out").onclick = () => adjustZoom(1 / 1.4);
$("reset").onclick = fitRegion;
new ResizeObserver(draw).observe(canvas);

stationInput.addEventListener("change", async () => {
  const id = ++stationRevision;
  const file = stationInput.files[0];
  if (!file) return;
  usingBuiltIn = false;
  source = stationData = selected = null;
  stationError = "";
  stationLoading = Boolean(file);
  refresh();
  try {
    const csv = await EVData.read(file);
    if (id !== stationRevision) return;
    const data = EVData.loadStations(csv, regions);
    source = csv;
    stationData = data;
    limit = 60;
    const provinces = new Set(data.stations.map(s => s.province).filter(Boolean));
    const districts = new Set(data.stations.map(s => s.district).filter(Boolean));
    provinceInput.value = provinces.size === 1 ? [...provinces][0] : "";
    chooseDistricts();
    if (provinces.size === 1 && districts.size === 1 && data.stations.every(s => s.district)) {
      districtInput.value = [...districts][0];
    }
  } catch (error) {
    if (id !== stationRevision) return;
    stationError = "충전소 파일을 읽을 수 없습니다. " + error.message;
  }
  stationLoading = false;
  refresh(true);
});
tariffInput.addEventListener("change", async () => {
  const id = ++tariffRevision;
  const file = tariffInput.files[0];
  tariffData = null;
  tariffError = "";
  tariffLoading = Boolean(file);
  refresh();
  if (!file) return;
  try {
    const csv = await EVData.read(file);
    if (id !== tariffRevision) return;
    tariffData = EVData.loadTariffs(csv);
  } catch (error) {
    if (id !== tariffRevision) return;
    tariffError = "요금 파일을 읽을 수 없습니다. " + error.message;
  }
  tariffLoading = false;
  refresh();
});
provinceInput.onchange = () => { chooseDistricts(); limit = 60; refresh(true); };
districtInput.onchange = () => { limit = 60; refresh(true); };
speedInput.onchange = searchInput.oninput = () => { limit = 60; refresh(); };
more.onclick = () => { limit += 60; renderList(); };
function saveRegionCsv(header, rows, name) {
  const blob = new Blob([EVData.csvText([header, ...rows])], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const provinceName = regions.provinces.get(provinceInput.value) ?? "전국";
  const districtName = regions.districts.get(districtInput.value)?.name;
  link.href = url;
  link.download = [provinceName, districtName, name + ".csv"].filter(Boolean).join("_");
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
download.onclick = () => {
  if (!source) return;
  const rows = stationData.validRows.filter(item => inRegion(item.station)).map(item => item.row);
  saveRegionCsv(source.header, rows, "전기차충전소");
};
downloadTariffs.onclick = () => {
  if (!stationData) return;
  if (!tariffData) {
    const regionalRates = new Set(stationData.stations.filter(inRegion).map(station => providerRate(station.provider)).filter(Boolean));
    const rows = EVBuiltInRates.filter(rate => regionalRates.has(rate))
      .map(([provider, date, ...amounts]) => [provider, date, ...amounts.map(amount => String(amount ?? ""))]);
    saveRegionCsv(["운영기관", "요금갱신일", ...rateBands.map(band => band + " (원/kWh)")], rows, "전기차충전요금_운영사안내가");
    return;
  }
  const chargers = new Map();
  for (const station of stationData.stations) {
    if (station.id && inRegion(station)) chargers.set(station.id, new Set(station.chargers.map(item => item.id)));
  }
  const rows = tariffData.validRows.filter(item => chargers.has(item.id)
    && (!item.charger || chargers.get(item.id).has(item.charger))).map(item => item.row);
  saveRegionCsv(tariffData.header, rows, "전기차충전요금");
};
function loadBuiltIn() {
  stationRevision++;
  tariffRevision++;
  stationInput.value = tariffInput.value = "";
  stationError = tariffError = "";
  stationLoading = tariffLoading = false;
  tariffData = selected = null;
  provinceInput.value = districtInput.value = speedInput.value = searchInput.value = "";
  chooseDistricts();
  limit = 60;
  try {
    source = EVBuiltInStations;
    if (!builtInData) {
      builtInData = EVData.loadStations(source, regions);
      builtInData.stations.sort((a, b) => Number(mapped(b)) - Number(mapped(a)) || collator.compare(a.name, b.name));
    }
    stationData = builtInData;
    usingBuiltIn = true;
  } catch (error) {
    source = stationData = null;
    usingBuiltIn = false;
    stationError = "기본 충전소 자료를 읽을 수 없습니다. " + error.message;
  }
  refresh(true);
}
$("restore").onclick = loadBuiltIn;
loadBuiltIn();
