"use strict";
const EVData = (() => {
  const key = text => String(text ?? "").trim().toLowerCase().replace(/[\s_()\[\]·.\-]/g, "");
  const aliases = [
    ["서울", "서울특별시"], ["부산", "부산광역시"], ["대구", "대구광역시"],
    ["인천", "인천광역시"], ["광주", "광주광역시", "전남광주통합특별시", "전남광주"],
    ["대전", "대전광역시"], ["울산", "울산광역시"], ["세종", "세종시", "세종특별자치시"],
    ["경기", "경기도"], ["강원", "강원도", "강원특별자치도"], ["충북", "충청북도"],
    ["충남", "충청남도"], ["전북", "전라북도", "전북특별자치도"],
    ["전남", "전라남도", "전남광주통합특별시", "전남광주"],
    ["경북", "경상북도"], ["경남", "경상남도"], ["제주", "제주도", "제주특별자치도"]
  ];
  function parse(text) {
    const rows = [];
    let row = [], cell = "", quoted = false;
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (quoted) {
        if (char !== '"') cell += char;
        else if (text[i + 1] === '"') { cell += '"'; i++; }
        else quoted = false;
      } else if (char === '"' && !cell) quoted = true;
      else if (char === ",") { row.push(cell); cell = ""; }
      else if (char === "\n" || char === "\r") {
        row.push(cell);
        if (row.some(value => value.trim())) rows.push(row);
        row = []; cell = "";
        if (char === "\r" && text[i + 1] === "\n") i++;
      } else cell += char;
    }
    if (quoted) throw Error("닫는 따옴표가 없는 CSV입니다.");
    row.push(cell);
    if (row.some(value => value.trim())) rows.push(row);
    if (!rows.length) throw Error("CSV에 헤더가 없습니다.");
    return { header: rows.shift(), rows };
  }
  async function read(file) {
    const bytes = await file.arrayBuffer();
    let content;
    try { content = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch { content = new TextDecoder("euc-kr", { fatal: true }).decode(bytes); }
    return parse(content);
  }
  function columns(header) {
    const fields = header.map(key);
    return (...names) => {
      for (const name of names) {
        const index = fields.indexOf(key(name));
        if (index >= 0) return index;
      }
      return -1;
    };
  }
  function region(features) {
    const provinces = new Map(), districts = new Map();
    for (const { properties: p } of features) {
      provinces.set(p.sido, p.sidonm);
      const id = p.sido + "/" + p.sgg;
      if (!districts.has(id)) districts.set(id, { id, province: p.sido, name: p.sggnm });
    }
    const byProvince = new Map();
    for (const district of districts.values()) {
      if (!byProvince.has(district.province)) byProvince.set(district.province, []);
      byProvince.get(district.province).push({ ...district, normalizedName: key(district.name) });
    }
    const variants = [...provinces].map(([id, name]) => {
      const groups = aliases.filter(group => group.includes(name));
      return [id, new Set([name, ...groups.flat()])];
    });
    function match(address, provinceCode, districtCode) {
      const direct = provinceCode + "/" + districtCode;
      if (districts.has(direct)) return { province: provinceCode, district: direct };
      const words = address.trim().split(/\s+/);
      const candidates = variants.filter(([id, names]) => id === provinceCode || names.has(words[0]));
      const compact = key(words.slice(1, 3).join(""));
      const matches = candidates.flatMap(([id]) => byProvince.get(id))
        .filter(d => d.normalizedName && compact.startsWith(d.normalizedName));
      if (matches.length) {
        const max = Math.max(...matches.map(d => d.normalizedName.length));
        const best = matches.filter(d => d.normalizedName.length === max);
        if (best.length === 1) return { province: best[0].province, district: best[0].id };
      }
      if (candidates.length !== 1) return {};
      const [province] = candidates[0];
      const available = byProvince.get(province);
      return { province, district: available.length === 1 ? available[0].id : undefined };
    }
    return { provinces, districts, match };
  }
  function coordinate(value, min, max) {
    const number = Number(value);
    return value && Number.isFinite(number) && number >= min && number <= max ? number : null;
  }
  function loadStations(csv, regions) {
    const col = columns(csv.header);
    const name = col("충전소명", "시설명", "statNm", "충전소명칭", "충전소");
    const address = col("주소", "도로명주소", "소재지도로명주소", "설치위치도로명주소", "설치주소", "addr", "소재지");
    const lat = col("위도", "lat", "latitude");
    const lon = col("경도", "lng", "lon", "longitude");
    if (name < 0 || address < 0 || lat < 0 || lon < 0) throw Error("충전소 CSV에 충전소명, 주소, 위도, 경도 열이 필요합니다.");
    const id = col("충전소ID", "충전소번호", "statId");
    const chargerId = col("충전기ID", "충전기번호", "chgerId");
    const type = col("충전기타입", "충전타입", "충전기종류", "커넥터", "chgerType");
    const power = col("충전용량", "충전출력", "출력", "output", "충전용량kW");
    const provider = col("운영기관명", "운영기관", "관리기관", "busiNm");
    const hours = col("이용가능시간", "운영시간", "useTime");
    const restriction = col("이용제한", "이용자제한", "limitDetail");
    const capacityLabel = col("충전용량표기");
    const chargerCount = col("등록충전기수");
    const locationSource = col("좌표출처");
    const province = col("시도코드", "지역코드", "zcode", "sido");
    const district = col("시군구코드", "zscode", "sgg");
    const slow = col("완속충전수", "완속충전기", "완속충전");
    const fast = col("급속충전수", "급속충전기", "급속충전");
    const deleted = col("삭제여부", "delYn");
    const speedColumn = col("충전방식", "급속완속", "충전구분");
    const stations = new Map();
    let skipped = 0;
    let omitted = 0;
    const validRows = [];
    const regionCache = new Map();
    for (const row of csv.rows) {
      const at = index => row[index]?.trim() ?? "";
      if (row.length !== csv.header.length || !at(name)) { skipped++; continue; }
      if (/^(y|1|삭제)$/i.test(at(deleted))) { omitted++; continue; }
      const existingId = at(id);
      const stationKey = existingId ? "id:" + existingId : "address:" + [at(name), at(address), at(provider)].join("|");
      let station = stations.get(stationKey);
      if (!station) {
        const cacheKey = [at(address), at(province), at(district)].join("|");
        if (!regionCache.has(cacheKey)) regionCache.set(cacheKey, regions.match(at(address), at(province), at(district)));
        station = { key: stationKey, id: existingId, name: at(name), address: at(address), provider: at(provider),
          hours: at(hours), restriction: at(restriction), locationSource: at(locationSource), lat: null, lon: null,
          chargers: [], chargerKeys: new Set(), ...regionCache.get(cacheKey) };
        stations.set(stationKey, station);
      }
      const latitude = coordinate(at(lat), -90, 90), longitude = coordinate(at(lon), -180, 180);
      if (station.lat === null && latitude !== null && longitude !== null && (latitude !== 0 || longitude !== 0)) {
        station.lat = latitude; station.lon = longitude;
      }
      const speeds = new Set();
      const powerText = at(power), kw = /^\s*\d+(?:\.\d+)?\s*(?:kw)?\s*$/i.test(powerText) ? parseFloat(powerText) : null;
      const description = at(speedColumn) + " " + at(type);
      if (/급속/.test(description) || /^(y|예|있음)$/i.test(at(fast)) || Number(at(fast)) > 0) speeds.add("급속");
      if (/완속/.test(description) || /^(y|예|있음)$/i.test(at(slow)) || Number(at(slow)) > 0) speeds.add("완속");
      if (!speeds.size && kw > 0) speeds.add(kw >= 50 ? "급속" : "완속");
      if (!speeds.size) speeds.add("미분류");
      const item = { id: at(chargerId), type: at(type), speeds: [...speeds], kw, capacity: at(capacityLabel),
        count: Number(at(chargerCount)) || null };
      const chargerKey = JSON.stringify(item);
      const hasChargerDetails = item.id || item.type || item.kw || item.capacity || item.count || !speeds.has("미분류");
      if (hasChargerDetails && !station.chargerKeys.has(chargerKey)) {
        station.chargerKeys.add(chargerKey);
        station.chargers.push(item);
      }
      validRows.push({ row, station });
    }
    for (const station of stations.values()) delete station.chargerKeys;
    return { stations: [...stations.values()], validRows, skipped, omitted };
  }
  function loadTariffs(csv) {
    const col = columns(csv.header);
    const stationId = col("충전소ID", "statId");
    const unitPrice = col("충전단가", "충전요금", "단가", "원kWh", "price");
    if (stationId < 0 || unitPrice < 0) throw Error("요금 CSV에 충전소ID와 충전단가 열이 필요합니다.");
    const chargerId = col("충전기ID", "chgerId");
    const start = col("적용시작일", "적용일");
    const label = col("요금구분", "회원구분");
    const tariffs = new Map();
    const validRows = [];
    const seen = new Set();
    let skipped = 0;
    for (const row of csv.rows) {
      const at = index => row[index]?.trim() ?? "";
      const id = at(stationId);
      const value = at(unitPrice);
      const normalizedPrice = value.replace(/,/g, "");
      const price = Number(normalizedPrice);
      const date = at(start);
      const validDate = !date || (/^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date);
      if (row.length !== csv.header.length || !id || !/^\d+(?:\.\d+)?$/.test(normalizedPrice) || !Number.isFinite(price) || !validDate) { skipped++; continue; }
      const tariff = { charger: at(chargerId), price, date, label: at(label) };
      const duplicate = JSON.stringify([id, tariff]);
      if (seen.has(duplicate)) continue;
      seen.add(duplicate);
      if (!tariffs.has(id)) tariffs.set(id, []);
      tariffs.get(id).push(tariff);
      validRows.push({ id, charger: tariff.charger, row });
    }
    for (const entries of tariffs.values()) entries.sort((a, b) => b.date.localeCompare(a.date));
    return { tariffs, skipped, validRows, header: csv.header };
  }
  function csvText(rows) {
    return "\uFEFF" + rows.map(row => row.map(cell => /[",\r\n]/.test(cell) ? '"' + cell.replaceAll('"', '""') + '"' : cell).join(",")).join("\r\n") + "\r\n";
  }
  return { parse, read, region, loadStations, loadTariffs, csvText };
})();
