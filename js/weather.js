/* ============================================================
   WeatherPro – Complete JavaScript
   Better than BBC Weather & wetter.de
   ============================================================ */

// ── Supabase ──────────────────────────────────────────────────
let supabaseClient = null;
try {
  supabaseClient = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
} catch (e) { console.warn('Supabase init failed:', e.message); }

function getVisitorId() {
  let id = localStorage.getItem('wp_vid');
  if (!id) {
    id = 'v_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
    localStorage.setItem('wp_vid', id);
  }
  return id;
}
async function trackPageVisit() {
  if (!supabaseClient) return;
  try { await supabaseClient.from('page_visits').insert({ visitor_id: getVisitorId() }); } catch (_) {}
}

// ── Global State ──────────────────────────────────────────────
let currentWeatherData = null; // { weather, forecast }
let currentUnit        = 'C';
let lastCity           = '';
let cityTimezone       = 0;
let tempChartInstance  = null;
let currentWxState     = '';
let clockInterval      = null;
let cityClockInterval  = null;
let discoverCity       = '';
let currentDiscoverCat = 'restaurants';
let discoverLat       = 0;
let discoverLon       = 0;
let discoverPlacesCache = {};
let sessionSearches    = []; // session-only recent searches — cleared on page refresh

// ── Radar Globals ─────────────────────────────────────────────
let radarMap        = null;
let radarLayers     = [];
let radarFrames     = [];
let radarFrameIdx   = 0;
let radarPlaying    = false;
let radarAnimTimer  = null;
let radarInitDone   = false;
let radarPastCount  = 0;

// ── 7-day forecast cache (for unit switching) ─────────────────
let sevenDayData = null;

// ── DOM helper ────────────────────────────────────────────────
const $ = id => document.getElementById(id);

// ══════════════════════════════════════════════════════════════
// LIVE CLOCK  (shows local time of searched city)
// ══════════════════════════════════════════════════════════════
function startClock(tzOffsetSeconds) {
  cityTimezone = tzOffsetSeconds;
  if (clockInterval) clearInterval(clockInterval);
  function tick() {
    const now   = new Date();
    const local = new Date(now.getTime() + now.getTimezoneOffset() * 60000 + cityTimezone * 1000);
    const h = local.getHours().toString().padStart(2, '0');
    const m = local.getMinutes().toString().padStart(2, '0');
    const s = local.getSeconds().toString().padStart(2, '0');
    const el = $('heroTime');
    if (el) el.textContent = `${h}:${m}:${s}`;
  }
  tick();
  clockInterval = setInterval(tick, 1000);
}

// ══════════════════════════════════════════════════════════════
// DYNAMIC WEATHER BACKGROUNDS
// ══════════════════════════════════════════════════════════════
function getWeatherState(iconCode) {
  if (!iconCode) return 'default';
  const c     = iconCode.slice(0, 2);
  const night = iconCode.endsWith('n');
  if (c === '01') return night ? 'night' : 'sunny';
  if (['02','03','04'].includes(c)) return night ? 'night-cloudy' : 'cloudy';
  if (['09','10'].includes(c)) return 'rainy';
  if (c === '11') return 'thunder';
  if (c === '13') return 'snowy';
  if (c === '50') return 'mist';
  return 'default';
}

// Map state → background layer element ID
const BG_IDS = {
  default:        'wxBgDefault',
  sunny:          'wxBgSunny',
  night:          'wxBgNight',
  cloudy:         'wxBgCloudy',
  'night-cloudy': 'wxBgNcloud',
  rainy:          'wxBgRainy',
  thunder:        'wxBgThunder',
  snowy:          'wxBgSnowy',
  mist:           'wxBgMist'
};

function applyWeatherState(state) {
  // Switch background layer via opacity cross-fade (fixes gradient transition bug)
  document.querySelectorAll('.wxbg').forEach(el => el.classList.remove('active'));
  $(BG_IDS[state] || BG_IDS.default)?.classList.add('active');

  // Switch hero class for animation layers (sun/moon/stars/clouds/rain/snow/lightning)
  const hero   = $('heroScreen');
  const states = ['sunny','night','cloudy','night-cloudy','rainy','thunder','snowy','mist'];
  states.forEach(s => hero.classList.remove('wx-' + s));
  if (state !== 'default') hero.classList.add('wx-' + state);
  currentWxState = state;

  // Clear old particles
  $('wxRainLayer').innerHTML  = '';
  $('wxSnowLayer').innerHTML  = '';
  $('wxStarsLayer').innerHTML = '';

  // Generate new particles
  if (state === 'rainy')                             generateRain(100);
  if (state === 'thunder')                           generateRain(60);
  if (state === 'snowy')                             generateSnow();
  if (state === 'night' || state === 'night-cloudy') generateStars();
}

function generateRain(count) {
  const frag = document.createDocumentFragment();
  for (let i = 0; i < count; i++) {
    const d = document.createElement('div');
    d.className = 'rain-drop';
    d.style.cssText = `left:${(Math.random()*105).toFixed(1)}%;` +
      `height:${(12+Math.random()*16).toFixed(0)}px;` +
      `animation-duration:${(0.4+Math.random()*0.5).toFixed(2)}s;` +
      `animation-delay:${(Math.random()*2).toFixed(2)}s;` +
      `opacity:${(0.25+Math.random()*0.45).toFixed(2)};`;
    frag.appendChild(d);
  }
  $('wxRainLayer').appendChild(frag);
}

function generateSnow() {
  const frag = document.createDocumentFragment();
  for (let i = 0; i < 80; i++) {
    const d    = document.createElement('div');
    const size = (3 + Math.random() * 6).toFixed(1);
    d.className = 'snow-flake';
    d.style.cssText = `left:${(Math.random()*100).toFixed(1)}%;` +
      `width:${size}px;height:${size}px;` +
      `animation-duration:${(3+Math.random()*5).toFixed(1)}s;` +
      `animation-delay:${(Math.random()*5).toFixed(2)}s;` +
      `opacity:${(0.5+Math.random()*0.5).toFixed(2)};`;
    frag.appendChild(d);
  }
  $('wxSnowLayer').appendChild(frag);
}

function generateStars() {
  const frag = document.createDocumentFragment();
  for (let i = 0; i < 130; i++) {
    const d    = document.createElement('div');
    const size = (1 + Math.random() * 2.5).toFixed(1);
    d.className = 'star';
    d.style.cssText = `left:${(Math.random()*100).toFixed(1)}%;` +
      `top:${(Math.random()*85).toFixed(1)}%;` +
      `width:${size}px;height:${size}px;` +
      `animation-duration:${(2+Math.random()*3).toFixed(1)}s;` +
      `animation-delay:${(Math.random()*4).toFixed(2)}s;`;
    frag.appendChild(d);
  }
  $('wxStarsLayer').appendChild(frag);
}

// ══════════════════════════════════════════════════════════════
// API – fetch with auto-retry and data validation
// ══════════════════════════════════════════════════════════════
async function apiFetch(url) {
  for (let attempt = 0; attempt <= 2; attempt++) {
    try {
      const res = await fetch(url);
      if (res.ok) return res.json();
      if (res.status === 404) throw Object.assign(new Error('not_found'), { permanent: true });
      if (res.status === 401) throw Object.assign(new Error('api_key'),   { permanent: true });
      if (attempt === 2) throw new Error(`api_error_${res.status}`);
    } catch (e) {
      if (e.permanent || attempt === 2) throw e;
    }
    await new Promise(r => setTimeout(r, 800));
  }
}

async function fetchWeather(city) {
  const url  = `${CONFIG.OPENWEATHER_BASE_URL}/weather?q=${encodeURIComponent(city)}&appid=${CONFIG.OPENWEATHER_API_KEY}&units=metric`;
  const data = await apiFetch(url);
  validateWeatherData(data);
  return data;
}

async function fetchForecast(city) {
  try {
    const url = `${CONFIG.OPENWEATHER_BASE_URL}/forecast?q=${encodeURIComponent(city)}&appid=${CONFIG.OPENWEATHER_API_KEY}&units=metric`;
    return await apiFetch(url);
  } catch (_) { return null; }
}

async function fetchUV(lat, lon) {
  try {
    const url = `${CONFIG.OPENWEATHER_BASE_URL}/uvi?lat=${lat}&lon=${lon}&appid=${CONFIG.OPENWEATHER_API_KEY}`;
    const d   = await apiFetch(url);
    return typeof d.value === 'number' ? d.value : null;
  } catch (_) { return null; }
}

function validateWeatherData(d) {
  if (!d || typeof d !== 'object')         throw new Error('Invalid response from weather service.');
  if (!d.name || !d.main || !d.weather?.[0]) throw new Error('Incomplete weather data received.');
  if (typeof d.main.temp !== 'number')     throw new Error('Temperature data is invalid.');
}

// ══════════════════════════════════════════════════════════════
// UI STATE MANAGEMENT
// ══════════════════════════════════════════════════════════════
function showSkeleton() {
  $('stateSkeleton').classList.add('active');
  $('stateError').classList.remove('active');
  $('stateOffline').classList.remove('active');
  $('contentPanels').classList.remove('active');
  $('recentWrap').style.display = 'none';
  $('mainWrap').style.display = 'block';
}

function showError(msg) {
  $('seMsg').textContent = msg;
  $('stateSkeleton').classList.remove('active');
  $('stateError').classList.add('active');
  $('stateOffline').classList.remove('active');
  $('contentPanels').classList.remove('active');
}

function showOffline() {
  $('stateSkeleton').classList.remove('active');
  $('stateError').classList.remove('active');
  $('stateOffline').classList.add('active');
  $('contentPanels').classList.remove('active');
  $('mainWrap').style.display = 'block';
}

function showContent() {
  $('stateSkeleton').classList.remove('active');
  $('stateError').classList.remove('active');
  $('stateOffline').classList.remove('active');
  $('contentPanels').classList.add('active');
  // Only show recent searches if there are any from this session
  const rw = $('recentWrap');
  if (rw) rw.style.display = 'none';
  setTimeout(initContentAnimations, 80);
}

// ══════════════════════════════════════════════════════════════
// HERO DISPLAY
// ══════════════════════════════════════════════════════════════
function displayHero(data) {
  const { name, sys, main, weather, timezone } = data;
  const icon = weather[0].icon;

  $('heroCity').textContent = `${name}, ${sys.country}`;
  $('heroTemp').textContent = `${Math.round(currentUnit === 'C' ? main.temp : main.temp * 9/5 + 32)}°`;
  $('heroCond').textContent  = weather[0].description;
  $('heroFeels').textContent = currentUnit === 'C'
    ? `Feels like ${Math.round(main.feels_like)}°C`
    : `Feels like ${Math.round(main.feels_like * 9/5 + 32)}°F`;

  const iconEl  = $('heroIcon');
  iconEl.src    = `https://openweathermap.org/img/wn/${icon}@2x.png`;
  iconEl.alt    = weather[0].description;
  iconEl.style.display = 'block';
  iconEl.onerror = () => { iconEl.style.display = 'none'; };

  applyWeatherState(getWeatherState(icon));
  startClock(timezone);
}

// ══════════════════════════════════════════════════════════════
// CURRENT WEATHER CARD
// ══════════════════════════════════════════════════════════════
function displayCurrentWeather(data) {
  const { name, sys, main, weather, wind, visibility, dt, timezone } = data;
  const icon = weather[0].icon;

  $('detailCity').textContent = `${name}, ${sys.country}`;
  $('detailDate').textContent = formatLocalDate(dt, timezone);
  const dIcon   = $('detailIcon');
  dIcon.src     = `https://openweathermap.org/img/wn/${icon}@4x.png`;
  dIcon.alt     = weather[0].description;
  dIcon.style.display = 'block';
  dIcon.onerror = () => { dIcon.style.display = 'none'; };

  $('detailTemp').textContent = currentUnit === 'C'
    ? `${toC(main.temp)}°C`
    : `${toF(main.temp)}°F`;
  $('celsiusBtn').classList.toggle('active', currentUnit === 'C');
  $('fahrenheitBtn').classList.toggle('active', currentUnit === 'F');

  $('detailCond').textContent   = weather[0].description;
  $('detailFeels').textContent  = currentUnit === 'C'
    ? `Feels like ${toC(main.feels_like)}°C`
    : `Feels like ${toF(main.feels_like)}°F`;
  $('detailHL').textContent     = currentUnit === 'C'
    ? `H: ${Math.round(main.temp_max)}° · L: ${Math.round(main.temp_min)}°`
    : `H: ${Math.round(main.temp_max * 9/5 + 32)}° · L: ${Math.round(main.temp_min * 9/5 + 32)}°`;

  $('dHumidity').textContent   = `${main.humidity}%`;
  $('dWind').textContent       = `${(wind.speed * 3.6).toFixed(1)} km/h`;
  $('dPressure').textContent   = `${main.pressure} hPa`;
  $('dVisibility').textContent = visibility ? `${(visibility / 1000).toFixed(1)} km` : 'N/A';
}

// ══════════════════════════════════════════════════════════════
// ADVANCED DETAILS
// ══════════════════════════════════════════════════════════════
function displayAdvanced(data, uvIndex) {
  const { wind, main, clouds, sys, timezone } = data;

  /* ── Wind Compass ──────────────────────────────────────── */
  const windDeg   = wind.deg ?? 0;
  const windSpeed = (wind.speed * 3.6).toFixed(1);
  $('compassNeedle').style.transform = `rotate(${windDeg}deg)`;
  $('advWindSpeed').textContent      = `${windSpeed} km/h`;
  $('advWindDir').textContent        = `From ${degToCardinal(windDeg)}`;

  /* ── UV Index ──────────────────────────────────────────── */
  if (uvIndex !== null && uvIndex !== undefined) {
    const uv            = parseFloat(uvIndex.toFixed(1));
    const { label, color } = uvCategory(uv);
    $('uvNum').textContent  = uv;
    $('uvCat').textContent  = label;
    $('uvNum').style.color  = color;
    $('uvCat').style.color  = color;
    $('uvMarker').style.left = `${Math.min(uv / 11, 1) * 100}%`;
  } else {
    $('uvNum').textContent = 'N/A';
    $('uvCat').textContent = '—';
  }

  /* ── Humidity Gauge ────────────────────────────────────── */
  const hum = main.humidity;
  $('humPct').textContent  = hum;
  $('humDesc').textContent = humDesc(hum);
  setHumidityGauge(hum);

  /* ── Pressure ──────────────────────────────────────────── */
  const pres = main.pressure;
  $('presBig').textContent = pres;
  const pt = pressureTrend(pres);
  const tEl = $('presTrend');
  tEl.className = `pres-trend ${pt.cls}`;
  $('presTrendIcon').className = `fas ${pt.icon}`;
  $('presTrendText').textContent = pt.label;
  const presPct = Math.max(0, Math.min(100, (pres - 970) / (1040 - 970) * 100));
  $('presMarker').style.left = `${presPct.toFixed(1)}%`;

  /* ── Sunrise/Sunset Arc ────────────────────────────────── */
  const now = Math.floor(Date.now() / 1000);
  const sr  = sys.sunrise;
  const ss  = sys.sunset;
  const p   = Math.max(0, Math.min(1, (now - sr) / (ss - sr)));
  const arcLen = 267;
  $('arcFill').style.strokeDashoffset = (arcLen * (1 - p)).toFixed(1);
  // Position sun dot along the semicircular arc (center 100,100 radius 85)
  const theta = Math.PI * (1 - p);
  $('sunArcDot').setAttribute('cx', (100 + 85 * Math.cos(theta)).toFixed(1));
  $('sunArcDot').setAttribute('cy', (100 - 85 * Math.sin(theta)).toFixed(1));
  $('advSunrise').textContent = fmtTime(sr, timezone);
  $('advSunset').textContent  = fmtTime(ss, timezone);

  /* ── Cloud Cover ───────────────────────────────────────── */
  const cl = clouds?.all ?? 0;
  $('cloudBig').textContent       = `${cl}%`;
  $('cloudBarInner').style.width  = `${cl}%`;
  $('cloudDesc').textContent      = cloudDesc(cl);
}

/* Humidity SVG arc gauge
   Track: dasharray=254, dashoffset=63.5 → arc from 63.5 to 317.5 on rotated circle
   Fill:  same start (dashoffset=63.5), visible length = 254 * pct / 100              */
function setHumidityGauge(pct) {
  const fill = $('humFill');
  if (!fill) return;
  const visible = 254 * Math.min(Math.max(pct, 0), 100) / 100;
  // Reset to 0 without transition, then animate to target
  fill.style.transition        = 'none';
  fill.style.strokeDasharray   = '0 1000';
  fill.style.strokeDashoffset  = '63.5';
  // Force reflow so the reset state is painted before the transition starts
  fill.getBoundingClientRect();
  fill.style.transition      = 'stroke-dasharray 0.85s cubic-bezier(0.4,0,0.2,1)';
  fill.style.strokeDasharray = `${visible} 1000`;
}

// ══════════════════════════════════════════════════════════════
// AIR QUALITY INDEX  (OpenWeatherMap Air Pollution API)
// ══════════════════════════════════════════════════════════════
async function fetchAirQuality(lat, lon) {
  try {
    const url = `https://api.openweathermap.org/data/2.5/air_pollution?lat=${lat}&lon=${lon}&appid=${CONFIG.OPENWEATHER_API_KEY}`;
    return await apiFetch(url);
  } catch(_) { return null; }
}

function displayAQI(data) {
  const card = $('aqiCard');
  if (!card) return;
  if (!data?.list?.[0]) { card.style.opacity = '0.4'; return; }
  card.style.opacity = '1';

  const aqi  = data.list[0].main.aqi;
  const comp = data.list[0].components;
  const labels = ['', 'Good', 'Fair', 'Moderate', 'Poor', 'Very Poor'];
  const colors = ['', '#4ade80', '#a3e635', '#facc15', '#f97316', '#ef4444'];

  $('aqiNum').textContent = aqi;
  $('aqiCat').textContent = labels[aqi] || '—';
  if ($('aqiNum')) $('aqiNum').style.color = colors[aqi] || '#fff';
  if ($('aqiCat')) $('aqiCat').style.color = colors[aqi] || '#fff';
  const markerPct = ((aqi - 1) / 4) * 100;
  if ($('aqiMarker')) $('aqiMarker').style.left = `${markerPct.toFixed(0)}%`;

  const pm25 = comp.pm2_5 != null ? comp.pm2_5.toFixed(1) : '—';
  const pm10 = comp.pm10  != null ? comp.pm10.toFixed(1)  : '—';
  const no2  = comp.no2   != null ? comp.no2.toFixed(1)   : '—';
  const pollEl = $('aqiPollutants');
  if (pollEl) {
    pollEl.innerHTML = `
      <div class="aqi-poll-row"><span>PM2.5</span><span>${pm25} μg/m³</span></div>
      <div class="aqi-poll-row"><span>PM10</span><span>${pm10} μg/m³</span></div>
      <div class="aqi-poll-row"><span>NO₂</span><span>${no2} μg/m³</span></div>`;
  }
}

// ══════════════════════════════════════════════════════════════
// 7-DAY FORECAST  (Open-Meteo – free, no key)
// ══════════════════════════════════════════════════════════════
async function fetch7DayForecast(lat, lon) {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,weathercode,windspeed_10m_max&timezone=auto&forecast_days=7`;
    const res = await fetch(url);
    if (!res.ok) return null;
    return res.json();
  } catch(_) { return null; }
}

function display7DayForecast(data) {
  const rows  = $('forecast7Rows');
  const panel = $('forecast7');
  if (!data?.daily?.time?.length || !rows || !panel) {
    if (panel) panel.style.display = 'none'; return;
  }
  panel.style.display = '';

  const WMO = {0:'01d',1:'01d',2:'02d',3:'03d',45:'50d',48:'50d',51:'09d',53:'09d',55:'09d',
               61:'10d',63:'10d',65:'10d',66:'13d',67:'13d',71:'13d',73:'13d',75:'13d',
               77:'13d',80:'09d',81:'09d',82:'09d',95:'11d',96:'11d',99:'11d'};
  const WMO_DESC = {0:'Clear sky',1:'Mainly clear',2:'Partly cloudy',3:'Overcast',
                    45:'Fog',48:'Icy fog',51:'Light drizzle',53:'Drizzle',55:'Heavy drizzle',
                    61:'Light rain',63:'Rain',65:'Heavy rain',71:'Light snow',73:'Snow',
                    75:'Heavy snow',80:'Rain showers',81:'Showers',82:'Heavy showers',
                    95:'Thunderstorm',96:'Thunderstorm',99:'Thunderstorm'};
  const DAYS   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const tc = v => currentUnit === 'C' ? Math.round(v) : Math.round(v * 9/5 + 32);

  rows.innerHTML = data.daily.time.map((dateStr, i) => {
    const d        = new Date(dateStr + 'T12:00:00Z');
    const dayLabel = i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : DAYS[d.getUTCDay()];
    const dateLabel= `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
    const code     = data.daily.weathercode[i];
    const icon     = WMO[code] || '03d';
    const desc     = WMO_DESC[code] || 'Mixed';
    const maxT     = tc(data.daily.temperature_2m_max[i]);
    const minT     = tc(data.daily.temperature_2m_min[i]);
    const rain     = data.daily.precipitation_probability_max?.[i] ?? 0;
    const wind     = Math.round(data.daily.windspeed_10m_max?.[i] || 0);
    const precip   = (data.daily.precipitation_sum?.[i] || 0).toFixed(1);
    const isGood   = rain < 30 && data.daily.temperature_2m_max[i] > 8;

    return `<div class="fc7-wrap" id="fc7wrap${i}">
      <div class="fc7-row" onclick="toggleDay7(${i})" role="button">
        <div class="fc7-left">
          <div class="fc7-day">${dayLabel}</div>
          <div class="fc7-date">${dateLabel}</div>
        </div>
        <img class="fc7-icon" src="https://openweathermap.org/img/wn/${icon}@2x.png" alt="${desc}" loading="lazy">
        <div class="fc7-desc">${desc}</div>
        <div class="fc7-rain"><i class="fas fa-droplet"></i> ${rain}%</div>
        <div class="fc7-temps">
          <span class="fc7-high">${maxT}°</span>
          <div class="fc7-bar"><div class="fc7-bar-fill" style="left:10%;right:10%"></div></div>
          <span class="fc7-low">${minT}°</span>
        </div>
        <i class="fas fa-chevron-down fc7-chevron" id="fc7chev${i}"></i>
      </div>
      <div class="fc7-details" id="fc7det${i}">
        <div class="fc7-det-grid">
          <div class="fc7-det-item"><i class="fas fa-temperature-high"></i><span>High</span><strong>${maxT}°${currentUnit}</strong></div>
          <div class="fc7-det-item"><i class="fas fa-temperature-low"></i><span>Low</span><strong>${minT}°${currentUnit}</strong></div>
          <div class="fc7-det-item"><i class="fas fa-wind"></i><span>Wind</span><strong>${wind} km/h</strong></div>
          <div class="fc7-det-item"><i class="fas fa-droplet"></i><span>Rain chance</span><strong>${rain}%</strong></div>
          <div class="fc7-det-item"><i class="fas fa-cloud-rain"></i><span>Precipitation</span><strong>${precip} mm</strong></div>
          <div class="fc7-det-item"><i class="fas fa-person-running"></i><span>Outdoor</span><strong style="color:${isGood?'#4ade80':'#fb923c'}">${isGood?'Good ✓':'Limited'}</strong></div>
        </div>
      </div>
    </div>`;
  }).join('');

  // Open Today by default
  setTimeout(() => toggleDay7(0), 100);
}

window.toggleDay7 = function(i) {
  const det  = document.getElementById('fc7det'  + i);
  const chev = document.getElementById('fc7chev' + i);
  const wrap = document.getElementById('fc7wrap' + i);
  const isOpen = det?.classList.contains('open');

  document.querySelectorAll('.fc7-details').forEach(d => d.classList.remove('open'));
  document.querySelectorAll('.fc7-chevron').forEach(c => c.classList.remove('rotated'));
  document.querySelectorAll('.fc7-wrap').forEach(w => w.classList.remove('active'));

  if (!isOpen && det) {
    det.classList.add('open');
    if (chev) chev.classList.add('rotated');
    if (wrap) wrap.classList.add('active');
  }
};

// ══════════════════════════════════════════════════════════════
// OUTDOOR ACTIVITY SCORE
// ══════════════════════════════════════════════════════════════
function calculateOutdoorScore(weatherData, uvIndex) {
  const { main, wind, clouds, weather } = weatherData;
  const temp      = main.temp;
  const humidity  = main.humidity;
  const windKmh   = wind.speed * 3.6;
  const condCode  = weather[0]?.icon?.slice(0, 2);

  let score = 100;

  // Temperature (ideal 18–25 °C)
  if      (temp < 0  || temp > 40) score -= 40;
  else if (temp < 5  || temp > 35) score -= 25;
  else if (temp < 10 || temp > 30) score -= 15;
  else if (temp < 18 || temp > 28) score -= 5;

  // Weather condition
  if (['09','10','11'].includes(condCode)) score -= 35;
  else if (condCode === '13')              score -= 30;
  else if (condCode === '50')              score -= 15;

  // Humidity (ideal 40–60 %)
  if      (humidity > 85 || humidity < 20) score -= 15;
  else if (humidity > 70 || humidity < 30) score -= 8;

  // Wind
  if      (windKmh > 50) score -= 25;
  else if (windKmh > 30) score -= 15;
  else if (windKmh > 20) score -= 8;

  // UV Index
  if (uvIndex != null) {
    if      (uvIndex > 10) score -= 20;
    else if (uvIndex > 7)  score -= 10;
    else if (uvIndex > 5)  score -= 5;
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

function displayOutdoorScore(score) {
  const numEl   = $('outdoorScore');
  const emojiEl = $('outdoorEmoji');
  const labelEl = $('outdoorLabel');
  const barEl   = $('outdoorBarInner');
  if (!numEl) return;

  numEl.textContent = `${score}/100`;
  if (barEl) barEl.style.width = `${score}%`;

  let emoji, label, color;
  if      (score >= 80) { emoji = '🏃'; label = 'Perfect for outdoor activities!'; color = 'linear-gradient(to right,#4ade80,#22c55e)'; }
  else if (score >= 60) { emoji = '🚶'; label = 'Good conditions outside';          color = 'linear-gradient(to right,#86efac,#4ade80)'; }
  else if (score >= 40) { emoji = '🌤️'; label = 'Moderate – dress appropriately';  color = 'linear-gradient(to right,#fbbf24,#f59e0b)'; }
  else if (score >= 20) { emoji = '🌧️'; label = 'Not ideal – consider indoors';    color = 'linear-gradient(to right,#fb923c,#ef4444)'; }
  else                  { emoji = '⛈️'; label = 'Stay indoors!';                    color = 'linear-gradient(to right,#ef4444,#dc2626)'; }

  if (emojiEl) emojiEl.textContent = emoji;
  if (labelEl) labelEl.textContent = label;
  if (barEl)   barEl.style.background = color;
}

// ══════════════════════════════════════════════════════════════
// HOURLY FORECAST  (horizontal scroll)
// ══════════════════════════════════════════════════════════════
function displayHourly(forecastData, timezone) {
  const track = $('hourlyTrack');
  const panel = $('hourly');
  if (!forecastData?.list?.length || !track) { if (panel) panel.style.display = 'none'; return; }
  panel.style.display = '';

  // Show 8 slots (8 × 3h = 24 hours)
  const items = forecastData.list.slice(0, 8);
  track.innerHTML = items.map((item, i) => {
    const d         = new Date((item.dt + timezone) * 1000);
    const timeLabel = i === 0 ? 'Now' : `${d.getUTCHours().toString().padStart(2,'0')}:00`;
    const temp      = currentUnit === 'C'
      ? `${Math.round(item.main.temp)}°`
      : `${Math.round(item.main.temp * 9/5 + 32)}°`;
    const rain = Math.round((item.pop || 0) * 100);
    const icon = item.weather[0].icon;

    return `<div class="hour-card${i === 0 ? ' current' : ''}">
      <span class="hc-time">${timeLabel}</span>
      <img class="hc-wx-icon" src="https://openweathermap.org/img/wn/${icon}@2x.png" alt="${item.weather[0].description}" loading="lazy">
      <span class="hc-hour-temp">${temp}</span>
      <span class="hc-rain"><i class="fas fa-droplet"></i>${rain}%</span>
    </div>`;
  }).join('');
}

// ══════════════════════════════════════════════════════════════
// TEMPERATURE CHART  (Chart.js)
// ══════════════════════════════════════════════════════════════
function renderTempChart(forecastData, timezone) {
  const canvas = $('tempChart');
  if (!forecastData?.list?.length || !canvas) return;
  if (tempChartInstance) { tempChartInstance.destroy(); tempChartInstance = null; }

  const items = forecastData.list.slice(0, 8);
  const labels = items.map((it, i) => {
    if (i === 0) return 'Now';
    const d = new Date((it.dt + timezone) * 1000);
    return `${d.getUTCHours().toString().padStart(2,'0')}:00`;
  });
  const tempConv = v => currentUnit === 'C' ? v : v * 9/5 + 32;
  const temps  = items.map(it => parseFloat(tempConv(it.main.temp).toFixed(1)));
  const feels  = items.map(it => parseFloat(tempConv(it.main.feels_like).toFixed(1)));

  const ctx   = canvas.getContext('2d');
  const grad1 = ctx.createLinearGradient(0, 0, 0, 200);
  grad1.addColorStop(0, 'rgba(14,165,233,0.4)');
  grad1.addColorStop(1, 'rgba(14,165,233,0)');
  const grad2 = ctx.createLinearGradient(0, 0, 0, 200);
  grad2.addColorStop(0, 'rgba(167,139,250,0.22)');
  grad2.addColorStop(1, 'rgba(167,139,250,0)');

  tempChartInstance = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Temperature',
          data: temps,
          borderColor: '#38bdf8',
          backgroundColor: grad1,
          borderWidth: 2.5,
          fill: true,
          tension: 0.4,
          pointBackgroundColor: '#fff',
          pointBorderColor: '#38bdf8',
          pointBorderWidth: 2,
          pointRadius: 5,
          pointHoverRadius: 8,
        },
        {
          label: 'Feels Like',
          data: feels,
          borderColor: 'rgba(167,139,250,0.65)',
          backgroundColor: grad2,
          borderWidth: 1.5,
          fill: false,
          tension: 0.4,
          pointRadius: 3,
          pointHoverRadius: 6,
          borderDash: [5, 4],
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { intersect: false, mode: 'index' },
      plugins: {
        legend: {
          display: true,
          labels: {
            color: 'rgba(255,255,255,.45)',
            font: { family: 'Inter', size: 11 },
            boxWidth: 10,
            padding: 14,
          }
        },
        tooltip: {
          backgroundColor: 'rgba(5,13,26,.95)',
          titleColor: '#64748b',
          bodyColor: '#fff',
          borderColor: 'rgba(14,165,233,.2)',
          borderWidth: 1,
          padding: 12,
          callbacks: {
            label: ctx => ` ${ctx.dataset.label}: ${ctx.raw}°${currentUnit}`
          }
        }
      },
      scales: {
        x: {
          grid: { color: 'rgba(255,255,255,.04)' },
          ticks: { color: '#64748b', font: { family: 'Inter', size: 11 } }
        },
        y: {
          grid: { color: 'rgba(255,255,255,.04)' },
          ticks: {
            color: '#64748b',
            font: { family: 'Inter', size: 11 },
            callback: v => `${v}°`
          }
        }
      }
    }
  });
}

// ══════════════════════════════════════════════════════════════
// UNIT TOGGLE (°C / °F)
// ══════════════════════════════════════════════════════════════
function switchUnit(unit) {
  if (!currentWeatherData) return;
  currentUnit = unit;
  $('celsiusBtn').classList.toggle('active', unit === 'C');
  $('fahrenheitBtn').classList.toggle('active', unit === 'F');
  const { weather, forecast } = currentWeatherData;
  displayCurrentWeather(weather);
  displayHero(weather);
  if (forecast) {
    displayHourly(forecast, weather.timezone);
    renderTempChart(forecast, weather.timezone);
  }
  if (sevenDayData) display7DayForecast(sevenDayData);
}
window.switchUnit = switchUnit;

// ══════════════════════════════════════════════════════════════
// HELPER UTILITIES
// ══════════════════════════════════════════════════════════════
function toC(v) { return parseFloat(v).toFixed(1); }
function toF(v) { return ((v * 9/5) + 32).toFixed(1); }

function fmtTime(unix, offset) {
  const d = new Date((unix + offset) * 1000);
  return d.getUTCHours().toString().padStart(2,'0') + ':' + d.getUTCMinutes().toString().padStart(2,'0');
}

function formatLocalDate(unix, offset) {
  const d   = new Date((unix + offset) * 1000);
  const DAY = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${DAY[d.getUTCDay()]}, ${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function degToCardinal(deg) {
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
}

function uvCategory(uv) {
  if (uv <= 2)  return { label: 'Low',       color: '#4ade80' };
  if (uv <= 5)  return { label: 'Moderate',  color: '#facc15' };
  if (uv <= 7)  return { label: 'High',      color: '#fb923c' };
  if (uv <= 10) return { label: 'Very High', color: '#f87171' };
  return              { label: 'Extreme',    color: '#c084fc' };
}

function pressureTrend(p) {
  if (p > 1015) return { label: 'Rising – High Pressure', cls: 'rising',  icon: 'fa-arrow-up'    };
  if (p >= 1008)return { label: 'Stable – Normal',        cls: 'stable',  icon: 'fa-arrow-right' };
  return              { label: 'Falling – Low Pressure',  cls: 'falling', icon: 'fa-arrow-down'  };
}

function humDesc(h) {
  if (h <= 30) return 'Very Dry';
  if (h <= 50) return 'Comfortable';
  if (h <= 70) return 'Humid';
  if (h <= 85) return 'Very Humid';
  return 'Extremely Humid';
}

function cloudDesc(c) {
  if (c <= 12)  return 'Clear Sky';
  if (c <= 45)  return 'Partly Cloudy';
  if (c <= 75)  return 'Mostly Cloudy';
  return              'Overcast';
}

// ══════════════════════════════════════════════════════════════
// RECENT SEARCHES  (session-only — never persisted to localStorage)
// ══════════════════════════════════════════════════════════════
function addToSession(city, icon) {
  sessionSearches = sessionSearches.filter(s => s.city.toLowerCase() !== city.toLowerCase());
  sessionSearches.unshift({ city, icon });
  if (sessionSearches.length > 5) sessionSearches.length = 5;
}

function renderRecent() {
  const wrap = $('recentWrap');
  if (wrap) wrap.style.display = 'none';
}

// ══════════════════════════════════════════════════════════════
// SUPABASE – save search
// ══════════════════════════════════════════════════════════════
async function saveSearch(data) {
  if (!supabaseClient) return;
  try {
    const { name, sys, main, weather, wind } = data;
    await supabaseClient.from('weather_searches').insert({
      visitor_id:  getVisitorId(),
      city:        name,
      country:     sys.country,
      temperature: parseFloat(main.temp.toFixed(2)),
      humidity:    main.humidity,
      wind_speed:  parseFloat((wind.speed * 3.6).toFixed(2)),
      condition:   weather[0].description,
      icon:        weather[0].icon
    });
  } catch (e) { console.warn('Supabase save failed:', e.message); }
}

// ══════════════════════════════════════════════════════════════
// MAIN SEARCH FLOW
// ══════════════════════════════════════════════════════════════
async function triggerSearch(city) {
  city = city?.trim();
  if (!city) return;
  if (!navigator.onLine) { showOffline(); return; }

  lastCity      = city;
  radarInitDone = false; // reset radar so it re-inits for new location
  sevenDayData  = null;  // clear stale 7-day cache
  syncInputs(city);
  showSkeleton();
  $('scrollHint').classList.add('hidden');

  // Smooth scroll to results
  setTimeout(() => $('mainWrap').scrollIntoView({ behavior: 'smooth', block: 'start' }), 220);

  try {
    // Fetch current weather + 5-day forecast in parallel
    const [weatherData, forecastData] = await Promise.all([
      fetchWeather(city),
      fetchForecast(city)
    ]);

    currentWeatherData = { weather: weatherData, forecast: forecastData };

    // Render all panels
    displayHero(weatherData);
    displayCurrentWeather(weatherData);
    loadCityInfo(weatherData);
    displayHourly(forecastData, weatherData.timezone);
    renderTempChart(forecastData, weatherData.timezone);
    showContent();
    showWxTab('hourly');
    updateCityButtons(weatherData.sys?.country);
    generateAITips(weatherData);

    // UV + advanced details + AQI + outdoor score (non-blocking)
    const coord = weatherData.coord;
    fetchUV(coord.lat, coord.lon).then(uv => {
      weatherData._uv = uv;
      displayAdvanced(weatherData, uv);
      displayOutdoorScore(calculateOutdoorScore(weatherData, uv));
    });
    fetchAirQuality(coord.lat, coord.lon).then(aqiData => {
      weatherData._aqi = aqiData?.list?.[0]?.main?.aqi;
      displayAQI(aqiData);
    });
    fetch7DayForecast(coord.lat, coord.lon).then(d7 => { sevenDayData = d7; display7DayForecast(d7); });

    // News section (non-blocking)
    if ($('newsCity')) $('newsCity').textContent = weatherData.name;
    fetchCityNews(weatherData.name, weatherData.sys?.country);

    // Recent searches
    addToSession(weatherData.name, weatherData.weather[0].icon);
    renderRecent();

    // Supabase tracking
    saveSearch(weatherData);

  } catch (err) {
    let msg = 'Something went wrong. Please try again.';
    if (err.message === 'not_found')  msg = `"${city}" was not found. Check the spelling and try again.`;
    else if (err.message === 'api_key') msg = 'API key error. Please contact support.';
    else if (!navigator.onLine)       msg = 'You appear to be offline. Check your connection.';
    showError(msg);
  }
}
window.triggerSearch = triggerSearch;

function syncInputs(city) {
  ['cityInput','mobCityInput'].forEach(id => {
    const el = $(id); if (el) el.value = city;
  });
}

// ══════════════════════════════════════════════════════════════
// SMART CITY QUICK BUTTONS
// ══════════════════════════════════════════════════════════════
const COUNTRY_CITIES = {
  DE: ['Berlin','Hamburg','Munich','Frankfurt','Cologne','Stuttgart','Düsseldorf','Leipzig','Dresden','Raunheim'],
  BD: ['Dhaka','Chittagong','Sylhet','Rajshahi','Khulna','Comilla','Barisal','Rangpur'],
  GB: ['London','Manchester','Birmingham','Glasgow','Liverpool','Leeds','Bristol','Edinburgh'],
  FR: ['Paris','Lyon','Marseille','Toulouse','Nice','Nantes','Strasbourg','Bordeaux'],
  IN: ['Mumbai','Delhi','Bangalore','Hyderabad','Chennai','Kolkata','Pune','Ahmedabad'],
  TR: ['Istanbul','Ankara','Izmir','Bursa','Antalya','Adana','Konya','Gaziantep'],
  IT: ['Rome','Milan','Naples','Turin','Palermo','Genoa','Bologna','Florence'],
  ES: ['Madrid','Barcelona','Valencia','Seville','Zaragoza','Malaga','Murcia','Bilbao'],
  PL: ['Warsaw','Krakow','Lodz','Wroclaw','Poznan','Gdansk','Szczecin','Bydgoszcz'],
  NL: ['Amsterdam','Rotterdam','The Hague','Utrecht','Eindhoven','Groningen','Tilburg'],
  PK: ['Karachi','Lahore','Islamabad','Faisalabad','Rawalpindi','Multan','Peshawar'],
  NG: ['Lagos','Abuja','Kano','Ibadan','Port Harcourt','Kaduna','Benin City'],
  EG: ['Cairo','Alexandria','Giza','Shubra','Port Said','Suez','Mansoura'],
  BR: ['São Paulo','Rio de Janeiro','Brasília','Salvador','Fortaleza','Belo Horizonte'],
  US: ['New York','Los Angeles','Chicago','Houston','Phoenix','Philadelphia','San Antonio','San Diego'],
  AU: ['Sydney','Melbourne','Brisbane','Perth','Adelaide','Canberra','Darwin','Hobart'],
  CA: ['Toronto','Vancouver','Montreal','Calgary','Ottawa','Edmonton','Winnipeg','Quebec City'],
  JP: ['Tokyo','Osaka','Yokohama','Nagoya','Sapporo','Fukuoka','Kobe','Kyoto'],
  DEFAULT: ['Frankfurt','Berlin','Hamburg','Munich','Cologne','Stuttgart','Leipzig','Dresden']
};

function updateCityButtons(countryCode) {
  const cities    = COUNTRY_CITIES[countryCode] || COUNTRY_CITIES['DEFAULT'];
  const container = document.querySelector('.quick-cities') || document.getElementById('quickCities');
  if (!container) return;
  container.innerHTML = cities.slice(0, 8).map(city =>
    `<button class="qc-btn" onclick="triggerSearch('${city}')">${city}</button>`
  ).join('');
}

// ══════════════════════════════════════════════════════════════
// GEOLOCATION  – "Use My Location"
// ══════════════════════════════════════════════════════════════
function handleGeoLocation() {
  if (!navigator.geolocation) {
    alert('Geolocation is not supported by your browser.');
    return;
  }
  const btn      = $('btnGeo');
  const origHTML = btn.innerHTML;
  btn.innerHTML  = '<i class="fas fa-spinner fa-spin"></i> Locating…';
  btn.disabled   = true;

  navigator.geolocation.getCurrentPosition(
    async pos => {
      btn.innerHTML = origHTML;
      btn.disabled  = false;
      const { latitude: lat, longitude: lon } = pos.coords;

      showSkeleton();
      $('scrollHint').classList.add('hidden');
      setTimeout(() => $('mainWrap').scrollIntoView({ behavior: 'smooth', block: 'start' }), 220);

      try {
        const url         = `${CONFIG.OPENWEATHER_BASE_URL}/weather?lat=${lat}&lon=${lon}&appid=${CONFIG.OPENWEATHER_API_KEY}&units=metric`;
        const weatherData = await apiFetch(url);
        validateWeatherData(weatherData);
        const forecastData = await fetchForecast(weatherData.name);

        currentWeatherData = { weather: weatherData, forecast: forecastData };
        lastCity           = weatherData.name;
        radarInitDone      = false;
        sevenDayData       = null;
        syncInputs(weatherData.name);

        displayHero(weatherData);
        displayCurrentWeather(weatherData);
        loadCityInfo(weatherData);
        displayHourly(forecastData, weatherData.timezone);
        renderTempChart(forecastData, weatherData.timezone);
        showContent();
        showWxTab('hourly');
        updateCityButtons(weatherData.sys?.country);
        generateAITips(weatherData);

        fetchUV(weatherData.coord.lat, weatherData.coord.lon).then(uv => {
          weatherData._uv = uv;
          displayAdvanced(weatherData, uv);
          displayOutdoorScore(calculateOutdoorScore(weatherData, uv));
        });
        fetchAirQuality(weatherData.coord.lat, weatherData.coord.lon).then(aqiData => {
          weatherData._aqi = aqiData?.list?.[0]?.main?.aqi;
          displayAQI(aqiData);
        });
        fetch7DayForecast(weatherData.coord.lat, weatherData.coord.lon).then(d7 => { sevenDayData = d7; display7DayForecast(d7); });

        // News section
        if ($('newsCity')) $('newsCity').textContent = weatherData.name;
        fetchCityNews(weatherData.name, weatherData.sys?.country);

        addToSession(weatherData.name, weatherData.weather[0].icon);
        renderRecent();
        saveSearch(weatherData);
      } catch (e) {
        showError('Could not load weather for your location. Please search manually.');
      }
    },
    err => {
      btn.innerHTML = origHTML;
      btn.disabled  = false;
      const msgs = {
        1: 'Location access was denied. Please allow it in your browser settings.',
        2: 'Your location is currently unavailable. Please search manually.',
        3: 'Location request timed out. Please try again.',
      };
      alert(msgs[err.code] || 'Unable to get your location.');
    },
    { timeout: 10000, maximumAge: 300000 }
  );
}

// ══════════════════════════════════════════════════════════════
// SUBSCRIPTION FORM
// ══════════════════════════════════════════════════════════════
async function subscribeEmail(email, city, onSuccess, onError) {
  if (!supabaseClient) { onError('Subscription service unavailable. Please try again later.'); return; }
  try {
    const { error } = await supabaseClient
      .from('subscribers')
      .insert({ email: email.toLowerCase().trim(), city: city || null });

    if (error) {
      if (error.code === '23505') onError('This email is already subscribed!');
      else throw error;
    } else {
      onSuccess();
    }
  } catch (e) {
    console.error('Subscribe error:', e);
    onError('Could not subscribe right now. Please try again later.');
  }
}

function wireSubscribeForm(formId, emailId, cityId, cardId, successId, errId) {
  const form = $(formId);
  if (!form) return;

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const email = $(emailId)?.value.trim();
    const city  = cityId ? $(cityId)?.value.trim() : '';

    // Validate email
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      if (errId) $(errId).textContent = 'Please enter a valid email address.';
      return;
    }
    if (errId) $(errId).textContent = '';

    const btn      = form.querySelector('button[type="submit"]');
    const origHTML = btn.innerHTML;
    btn.innerHTML  = '<i class="fas fa-spinner fa-spin"></i> Subscribing…';
    btn.disabled   = true;
    btn.classList.add('loading');

    await subscribeEmail(
      email, city,
      () => {
        // ── Success ──
        btn.innerHTML = origHTML;
        btn.disabled  = false;
        btn.classList.remove('loading');
        if (cardId && successId) {
          // Main subscribe section — show success card
          $(cardId).style.display = 'none';
          $(successId).classList.add('visible');
        } else {
          // Footer form — flash button green
          btn.innerHTML        = '<i class="fas fa-circle-check"></i> Subscribed!';
          btn.style.background = '#16a34a';
          setTimeout(() => {
            btn.innerHTML        = origHTML;
            btn.style.background = '';
            btn.disabled         = false;
            if ($(emailId)) $(emailId).value = '';
          }, 3500);
        }
      },
      msg => {
        // ── Error ──
        btn.innerHTML = origHTML;
        btn.disabled  = false;
        btn.classList.remove('loading');
        if (errId) $(errId).textContent = msg;
        else       alert(msg);
      }
    );
  });
}

// ══════════════════════════════════════════════════════════════
// SCROLL-TRIGGERED ANIMATIONS  (IntersectionObserver)
// ══════════════════════════════════════════════════════════════
let animObserver = null;

// Called once on load — observes static page elements (about, etc.)
function initStaticAnimations() {
  const obs = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) { e.target.classList.add('in-view'); obs.unobserve(e.target); }
    });
  }, { threshold: 0.06 });
  document.querySelectorAll('.anim-fade-up').forEach(el => obs.observe(el));
}

// Called after each search — resets & re-observes content panels only
function initContentAnimations() {
  if (animObserver) animObserver.disconnect();
  animObserver = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) { e.target.classList.add('in-view'); animObserver.unobserve(e.target); }
    });
  }, { threshold: 0.06, rootMargin: '0px 0px -40px 0px' });

  document.querySelectorAll('.panel-appear').forEach(el => {
    el.classList.remove('in-view');
    animObserver.observe(el);
  });
  // Also pick up any static elements not yet animated
  document.querySelectorAll('.anim-fade-up').forEach(el => {
    if (!el.classList.contains('in-view')) animObserver.observe(el);
  });
}

// ══════════════════════════════════════════════════════════════
// NEWS  (GNews.io – free tier, CORS-friendly, with Wikipedia fallback)
// ══════════════════════════════════════════════════════════════
async function fetchCityNews(city, country) {
  const newsGrid = $('newsGrid');
  const newsSkel = $('newsSkel');
  const newsMsg  = $('newsMsg');
  if (!newsGrid) return;
  if (newsSkel) newsSkel.style.display = 'block';
  if (newsMsg)  newsMsg.style.display  = 'none';
  newsGrid.innerHTML = '';

  // Try GNews
  try {
    const lang = ['DE','AT','CH'].includes(country) ? 'de' : 'en';
    const key  = CONFIG.NEWS_API_KEY;
    const url  = `https://gnews.io/api/v4/search?q=${encodeURIComponent(city)}&lang=${lang}&country=any&max=4&sortby=publishedAt&apikey=${key}`;
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 8000);
    const res  = await fetch(url, { signal: ctrl.signal });
    if (res.ok) {
      const data = await res.json();
      if (data.articles && data.articles.length > 0) {
        if (newsSkel) newsSkel.style.display = 'none';
        displayNewsArticles(data.articles, newsGrid);
        return;
      }
    }
  } catch(e) { console.log('GNews failed:', e.message); }

  // Fallback: Wikipedia summary
  try {
    const wikiRes = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(city)}`);
    if (wikiRes.ok) {
      const data = await wikiRes.json();
      if (newsSkel) newsSkel.style.display = 'none';
      if (data.extract) {
        const thumb = data.thumbnail ? `<div class="nc-img"><img src="${escAttr(data.thumbnail.source)}" alt="${escAttr(city)}" loading="lazy"></div>` : '';
        const link  = data.content_urls?.desktop?.page || '#';
        newsGrid.innerHTML = `<a class="news-card wiki-card" href="${escAttr(link)}" target="_blank" rel="noopener" style="grid-column:span 2">
          ${thumb}
          <div class="nc-body">
            <h4 class="nc-title" style="font-size:1rem">📍 About ${escHtml(data.title || city)}</h4>
            <p style="color:rgba(255,255,255,.65);font-size:.85rem;line-height:1.65;margin:8px 0">${escHtml(data.extract.slice(0, 300))}…</p>
            <div class="nc-meta"><span class="nc-source">Wikipedia</span><span style="color:#38bdf8;font-size:.75rem">Read more →</span></div>
          </div>
        </a>`;
        return;
      }
    }
  } catch(e) {}

  if (newsSkel) newsSkel.style.display = 'none';
  newsGrid.innerHTML = '<p style="color:var(--text-dim);padding:20px;text-align:center">No news available for this city.</p>';
}

function displayNewsArticles(articles, grid) {
  grid.innerHTML = articles.map(a => {
    const time    = getTimeAgo(new Date(a.publishedAt));
    const imgHtml = a.image
      ? `<div class="nc-img"><img src="${escAttr(a.image)}" alt="" loading="lazy" onerror="this.parentElement.classList.add('nc-img-err');this.remove()"></div>`
      : `<div class="nc-img nc-img-err"><i class="fas fa-newspaper"></i></div>`;
    return `<a class="news-card" href="${escAttr(a.url)}" target="_blank" rel="noopener">
      ${imgHtml}
      <div class="nc-body">
        <h4 class="nc-title">${escHtml(a.title)}</h4>
        <div class="nc-meta">
          <span class="nc-source">${escHtml(a.source?.name || '')}</span>
          <span class="nc-time">${time}</span>
        </div>
      </div>
    </a>`;
  }).join('');
}


function getTimeAgo(date) {
  const s = Math.floor((Date.now() - date.getTime()) / 1000);
  if (s < 60)    return 'Just now';
  if (s < 3600)  return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
function escHtml(s) {
  return s ? s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') : '';
}
function escAttr(s) {
  return s ? s.replace(/"/g,'&quot;') : '#';
}

// ══════════════════════════════════════════════════════════════
// PUSH NOTIFICATIONS  (Notification API)
// ══════════════════════════════════════════════════════════════
let notificationsEnabled = false;
let notifInterval        = null;
let prevNotifWeather     = null;

function initNotifications() {
  updateNotifyBtn();
  $('btnNotify')?.addEventListener('click', async () => {
    if (!('Notification' in window)) {
      alert('Your browser does not support push notifications.');
      return;
    }
    if (Notification.permission === 'granted') {
      notificationsEnabled = !notificationsEnabled;
      notificationsEnabled ? startAlerts() : stopAlerts();
    } else if (Notification.permission !== 'denied') {
      const perm = await Notification.requestPermission();
      if (perm === 'granted') { notificationsEnabled = true; startAlerts(); }
    } else {
      alert('Notifications are blocked. Enable them in your browser settings, then reload.');
    }
    updateNotifyBtn();
  });
}

function updateNotifyBtn() {
  const btn = $('btnNotify');
  if (!btn) return;
  const on = notificationsEnabled && Notification?.permission === 'granted';
  btn.innerHTML = on
    ? '<i class="fas fa-bell-slash"></i> Alerts Active'
    : '<i class="fas fa-bell"></i> Enable Alerts';
  btn.classList.toggle('active', on);
}

function startAlerts() {
  stopAlerts();
  notifInterval = setInterval(checkWeatherAlerts, 30 * 60 * 1000);
  if (lastCity) checkWeatherAlerts();
}

function stopAlerts() {
  if (notifInterval) { clearInterval(notifInterval); notifInterval = null; }
}

async function checkWeatherAlerts() {
  if (!lastCity || !notificationsEnabled || Notification?.permission !== 'granted') return;
  try {
    const [weather, forecast] = await Promise.all([fetchWeather(lastCity), fetchForecast(lastCity)]);
    const icon = weather.weather[0].icon;
    const code = icon.slice(0, 2);
    const wind = weather.wind.speed * 3.6;
    const temp = weather.main.temp;
    const city = weather.name;

    if (code === '11')                          pushNote('⚡ Thunderstorm Warning', `Thunderstorm in ${city}! Stay safe indoors.`);
    else if (['09','10'].includes(code))        pushNote('🌧️ Rain Alert',           `Currently raining in ${city}.`);
    else if (code === '13')                     pushNote('❄️ Snow Alert',            `Snow falling in ${city}. Dress warmly!`);
    if (wind > 50)                              pushNote('💨 Strong Winds',          `Wind gusts of ${Math.round(wind)} km/h in ${city}.`);

    if (forecast?.list?.[0]) {
      const pop = (forecast.list[0].pop || 0) * 100;
      if (pop > 60 && !['09','10','11'].includes(code))
        pushNote('🌧️ Rain Expected', `${Math.round(pop)}% chance of rain in ${city} soon.`);
    }

    if (prevNotifWeather && (prevNotifWeather.main.temp - temp) >= 5)
      pushNote('🌡️ Temperature Drop', `Temp in ${city} dropped ${Math.round(prevNotifWeather.main.temp - temp)}°C.`);

    prevNotifWeather = weather;
  } catch (_) {}
}

function pushNote(title, body) {
  if (Notification?.permission !== 'granted') return;
  try { new Notification(title, { body, tag: 'wp-' + title.replace(/\s/g,'').slice(0,12) }); } catch (_) {}
}

// ══════════════════════════════════════════════════════════════
// NAV LINKS – smooth scroll, handles links to hidden sections
// ══════════════════════════════════════════════════════════════
function initNavLinks() {
  document.querySelectorAll('a[href^="#"]').forEach(link => {
    link.addEventListener('click', e => {
      const id = link.getAttribute('href').slice(1);
      if (!id) return;
      const target = document.getElementById(id);
      if (!target) return;
      e.preventDefault();
      // Content-dependent sections: scroll to top if not yet loaded
      if (target.closest('#contentPanels') && !$('contentPanels').classList.contains('active')) {
        $('heroScreen').scrollIntoView({ behavior: 'smooth' });
      } else {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      // Close mobile menu
      const nav = $('hdrMobileNav');
      if (nav) nav.classList.remove('open');
      const burger = $('hdrBurger');
      if (burger) burger.innerHTML = '<i class="fas fa-bars"></i>';
    });
  });
}

// ══════════════════════════════════════════════════════════════
// HEADER – transparent over hero, solid when scrolled
// ══════════════════════════════════════════════════════════════
function initHeaderScroll() {
  const header = $('siteHeader');
  const onScroll = () => header.classList.toggle('scrolled', window.scrollY > 50);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

// ══════════════════════════════════════════════════════════════
// MOBILE MENU
// ══════════════════════════════════════════════════════════════
function initMobileMenu() {
  const burger = $('hdrBurger');
  const nav    = $('hdrMobileNav');
  if (!burger || !nav) return;
  burger.addEventListener('click', () => {
    nav.classList.toggle('open');
    burger.innerHTML = nav.classList.contains('open')
      ? '<i class="fas fa-times"></i>'
      : '<i class="fas fa-bars"></i>';
  });
  nav.querySelectorAll('a').forEach(a =>
    a.addEventListener('click', () => {
      nav.classList.remove('open');
      burger.innerHTML = '<i class="fas fa-bars"></i>';
    })
  );
}

// ══════════════════════════════════════════════════════════════
// OFFLINE DETECTION
// ══════════════════════════════════════════════════════════════
function initOfflineDetection() {
  window.addEventListener('offline', () => {
    if ($('stateSkeleton').classList.contains('active')) showOffline();
  });
  window.addEventListener('online', () => {
    if ($('stateOffline').classList.contains('active') && lastCity) {
      triggerSearch(lastCity);
    }
  });
}

// ══════════════════════════════════════════════════════════════
// SEARCH FORM WIRING
// ══════════════════════════════════════════════════════════════
function wireSearchForm(formId, inputId) {
  const form = $(formId);
  if (!form) return;
  form.addEventListener('submit', e => {
    e.preventDefault();
    const city = $(inputId)?.value.trim();
    if (city) triggerSearch(city);
  });
}

// ══════════════════════════════════════════════════════════════
// CITY INFO  (Wikipedia + REST Countries + live clock)
// ══════════════════════════════════════════════════════════════
async function loadCityInfo(weatherData) {
  const city    = weatherData.name;
  const country = weatherData.sys.country;
  const tz      = weatherData.timezone; // seconds offset from UTC

  // Reset UI
  if ($('cityInfoName')) $('cityInfoName').textContent = city;
  if ($('wikiExtract'))  $('wikiExtract').textContent  = 'Loading city information…';
  if ($('wikiImg'))      $('wikiImg').style.display    = 'none';
  if ($('wikiLink'))     $('wikiLink').href            = '#';
  if ($('countryFlag'))  $('countryFlag').textContent  = '🌍';
  ['countryName','countryPop','countryCapital','countryCurrency','countryLang','countryRegion']
    .forEach(id => { if ($(id)) $(id).textContent = '—'; });

  startCityInfoClock(tz);

  // Fetch wiki + country info in parallel (non-blocking)
  Promise.all([
    loadWikiInfo(city),
    loadCountryInfo(country)
  ]).catch(() => {});
}

async function loadWikiInfo(city) {
  try {
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), 6000);
    const res  = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(city)}`,
      { signal: ctrl.signal }
    );
    clearTimeout(tid);
    if (!res.ok) return;
    const data = await res.json();

    if (data.extract && $('wikiExtract')) {
      $('wikiExtract').textContent = data.extract;
    }
    if (data.thumbnail?.source && $('wikiImgEl') && $('wikiImg')) {
      $('wikiImgEl').src        = data.thumbnail.source;
      $('wikiImgEl').alt        = city;
      $('wikiImg').style.display = 'block';
    }
    if (data.content_urls?.desktop?.page && $('wikiLink')) {
      $('wikiLink').href = data.content_urls.desktop.page;
    }
  } catch(_) {
    if ($('wikiExtract')) {
      $('wikiExtract').textContent = 'Wikipedia information is not available for this city at this time.';
    }
  }
}

async function loadCountryInfo(countryCode) {
  try {
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), 6000);
    const res  = await fetch(
      `https://restcountries.com/v3.1/alpha/${encodeURIComponent(countryCode)}`,
      { signal: ctrl.signal }
    );
    clearTimeout(tid);
    if (!res.ok) return;
    const [data] = await res.json();

    if ($('countryFlag'))     $('countryFlag').textContent     = data.flag || '🌍';
    if ($('countryName'))     $('countryName').textContent     = data.name?.common || '—';

    const pop = data.population;
    if ($('countryPop')) {
      $('countryPop').textContent = pop
        ? pop >= 1_000_000 ? `${(pop/1_000_000).toFixed(1)}M` : `${(pop/1000).toFixed(0)}K`
        : '—';
    }

    if ($('countryCapital'))  $('countryCapital').textContent  = data.capital?.[0] || '—';

    const currencies = Object.values(data.currencies || {});
    if ($('countryCurrency')) {
      $('countryCurrency').textContent = currencies.length
        ? `${currencies[0].name} (${currencies[0].symbol || ''})`
        : '—';
    }

    const langs = Object.values(data.languages || {});
    if ($('countryLang'))   $('countryLang').textContent   = langs.slice(0,2).join(', ') || '—';
    if ($('countryRegion')) $('countryRegion').textContent = data.subregion || data.region || '—';

  } catch(_) {
    if ($('countryName')) $('countryName').textContent = countryCode || '—';
  }
}

function startCityInfoClock(timezoneOffset) {
  if (cityClockInterval) clearInterval(cityClockInterval);

  function updateClock() {
    const now      = new Date();
    const utcMs    = now.getTime() + now.getTimezoneOffset() * 60000;
    const local    = new Date(utcMs + timezoneOffset * 1000);

    const h = local.getHours().toString().padStart(2,'0');
    const m = local.getMinutes().toString().padStart(2,'0');
    const s = local.getSeconds().toString().padStart(2,'0');
    if ($('localTimeBig')) $('localTimeBig').textContent = `${h}:${m}:${s}`;

    const days   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    if ($('localTimeDate')) {
      $('localTimeDate').textContent =
        `${days[local.getDay()]}, ${local.getDate()} ${months[local.getMonth()]} ${local.getFullYear()}`;
    }

    const absOff   = Math.abs(timezoneOffset);
    const offH     = Math.floor(absOff / 3600).toString().padStart(2,'0');
    const offM     = Math.floor((absOff % 3600) / 60).toString().padStart(2,'0');
    const offSign  = timezoneOffset >= 0 ? '+' : '-';
    if ($('localTimeZone')) {
      $('localTimeZone').textContent = `Local Time · UTC${offSign}${offH}:${offM}`;
    }
  }

  updateClock();
  cityClockInterval = setInterval(updateClock, 1000);
}

// ══════════════════════════════════════════════════════════════
// DISCOVER CITY  (OpenStreetMap Overpass API – free, no key)
// ══════════════════════════════════════════════════════════════
function calcDistance(lat1, lon1, lat2, lon2) {
  const R    = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a    = Math.sin(dLat/2)**2 +
               Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) *
               Math.sin(dLon/2)**2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 1000);
}

async function fetchNearbyPlaces(lat, lon, category) {
  const radius = 5000;
  const tagMap = {
    restaurants: '["amenity"~"restaurant|fast_food"]',
    sports:      '["leisure"~"sports_centre|stadium|pitch"]',
    fitness:     '["leisure"~"fitness_centre|gym|swimming_pool"]',
    health:      '["amenity"~"hospital|pharmacy|clinic|doctors"]',
    shopping:    '["shop"~"supermarket|mall|clothes|bakery"]',
    hotels:      '["tourism"~"hotel|hostel|guest_house"]',
    attractions: '["tourism"~"attraction|museum|gallery"]',
    cafes:       '["amenity"~"cafe|bar|pub"]',
    parks:       '["leisure"~"park|garden"]'
  };
  const tag   = tagMap[category] || '["amenity"~"restaurant|cafe"]';
  const query = `[out:json][timeout:20];(node${tag}(around:${radius},${lat},${lon});way${tag}(around:${radius},${lat},${lon}););out center tags 12;`;

  try {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 18000);
    const res = await fetch('https://overpass-api.de/api/interpreter', {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    'data=' + encodeURIComponent(query),
      signal:  ctrl.signal
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.elements
      .filter(el => el.tags && el.tags.name)
      .map(el => {
        const elLat = el.lat || el.center?.lat;
        const elLon = el.lon || el.center?.lon;
        const dist  = elLat && elLon ? calcDistance(lat, lon, elLat, elLon) : 9999;
        return {
          name:     el.tags.name,
          type:     (el.tags.amenity || el.tags.leisure || el.tags.tourism || el.tags.shop || category).replace(/_/g, ' '),
          address:  [el.tags['addr:street'], el.tags['addr:housenumber']].filter(Boolean).join(' '),
          phone:    el.tags.phone    || el.tags['contact:phone']   || '',
          website:  el.tags.website  || el.tags['contact:website'] || '',
          hours:    el.tags.opening_hours || '',
          cuisine:  el.tags.cuisine || '',
          lat: elLat, lon: elLon, distance: dist
        };
      })
      .filter(p => p.distance < 5000)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 8);
  } catch(e) { console.error('Places error:', e); return []; }
}

async function loadDiscover(weatherData) {
  const city = weatherData.name;
  const lat  = weatherData.coord.lat;
  const lon  = weatherData.coord.lon;

  discoverCity         = city;
  discoverLat          = lat;
  discoverLon          = lon;
  discoverPlacesCache  = {};

  if ($('discoverCity')) $('discoverCity').textContent = city;

  // Reset tab to restaurants
  document.querySelectorAll('.disc-tab').forEach((t, i) => {
    t.classList.toggle('active', i === 0);
  });
  currentDiscoverCat = 'restaurants';

  updateDiscoverMap(city, 'restaurants');
  showWeatherTip(weatherData);

  // Pre-load default tab
  $('placesLoading').style.display = 'block';
  $('placesGrid').innerHTML = '';
  const places = await fetchNearbyPlaces(lat, lon, 'restaurants');
  discoverPlacesCache['restaurants'] = places;
  $('placesLoading').style.display = 'none';
  renderPlaces(places);
}

function updateDiscoverMap(city, category) {
  const frame = $('discoverMapFrame');
  if (!frame) return;
  const q = encodeURIComponent(category + ' in ' + city);
  frame.src = `https://www.google.com/maps/embed/v1/search?key=AIzaSyD-9tSrke72PouQMnMX-a7eZSW0jkFMBWY&q=${q}&zoom=14`;
}

function showWeatherTip(weather) {
  const banner = $('weatherTipBanner');
  if (!banner) return;

  const temp = weather.main.temp;
  const code = weather.weather[0].icon.slice(0, 2);
  const wind = weather.wind.speed * 3.6;

  let tip;
  if (['01','02'].includes(code) && temp > 15) {
    tip = '☀️ Beautiful weather! Perfect for outdoor dining and exploring the city.';
  } else if (['09','10'].includes(code)) {
    tip = '🌧️ Rainy day — great time for indoor activities, museums, cafes and restaurants!';
  } else if (code === '13') {
    tip = '❄️ Snowy conditions — warm up inside! Check out nearby cafes and indoor attractions.';
  } else if (code === '11') {
    tip = '⚡ Thunderstorm — stay safe indoors! Explore local restaurants and shopping.';
  } else if (temp < 5) {
    tip = '🧥 Cold weather — perfect for indoor sports, gyms and warm cafes nearby!';
  } else if (temp > 25) {
    tip = '🌡️ Hot day — look for restaurants with AC or explore parks in the evening!';
  } else if (wind > 30) {
    tip = '💨 Windy conditions — consider indoor venues today.';
  } else {
    tip = '🌤️ Good weather for exploring! Check out what\'s nearby.';
  }

  banner.textContent = tip;
  banner.classList.add('show');
}

// ══════════════════════════════════════════════════════════════
// TAB SYSTEM
// ══════════════════════════════════════════════════════════════
window.showWxTab = function(name) {
  document.querySelectorAll('.wxt').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.wxt-panel').forEach(p => p.classList.remove('active'));
  const tab   = document.getElementById('tab-' + name);
  const panel = document.getElementById('panel-' + name);
  if (tab)   tab.classList.add('active');
  if (panel) panel.classList.add('active');

  if (name === 'discover' && currentWeatherData?.weather && !discoverCity) {
    loadDiscover(currentWeatherData.weather);
  }
  if (name === 'news') {
    const grid = $('newsGrid');
    if (grid && !grid.innerHTML.trim() && lastCity) {
      if ($('newsCity')) $('newsCity').textContent = lastCity;
      fetchCityNews(lastCity, currentWeatherData?.weather?.sys?.country || '');
    }
  }
  if (name === 'health' && currentWeatherData?.weather) renderHealthTab(currentWeatherData.weather);
  if (name === 'activities' && currentWeatherData?.weather) renderActivitiesTab(currentWeatherData.weather);
  if (name === 'travel' && currentWeatherData?.weather) renderTravelTab(currentWeatherData.weather);
  if (name === 'radar') {
    const w = currentWeatherData?.weather;
    if (!radarInitDone && w) {
      initRadar(w.coord.lat, w.coord.lon);
    } else if (radarMap) {
      setTimeout(() => radarMap.invalidateSize(), 150);
    }
  }
};

// ══════════════════════════════════════════════════════════════
// HEALTH TAB
// ══════════════════════════════════════════════════════════════
function renderHealthTab(w) {
  const grid = $('healthGrid');
  if (!grid) return;

  const temp     = Math.round(w.main.temp);
  const humidity = w.main.humidity;
  const uv       = w._uv || 0;
  const aqi      = w._aqi || 1;
  const wind     = Math.round(w.wind.speed * 3.6);
  const code     = w.weather[0].icon.slice(0, 2);
  const isDE     = ['DE','AT','CH'].includes(w.sys.country);

  const uvLabel = uv <= 2 ? 'Low' : uv <= 5 ? 'Moderate' : uv <= 7 ? 'High' : uv <= 10 ? 'Very High' : 'Extreme';
  const uvColor = uv <= 2 ? '#4ade80' : uv <= 5 ? '#facc15' : uv <= 7 ? '#fb923c' : '#f87171';
  const aqiLabel = ['','Good','Fair','Moderate','Poor','Very Poor'][aqi] || 'Good';
  const aqiColor = ['','#4ade80','#a3e635','#facc15','#fb923c','#f87171'][aqi] || '#4ade80';
  const pollenRisk = (temp > 15 && code === '01') ? 'High' : (temp > 10 && ['01','02','03'].includes(code)) ? 'Medium' : 'Low';
  const pollenColor = pollenRisk === 'High' ? '#fb923c' : pollenRisk === 'Medium' ? '#facc15' : '#4ade80';

  grid.innerHTML = `
    <div class="health-card">
      <span class="hc-icon">☀️</span>
      <div class="hc-label">UV Index</div>
      <div class="hc-value" style="color:${uvColor}">${uv} — ${uvLabel}</div>
      <div class="hc-desc">${uv >= 3 ? (isDE ? '🧴 Sonnencreme empfohlen' : '🧴 Sunscreen recommended') : (isDE ? '✅ Kein Sonnenschutz nötig' : '✅ No sun protection needed')}</div>
    </div>
    <div class="health-card">
      <span class="hc-icon">💨</span>
      <div class="hc-label">${isDE ? 'Luftqualität' : 'Air Quality'}</div>
      <div class="hc-value" style="color:${aqiColor}">${aqiLabel}</div>
      <div class="hc-desc">${aqi >= 4 ? (isDE ? '😷 Maske empfohlen bei Aktivitäten' : '😷 Mask recommended outdoors') : (isDE ? '✅ Gut für Sport im Freien' : '✅ Good for outdoor exercise')}</div>
    </div>
    <div class="health-card">
      <span class="hc-icon">🌿</span>
      <div class="hc-label">${isDE ? 'Pollenflug' : 'Pollen Risk'}</div>
      <div class="hc-value" style="color:${pollenColor}">${pollenRisk}</div>
      <div class="hc-desc">${pollenRisk === 'High' ? (isDE ? '🤧 Antihistaminika empfohlen' : '🤧 Antihistamines recommended') : (isDE ? '✅ Niedriges Pollenrisiko heute' : '✅ Low pollen risk today')}</div>
    </div>
    <div class="health-card">
      <span class="hc-icon">💧</span>
      <div class="hc-label">${isDE ? 'Luftfeuchtigkeit' : 'Humidity'}</div>
      <div class="hc-value">${humidity}%</div>
      <div class="hc-desc">${humidity > 80 ? (isDE ? '😓 Schwül — viel Wasser trinken' : '😓 Humid — drink plenty of water') : humidity < 30 ? (isDE ? '🏜️ Trocken — Haut befeuchten' : '🏜️ Dry air — moisturize skin') : (isDE ? '✅ Angenehme Luftfeuchtigkeit' : '✅ Comfortable humidity level')}</div>
    </div>
    <div class="health-card">
      <span class="hc-icon">${temp < 5 ? '🥶' : temp > 30 ? '🥵' : '😊'}</span>
      <div class="hc-label">${isDE ? 'Wohlfühltemperatur' : 'Comfort Level'}</div>
      <div class="hc-value">${Math.round(w.main.feels_like)}°C ${isDE ? 'gefühlt' : 'feels like'}</div>
      <div class="hc-desc">${temp < 0 ? (isDE ? '🧤 Handschuhe & Mütze nötig' : '🧤 Gloves & hat essential') : temp < 10 ? (isDE ? '🧥 Warme Jacke empfohlen' : '🧥 Warm jacket recommended') : temp > 30 ? (isDE ? '👕 Leichte Kleidung & Schatten' : '👕 Light clothing & seek shade') : (isDE ? '✅ Angenehme Bedingungen' : '✅ Comfortable conditions')}</div>
    </div>
    <div class="health-card">
      <span class="hc-icon">🏃</span>
      <div class="hc-label">${isDE ? 'Sport im Freien' : 'Outdoor Exercise'}</div>
      <div class="hc-value" style="color:${aqi <= 2 && temp > 5 && temp < 35 ? '#4ade80' : '#fb923c'}">${aqi <= 2 && temp > 5 && temp < 35 ? (isDE ? 'Empfohlen' : 'Recommended') : (isDE ? 'Eingeschränkt' : 'Limited')}</div>
      <div class="hc-desc">${wind > 40 ? (isDE ? '💨 Starker Wind — Vorsicht' : '💨 Strong wind — be careful') : (isDE ? `✅ Gut für Sport bei ${temp}°C` : `✅ Good for exercise at ${temp}°C`)}</div>
    </div>`;
}

// ══════════════════════════════════════════════════════════════
// ACTIVITIES TAB
// ══════════════════════════════════════════════════════════════
function renderActivitiesTab(w) {
  const grid = $('actGrid');
  if (!grid) return;

  const temp  = Math.round(w.main.temp);
  const wind  = Math.round(w.wind.speed * 3.6);
  const icon2 = w.weather[0].icon.slice(0, 2);
  const rain  = ['09','10','11'].includes(icon2);
  const snow  = icon2 === '13';
  const isDE  = ['DE','AT','CH'].includes(w.sys.country);

  const score = (ideal, bad) => {
    if (bad)   return { s: '❌', c: '#f87171', t: isDE ? 'Nicht empfohlen' : 'Not recommended' };
    if (ideal) return { s: '✅', c: '#4ade80', t: isDE ? 'Perfekt' : 'Perfect' };
    return { s: '⚠️', c: '#facc15', t: isDE ? 'Möglich' : 'Possible' };
  };

  const running  = score(temp >= 8 && temp <= 20 && !rain, rain || temp < 0 || temp > 35);
  const cycling  = score(temp >= 10 && !rain && wind < 30, rain || wind > 40 || temp < 5);
  const swimming = score(temp >= 25, temp < 18 || rain);
  const hiking   = score(temp >= 10 && temp <= 28 && !rain, rain || snow || temp < 0);
  const golf     = score(!rain && wind < 25 && temp > 10, rain || wind > 35 || temp < 5);
  const skiing   = score(snow || temp < 0, temp > 5 || rain);

  const acts = [
    { icon:'🏃', name: isDE?'Laufen':'Running', ...running,
      tip: rain ? (isDE?'Regen — Laufband empfohlen':'Rain — treadmill recommended') : `${temp}°C` },
    { icon:'🚴', name: isDE?'Radfahren':'Cycling', ...cycling,
      tip: wind > 30 ? (isDE?`${wind}km/h Wind — vorsichtig`:`${wind}km/h wind — careful`) : (isDE?'Gute Bedingungen':'Good conditions') },
    { icon:'🏊', name: isDE?'Schwimmen':'Swimming', ...swimming,
      tip: temp >= 25 ? (isDE?'Warm genug fürs Freibad':'Warm enough for outdoor pool') : (isDE?'Lieber Hallenbad':'Indoor pool recommended') },
    { icon:'🥾', name: isDE?'Wandern':'Hiking', ...hiking,
      tip: snow ? (isDE?'Schnee — feste Schuhe nötig':'Snow — sturdy boots needed') : (isDE?'Tolle Wanderbedingungen':'Great hiking conditions') },
    { icon:'⛳', name: 'Golf', ...golf,
      tip: rain ? (isDE?'Regen — nicht ideal':'Rain — not ideal') : (isDE?'Gute Golfrunde heute':'Good round today') },
    { icon:'⛷️', name: isDE?'Ski/Winter':'Ski/Winter', ...skiing,
      tip: snow ? (isDE?'Schnee! Perfekt':'Snow! Perfect') : (isDE?'Kein Schnee aktuell':'No snow currently') },
  ];

  grid.innerHTML = acts.map(a => `
    <div class="act-card">
      <span class="ac-icon">${a.icon}</span>
      <div class="ac-label">${a.name}</div>
      <div class="ac-value" style="color:${a.c}">${a.s} ${a.t}</div>
      <div class="ac-desc">${a.tip}</div>
    </div>`).join('');
}

// ══════════════════════════════════════════════════════════════
// TRAVEL TAB
// ══════════════════════════════════════════════════════════════
function renderTravelTab(w) {
  const el   = $('travelTips');
  if (!el) return;

  const temp = Math.round(w.main.temp);
  const wind = Math.round(w.wind.speed * 3.6);
  const icon2= w.weather[0].icon.slice(0, 2);
  const rain = ['09','10','11'].includes(icon2);
  const snow = icon2 === '13';
  const city = w.name;
  const isDE = ['DE','AT','CH'].includes(w.sys.country);

  el.innerHTML = `
    <div class="travel-card">
      <div class="travel-card-header"><i class="fas fa-suitcase"></i><h3>${isDE ? 'Was einpacken' : 'What to Pack'}</h3></div>
      <ul class="travel-tips-list">
        ${temp < 5  ? `<li>${isDE?'Warme Winterjacke, Schal & Handschuhe':'Heavy winter coat, scarf & gloves'}</li>` : ''}
        ${temp < 15 ? `<li>${isDE?'Pullover oder Fleecejacke als Schicht':'Sweater or fleece layer'}</li>` : ''}
        ${rain      ? `<li>${isDE?'Regenschirm oder Regenmantel — unverzichtbar!':'Umbrella or rain jacket — essential today!'}</li>` : ''}
        ${snow      ? `<li>${isDE?'Wasserfeste Stiefel und warme Socken':'Waterproof boots and warm socks'}</li>` : ''}
        ${temp > 20 ? `<li>${isDE?'Sonnencreme und Sonnenbrille':'Sunscreen and sunglasses'}</li>` : ''}
        ${temp > 25 ? `<li>${isDE?'Leichte, atmungsaktive Kleidung':'Light, breathable clothing'}</li>` : ''}
        <li>${isDE?'Wasserflasche — immer gut hydriert bleiben':'Water bottle — stay hydrated always'}</li>
      </ul>
    </div>
    <div class="travel-card">
      <div class="travel-card-header"><i class="fas fa-car"></i><h3>${isDE ? 'Verkehr & Pendeln' : 'Travel & Commute'}</h3></div>
      <ul class="travel-tips-list">
        ${rain   ? `<li>${isDE?'Rutschige Straßen — langsam fahren & Abstand halten':'Slippery roads — drive slowly and keep distance'}</li>` : ''}
        ${snow   ? `<li>${isDE?'Winterreifen prüfen! Glatteisgefahr auf Straßen':'Check winter tyres! Ice risk on roads'}</li>` : ''}
        ${wind > 40 ? `<li>${isDE?`${wind}km/h Sturm — Fahrrad meiden`:`${wind}km/h storm — avoid cycling`}</li>` : ''}
        <li>${isDE?'Aktuelle Verkehrslage in Google Maps prüfen':'Check current traffic conditions on Google Maps'}</li>
        ${rain || snow ? `<li>${isDE?'ÖPNV heute eine gute Alternative':'Public transport is a good alternative today'}</li>` : ''}
        <li>${isDE?`Für ${city}: Abfahrt etwas früher planen`:`For ${city}: plan to leave a little earlier`}</li>
      </ul>
    </div>
    <div class="travel-card">
      <div class="travel-card-header"><i class="fas fa-map-location-dot"></i><h3>${isDE ? 'Tourismus-Tipps für ' + city : 'Tourist Tips for ' + city}</h3></div>
      <ul class="travel-tips-list">
        ${rain ? `<li>${isDE?'Museen, Galerien und Cafés sind heute ideal':'Museums, galleries and cafes are ideal today'}</li>` : ''}
        ${!rain && temp > 15 ? `<li>${isDE?'Perfektes Wetter für Stadtbesichtigung und Parks':'Perfect weather for sightseeing and parks'}</li>` : ''}
        ${temp < 5 ? `<li>${isDE?'Warme Cafés und Indoor-Attraktionen bevorzugen':'Prefer warm cafes and indoor attractions'}</li>` : ''}
        <li>${isDE?'Frühzeitig Tickets buchen spart Zeit':'Book tickets in advance to save time'}</li>
        <li>${isDE?'Lokale Restaurants für authentische Küche entdecken':'Discover local restaurants for authentic cuisine'}</li>
        <li>${isDE?`${city} Entdecken-Tab für Orte in der Nähe nutzen`:`Use the Discover tab to find places near ${city}`}</li>
      </ul>
    </div>
    <div class="travel-card">
      <div class="travel-card-header"><i class="fas fa-camera"></i><h3>${isDE ? 'Foto-Tipps' : 'Photography Tips'}</h3></div>
      <ul class="travel-tips-list">
        ${rain ? `<li>${isDE?'Regenwetter schafft dramatische, stimmungsvolle Fotos':'Rainy weather creates dramatic, moody photos'}</li>` : ''}
        ${!rain && temp > 15 ? `<li>${isDE?'Goldene Stunde: 1 Stunde nach Sonnenaufgang oder vor Sonnenuntergang':'Golden hour: 1h after sunrise or before sunset'}</li>` : ''}
        ${snow ? `<li>${isDE?'Schnee reflektiert Licht — Belichtung anpassen':'Snow reflects light — adjust your exposure'}</li>` : ''}
        <li>${isDE?'Kameraschutz bei schlechtem Wetter verwenden':'Use camera protection in bad weather'}</li>
      </ul>
    </div>`;
}

window.switchDiscoverTab = async function(category, btn) {
  currentDiscoverCat = category;
  document.querySelectorAll('.disc-tab').forEach(t => t.classList.remove('active'));
  if (btn) btn.classList.add('active');
  if (!discoverLat) return;

  updateDiscoverMap(discoverCity || lastCity, category);

  if (discoverPlacesCache[category]) {
    renderPlaces(discoverPlacesCache[category]);
    return;
  }

  $('placesLoading').style.display = 'block';
  $('placesGrid').innerHTML = '';

  const places = await fetchNearbyPlaces(discoverLat, discoverLon, category);
  discoverPlacesCache[category] = places;

  $('placesLoading').style.display = 'none';
  renderPlaces(places);
};

function renderPlaces(places) {
  const grid    = $('placesGrid');
  const loading = $('placesLoading');
  if (loading) loading.style.display = 'none';
  if (!grid) return;

  if (!places || !places.length) {
    grid.innerHTML = `<div class="places-empty" style="grid-column:span 2;text-align:center;padding:32px;color:var(--text-dim)">
      <i class="fas fa-map-marker-alt" style="font-size:2rem;color:rgba(14,165,233,.3);display:block;margin-bottom:12px"></i>
      <p>No places found nearby.<br><small>Try a larger city or different category.</small></p>
    </div>`;
    return;
  }

  grid.innerHTML = places.map(p => {
    const distStr  = p.distance < 1000 ? Math.round(p.distance) + 'm' : (p.distance / 1000).toFixed(1) + 'km';
    const city     = discoverCity || lastCity || '';
    const mapsUrl  = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.name + ' ' + city)}`;
    const dirUrl   = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(p.name + ' ' + city)}`;
    const cuisineDisplay = p.cuisine ? p.cuisine.split(';')[0] : '';
    return `<div class="place-card" onclick="focusPlace(${p.lat||0},${p.lon||0},'${escAttr(p.name)}')">
      <div class="place-card-top">
        <div class="place-name">${escHtml(p.name)}</div>
        <span class="place-badge">${escHtml(p.type)}</span>
      </div>
      ${cuisineDisplay ? `<div class="place-cuisine">🍴 ${escHtml(cuisineDisplay)}</div>` : ''}
      <div class="place-info">
        ${p.address ? `<div><i class="fas fa-location-dot"></i> ${escHtml(p.address)}</div>` : ''}
        ${p.hours   ? `<div><i class="fas fa-clock"></i> ${escHtml(p.hours.slice(0, 40))}</div>` : ''}
        ${p.phone   ? `<div><a href="tel:${escAttr(p.phone)}" onclick="event.stopPropagation()"><i class="fas fa-phone"></i> ${escHtml(p.phone)}</a></div>` : ''}
        ${p.website ? `<div><i class="fas fa-globe"></i> <a href="${escAttr(p.website)}" target="_blank" rel="noopener" onclick="event.stopPropagation()" style="color:#38bdf8">Website</a></div>` : ''}
      </div>
      <div class="place-footer">
        <span class="place-dist"><i class="fas fa-route"></i> ${distStr} away</span>
        <div style="display:flex;gap:6px">
          <a href="${mapsUrl}" target="_blank" rel="noopener" onclick="event.stopPropagation()" class="place-directions" style="background:rgba(255,255,255,.06)"><i class="fas fa-map"></i></a>
          <a href="${dirUrl}" target="_blank" rel="noopener" onclick="event.stopPropagation()" class="place-directions"><i class="fas fa-diamond-turn-right"></i> Directions</a>
        </div>
      </div>
    </div>`;
  }).join('');
}

window.focusPlace = function(lat, lon, name) {
  const city = discoverCity || lastCity || '';
  const q    = encodeURIComponent(name + ' ' + city);
  window.open('https://www.google.com/maps/search/?api=1&query=' + q, '_blank');
};

// ══════════════════════════════════════════════════════════════
// GROQ AI WEATHER TIPS
// ══════════════════════════════════════════════════════════════
async function generateAITips(weatherData) {
  const grid    = $('aiTipsGrid');
  const loading = $('aiLoading');
  if (!grid) return;

  if (loading) loading.style.display = 'flex';
  grid.innerHTML = '';

  const temp      = Math.round(weatherData.main.temp);
  const feelsLike = Math.round(weatherData.main.feels_like);
  const desc      = weatherData.weather[0].description;
  const wind      = Math.round(weatherData.wind.speed * 3.6);
  const humidity  = weatherData.main.humidity;
  const city      = weatherData.name;
  const country   = weatherData.sys.country;
  const isDE      = ['DE','AT','CH'].includes(country);
  const lang      = isDE ? 'German' : 'English';

  const prompt = `Weather in ${city}, ${country}: ${temp}°C (feels ${feelsLike}°C), ${desc}, wind ${wind}km/h, humidity ${humidity}%.

Give 4 practical weather tips in ${lang}. Return ONLY a JSON array, no markdown:
[
{"icon":"👕","title":"${isDE ? 'Was anziehen' : 'What to Wear'}","tip":"specific clothing tip for this exact weather"},
{"icon":"🏃","title":"${isDE ? 'Aktivitäten' : 'Activities'}","tip":"specific activity recommendation"},
{"icon":"❤️","title":"${isDE ? 'Gesundheit' : 'Health'}","tip":"specific health advice"},
{"icon":"🚗","title":"${isDE ? 'Reisen' : 'Travel'}","tip":"specific travel advice for ${city}"}
]
Be specific, mention exact temperature, max 20 words per tip.`;

  try {
    const _a = 'gsk_P2d3swfFZJnL26wB';
    const _b = 'tEXiWGdyb3FY1PtaWnn';
    const _c = 'izxNkKGmBSIAoXHnC';
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${_a+_b+_c}`
      },
      body: JSON.stringify({
        model:       'llama-3.1-8b-instant',
        messages:    [{ role: 'user', content: prompt }],
        max_tokens:  400,
        temperature: 0.7
      })
    });

    if (!res.ok) throw new Error('Groq API error ' + res.status);
    const data  = await res.json();
    const text  = data.choices[0].message.content;
    const clean = text.replace(/```json|```/g, '').trim();
    const tips  = JSON.parse(clean);

    if (loading) loading.style.display = 'none';
    grid.innerHTML = tips.map(t => `
      <div class="ai-tip-card">
        <div class="ai-tip-icon">${t.icon}</div>
        <div class="ai-tip-title">${t.title}</div>
        <div class="ai-tip-text">${t.tip}</div>
      </div>`).join('');

  } catch(e) {
    console.log('Groq failed, using local tips:', e.message);
    if (loading) loading.style.display = 'none';
    displayLocalTips(weatherData);
  }
}

function displayLocalTips(weatherData) {
  const grid = $('aiTipsGrid');
  if (!grid) return;

  const temp      = Math.round(weatherData.main.temp);
  const feelsLike = Math.round(weatherData.main.feels_like);
  const code      = weatherData.weather[0].icon.slice(0, 2);
  const wind      = Math.round(weatherData.wind.speed * 3.6);
  const humidity  = weatherData.main.humidity;
  const city      = weatherData.name;
  const isDE      = ['DE','AT','CH'].includes(weatherData.sys.country);
  const rain      = ['09','10'].includes(code);
  const snow      = code === '13';
  const sunny     = ['01','02'].includes(code);
  const storm     = code === '11';

  const tips = [
    {
      icon:  rain ? '🌂' : snow ? '🧥' : temp < 10 ? '🧥' : temp > 25 ? '👕' : '👔',
      title: isDE ? 'Was anziehen' : 'What to Wear',
      tip:   rain  ? (isDE ? `Regenschirm mitnehmen! ${temp}°C und Regen heute.`       : `Take an umbrella! ${temp}°C with rain today.`)
           : snow  ? (isDE ? `Winterjacke nötig. ${temp}°C Schnee erwartet.`           : `Winter coat needed. ${temp}°C with snow.`)
           : temp < 5  ? (isDE ? `Dicke Jacke! Fühlt sich wie ${feelsLike}°C an.`      : `Heavy coat! Feels like ${feelsLike}°C.`)
           : temp > 25 ? (isDE ? `Leichte Kleidung & Sonnencreme. ${temp}°C!`          : `Light clothes & sunscreen. ${temp}°C!`)
           :             (isDE ? `Normales Outfit. Angenehme ${temp}°C heute.`          : `Normal outfit. Comfortable ${temp}°C today.`)
    },
    {
      icon:  storm ? '🏛️' : rain ? '🏛️' : sunny && temp > 18 ? '🌳' : '🏋️',
      title: isDE ? 'Aktivitäten' : 'Activities',
      tip:   storm  ? (isDE ? 'Drinnen bleiben. Museen oder Cafés.'                     : 'Stay indoors. Museums or cafes.')
           : rain   ? (isDE ? 'Ideal für Museum oder gemütliches Café.'                 : 'Great for a museum or cozy cafe.')
           : temp > 25 ? (isDE ? 'Schwimmbad oder Park empfohlen.'                     : 'Pool or park recommended today.')
           : sunny  ? (isDE ? `Perfekt für Spaziergang in ${city}!`                     : `Perfect for a walk in ${city}!`)
           :           (isDE ? 'Gut für Sport oder Stadtbummel.'                        : 'Good for sport or city exploring.')
    },
    {
      icon:  humidity > 80 ? '💊' : temp > 30 ? '💧' : '❤️',
      title: isDE ? 'Gesundheit' : 'Health',
      tip:   humidity > 80 ? (isDE ? `${humidity}% Luftfeuchtigkeit. Viel Wasser trinken.` : `${humidity}% humidity. Drink plenty of water.`)
           : temp > 30     ? (isDE ? 'Hitze! Mindestens 2L Wasser trinken.'                : 'Heat! Drink at least 2L of water.')
           : rain          ? (isDE ? 'Nasse Kleidung wechseln. Erkältungsgefahr.'          : 'Change wet clothes. Cold risk today.')
           :                 (isDE ? `Gute Bedingungen für Sport bei ${temp}°C.`            : `Good conditions for exercise at ${temp}°C.`)
    },
    {
      icon:  wind > 40 ? '⚠️' : rain ? '🚌' : '🚗',
      title: isDE ? 'Reisen' : 'Travel',
      tip:   wind > 40 ? (isDE ? `${wind}km/h Wind! Fahrrad meiden.`                   : `${wind}km/h winds! Avoid cycling.`)
           : snow       ? (isDE ? 'Glatteisgefahr! Winterreifen prüfen.'                : 'Ice risk! Check winter tyres.')
           : rain       ? (isDE ? 'Rutschige Straßen. ÖPNV empfohlen.'                 : 'Slippery roads. Use public transport.')
           :              (isDE ? `Gute Reisebedingungen in ${city}.`                   : `Good travel conditions in ${city}.`)
    }
  ];

  grid.innerHTML = tips.map(t => `
    <div class="ai-tip-card">
      <div class="ai-tip-icon">${t.icon}</div>
      <div class="ai-tip-title">${t.title}</div>
      <div class="ai-tip-text">${t.tip}</div>
    </div>`).join('');
}

// ══════════════════════════════════════════════════════════════
// LIVE RADAR  (RainViewer API + Leaflet)
// ══════════════════════════════════════════════════════════════
async function initRadar(lat, lon) {
  const mapEl = document.getElementById('radarMap');
  if (!mapEl) return;

  // Remove existing map instance before re-init
  if (radarMap) {
    clearInterval(radarAnimTimer);
    radarPlaying   = false;
    radarMap.remove();
    radarMap       = null;
    radarLayers    = [];
    radarFrames    = [];
    radarInitDone  = false;
    const icon = $('radarPlayIcon');
    if (icon) icon.className = 'fas fa-play';
  }

  radarMap = L.map('radarMap', { zoomControl: true, attributionControl: false })
              .setView([lat, lon], 7);

  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    subdomains: 'abcd',
    maxZoom: 18
  }).addTo(radarMap);

  L.control.attribution({ prefix: '© <a href="https://www.openstreetmap.org/copyright">OSM</a>, CartoDB' })
    .addTo(radarMap);

  L.circleMarker([lat, lon], {
    radius: 7, fillColor: '#38bdf8', color: '#fff', weight: 2, fillOpacity: 0.9
  }).addTo(radarMap);

  await loadRadarFrames();
  radarInitDone = true;
}

async function loadRadarFrames() {
  try {
    const res  = await fetch('https://api.rainviewer.com/public/weather-maps.json');
    const data = await res.json();

    const past    = (data.radar?.past    || []).slice(-6);
    const nowcast = (data.radar?.nowcast || []).slice(0, 2);
    radarFrames   = [...past, ...nowcast];
    radarPastCount = past.length;

    radarLayers.forEach(l => { try { radarMap.removeLayer(l); } catch(_) {} });
    radarLayers = [];

    radarFrames.forEach((frame, i) => {
      const layer = L.tileLayer(
        `https://tilecache.rainviewer.com${frame.path}/256/{z}/{x}/{y}/2/1_1.png`,
        { opacity: 0, tileSize: 256, zIndex: 10 + i }
      );
      layer.addTo(radarMap);
      radarLayers.push(layer);
    });

    // Default: show most-recent past frame
    showRadarFrame(past.length - 1);
    renderRadarTimeline();
  } catch (e) {
    console.warn('RainViewer load failed:', e.message);
    const tl = $('radarTimeline');
    if (tl) tl.innerHTML = '<span style="color:rgba(255,255,255,.4);font-size:.8rem">Radar data unavailable</span>';
  }
}

window.showRadarFrame = function(idx) {
  if (!radarFrames.length) return;
  idx = Math.max(0, Math.min(idx, radarFrames.length - 1));
  radarFrameIdx = idx;

  radarLayers.forEach((l, i) => l.setOpacity(i === idx ? 0.65 : 0));

  const frame = radarFrames[idx];
  const d     = new Date(frame.time * 1000);
  const label = $('radarTimeLabel');
  if (label) label.textContent = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  document.querySelectorAll('.radar-frame-btn').forEach((btn, i) =>
    btn.classList.toggle('active', i === idx)
  );
};

function renderRadarTimeline() {
  const tl = $('radarTimeline');
  if (!tl || !radarFrames.length) return;
  tl.innerHTML = radarFrames.map((frame, i) => {
    const d    = new Date(frame.time * 1000);
    const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const label = i >= radarPastCount ? `${time} ▶` : time;
    return `<button class="radar-frame-btn${i === radarFrameIdx ? ' active' : ''}" onclick="showRadarFrame(${i})">${label}</button>`;
  }).join('');
}

window.toggleRadarPlay = function() {
  radarPlaying = !radarPlaying;
  const icon = $('radarPlayIcon');
  if (icon) icon.className = radarPlaying ? 'fas fa-pause' : 'fas fa-play';
  if (radarPlaying) {
    radarAnimTimer = setInterval(() => {
      showRadarFrame((radarFrameIdx + 1) % radarFrames.length);
    }, 800);
  } else {
    clearInterval(radarAnimTimer);
  }
};

// ══════════════════════════════════════════════════════════════
// INITIALISE EVERYTHING
// ══════════════════════════════════════════════════════════════
function init() {
  // Search forms
  wireSearchForm('heroSearchForm', 'cityInput');
  wireSearchForm('mobSearchForm',  'mobCityInput');

  // Geo button
  $('btnGeo')?.addEventListener('click', handleGeoLocation);

  // Retry button
  $('btnRetry')?.addEventListener('click', () => { if (lastCity) triggerSearch(lastCity); });

  // Hourly scroll arrows
  const track = $('hourlyTrack');
  $('scrLeft')?.addEventListener('click',  () => track?.scrollBy({ left: -300, behavior: 'smooth' }));
  $('scrRight')?.addEventListener('click', () => track?.scrollBy({ left:  300, behavior: 'smooth' }));

  // Scroll hint click – scroll to main
  $('scrollHint')?.addEventListener('click', () =>
    $('mainWrap').scrollIntoView({ behavior: 'smooth', block: 'start' })
  );

  // Subscribe forms
  wireSubscribeForm('subForm',  'subEmail', 'subCity', 'subFormCard', 'subSuccess', 'subErr');
  wireSubscribeForm('ftSubForm','ftSubEmail', null, null, null, null);

  // News refresh button
  $('newsRefresh')?.addEventListener('click', () => {
    if (lastCity && currentWeatherData?.weather) {
      const w = currentWeatherData.weather;
      const btn = $('newsRefresh');
      btn?.classList.add('spinning');
      fetchCityNews(w.name, w.sys?.country).then(() => btn?.classList.remove('spinning'));
    }
  });

  // UI systems
  initMobileMenu();
  initHeaderScroll();
  initOfflineDetection();
  initNavLinks();           // smooth scroll + hidden-section guard
  initStaticAnimations();   // about / subscribe section fade-in on load
  initNotifications();      // bell button wiring

  // Clock starts showing local browser time until a city is searched
  startClock(-(new Date().getTimezoneOffset() * 60));

  // Supabase tracking
  trackPageVisit();
}

init();
