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
let discoverMap       = null;
let discoverMarkers   = [];
let currentDiscoverCat = 'restaurants';
let discoverLat       = 0;
let discoverLon       = 0;
let discoverPlacesCache = {};
let sessionSearches    = []; // session-only recent searches — cleared on page refresh

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
  $('recentWrap').classList.remove('active');
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
  $('heroFeels').textContent = `Feels like ${Math.round(main.feels_like)}°C`;

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
  $('detailFeels').textContent  = `Feels like ${toC(main.feels_like)}°C`;
  $('detailHL').textContent     = `H: ${Math.round(main.temp_max)}° · L: ${Math.round(main.temp_min)}°`;

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
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weathercode,windspeed_10m_max&timezone=auto&forecast_days=7`;
    const res = await fetch(url);
    if (!res.ok) return null;
    return res.json();
  } catch(_) { return null; }
}

function wmoToIcon(code) {
  if (code === 0)                                  return '01d';
  if ([1,2,3].includes(code))                      return '03d';
  if ([45,48].includes(code))                      return '50d';
  if ([51,53,55,61,63,65,80,81,82].includes(code)) return '10d';
  if ([66,67,71,73,75,77,85,86].includes(code))    return '13d';
  if ([95,96,99].includes(code))                   return '11d';
  return '03d';
}

function wmoToDesc(code) {
  if (code === 0)                      return 'Clear sky';
  if (code === 1)                      return 'Mainly clear';
  if (code === 2)                      return 'Partly cloudy';
  if (code === 3)                      return 'Overcast';
  if ([45,48].includes(code))          return 'Fog';
  if ([51,53,55].includes(code))       return 'Drizzle';
  if ([61,63,65].includes(code))       return 'Rain';
  if ([80,81,82].includes(code))       return 'Rain showers';
  if ([71,73,75,77].includes(code))    return 'Snow';
  if ([85,86].includes(code))          return 'Snow showers';
  if ([95,96,99].includes(code))       return 'Thunderstorm';
  return 'Mixed conditions';
}

function display7DayForecast(data) {
  const rows  = $('forecast7Rows');
  const panel = $('forecast7');
  if (!data?.daily?.time?.length || !rows || !panel) {
    if (panel) panel.style.display = 'none'; return;
  }
  panel.style.display = '';

  const daily    = data.daily;
  const allMax   = daily.temperature_2m_max;
  const allMin   = daily.temperature_2m_min;
  const weekMin  = Math.min(...allMin);
  const weekMax  = Math.max(...allMax);
  const weekSpan = weekMax - weekMin || 1;
  const tc = v => currentUnit === 'C' ? Math.round(v) : Math.round(v * 9/5 + 32);

  rows.innerHTML = daily.time.map((dateStr, i) => {
    const d        = new Date(dateStr + 'T12:00:00Z');
    const dayName  = d.toLocaleDateString('en-US', { weekday: 'short',  timeZone: 'UTC' });
    const dateLabel= d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
    const code     = daily.weathercode[i];
    const icon     = wmoToIcon(code);
    const desc     = wmoToDesc(code);
    const maxT     = allMax[i];
    const minT     = allMin[i];
    const rain     = daily.precipitation_probability_max[i] ?? 0;
    const leftPct  = ((minT - weekMin) / weekSpan * 100).toFixed(1);
    const rightPct = (100 - (maxT - weekMin) / weekSpan * 100).toFixed(1);

    return `<div class="fc-row">
      <div class="fc-day-name">${dayName}<small>${dateLabel}</small></div>
      <img class="fc-row-icon" src="https://openweathermap.org/img/wn/${icon}@2x.png" alt="${desc}" loading="lazy">
      <div class="fc-row-cond">${desc}</div>
      <div class="fc-rain-prob"><i class="fas fa-droplet"></i>${rain}%</div>
      <div class="fc-temp-range">
        <span class="fc-low">${tc(minT)}°</span>
        <div class="fc-bar-wrap"><div class="fc-bar-fill" style="left:${leftPct}%;right:${rightPct}%"></div></div>
        <span class="fc-high">${tc(maxT)}°</span>
      </div>
    </div>`;
  }).join('');
}

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
  const track  = $('hourlyTrack');
  const panel  = $('hourly');
  if (!forecastData?.list?.length) { panel.style.display = 'none'; return; }
  panel.style.display = '';

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
// 5-DAY FORECAST
// ══════════════════════════════════════════════════════════════
function displayFiveDayForecast(forecastData) {
  const rows  = $('forecastRows');
  const panel = $('forecast');
  if (!forecastData?.list?.length) { panel.style.display = 'none'; return; }
  panel.style.display = '';

  // Group by UTC ISO date (YYYY-MM-DD) — robust across all timezones
  const todayISO = new Date().toISOString().slice(0, 10);
  const dayMap   = {};
  const dayOrder = [];
  forecastData.list.forEach(item => {
    const key = new Date(item.dt * 1000).toISOString().slice(0, 10);
    if (key === todayISO) return;
    if (!dayMap[key]) { dayMap[key] = []; dayOrder.push(key); }
    dayMap[key].push(item);
  });

  const dayKeys = dayOrder.slice(0, 5);
  if (!dayKeys.length) { panel.style.display = 'none'; return; }

  // Week-wide range for the temperature bar
  const allTemps = dayKeys.flatMap(k => dayMap[k].map(i => i.main.temp));
  const weekMin  = Math.min(...allTemps);
  const weekMax  = Math.max(...allTemps);
  const weekSpan = weekMax - weekMin || 1;
  const tc       = v => currentUnit === 'C' ? Math.round(v) : Math.round(v * 9/5 + 32);

  rows.innerHTML = dayKeys.map(key => {
    const items    = dayMap[key];
    const temps    = items.map(i => i.main.temp);
    const dayMin   = Math.min(...temps);
    const dayMax   = Math.max(...temps);
    const maxRain  = Math.round(Math.max(...items.map(i => i.pop || 0)) * 100);
    const mid      = items.find(i => { const h = new Date(i.dt * 1000).getUTCHours(); return h >= 11 && h <= 14; })
                     || items[Math.floor(items.length / 2)];
    const icon     = mid.weather[0].icon;
    const cond     = mid.weather[0].description;
    const d        = new Date(key + 'T12:00:00Z');
    const dayName  = d.toLocaleDateString('en-US', { weekday: 'short',  timeZone: 'UTC' });
    const dateStr  = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

    // Bar: left and right % within the week's temp range
    const leftPct  = ((dayMin - weekMin) / weekSpan * 100).toFixed(1);
    const rightPct = (100 - (dayMax - weekMin) / weekSpan * 100).toFixed(1);

    return `<div class="fc-row">
      <div class="fc-day-name">${dayName}<small>${dateStr}</small></div>
      <img class="fc-row-icon" src="https://openweathermap.org/img/wn/${icon}@2x.png" alt="${cond}" loading="lazy">
      <div class="fc-row-cond">${cond}</div>
      <div class="fc-rain-prob"><i class="fas fa-droplet"></i>${maxRain}%</div>
      <div class="fc-temp-range">
        <span class="fc-low">${tc(dayMin)}°</span>
        <div class="fc-bar-wrap">
          <div class="fc-bar-fill" style="left:${leftPct}%;right:${rightPct}%"></div>
        </div>
        <span class="fc-high">${tc(dayMax)}°</span>
      </div>
    </div>`;
  }).join('');
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
    displayFiveDayForecast(forecast);
  }
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
  const wrap  = $('recentWrap');
  const chips = $('recentChips');
  if (!wrap || !chips) return;
  // Only show after a search, never on page load
  if (!sessionSearches.length || !$('contentPanels').classList.contains('active')) {
    wrap.classList.remove('active');
    return;
  }
  wrap.classList.add('active');
  chips.innerHTML = sessionSearches.map(s => `
    <button class="recent-chip" onclick="triggerSearch('${s.city.replace(/'/g,"\\'")}')">
      <img src="https://openweathermap.org/img/wn/${s.icon}.png" alt="${s.city}">
      ${s.city}
    </button>`).join('');
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

  lastCity = city;
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
    displayFiveDayForecast(forecastData);
    showContent();
    loadDiscover(weatherData);

    // UV + advanced details + AQI + outdoor score (non-blocking)
    const coord = weatherData.coord;
    fetchUV(coord.lat, coord.lon).then(uv => {
      displayAdvanced(weatherData, uv);
      displayOutdoorScore(calculateOutdoorScore(weatherData, uv));
    });
    fetchAirQuality(coord.lat, coord.lon).then(aqiData => displayAQI(aqiData));
    fetch7DayForecast(coord.lat, coord.lon).then(d7 => display7DayForecast(d7));

    // News section (non-blocking)
    $('newsCity').textContent     = weatherData.name;
    $('newsSkel').style.display   = 'block';
    $('newsGrid').innerHTML       = '';
    $('newsMsg').style.display    = 'none';
    fetchNews(weatherData.name, weatherData.sys?.country)
      .then(articles => displayNews(articles, weatherData.name));

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
        syncInputs(weatherData.name);

        displayHero(weatherData);
        displayCurrentWeather(weatherData);
        loadCityInfo(weatherData);
        displayHourly(forecastData, weatherData.timezone);
        renderTempChart(forecastData, weatherData.timezone);
        displayFiveDayForecast(forecastData);
        showContent();
        loadDiscover(weatherData);

        fetchUV(weatherData.coord.lat, weatherData.coord.lon)
          .then(uv => {
            displayAdvanced(weatherData, uv);
            displayOutdoorScore(calculateOutdoorScore(weatherData, uv));
          });
        fetchAirQuality(weatherData.coord.lat, weatherData.coord.lon).then(aqiData => displayAQI(aqiData));
        fetch7DayForecast(weatherData.coord.lat, weatherData.coord.lon).then(d7 => display7DayForecast(d7));

        // News section
        $('newsCity').textContent     = weatherData.name;
        $('newsSkel').style.display   = 'block';
        $('newsGrid').innerHTML       = '';
        $('newsMsg').style.display    = 'none';
        fetchNews(weatherData.name, weatherData.sys?.country)
          .then(articles => displayNews(articles, weatherData.name));

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
// NEWS  (GNews.io – free tier, CORS-friendly)
// ══════════════════════════════════════════════════════════════
async function fetchNews(city, country) {
  const key = (typeof CONFIG !== 'undefined') && CONFIG.NEWS_API_KEY;
  if (!key || key.startsWith('YOUR_')) return null; // placeholder not replaced
  const lang = country === 'DE' ? 'de' : 'en';
  const url  = `https://gnews.io/api/v4/search?q=${encodeURIComponent(city)}&lang=${lang}&country=any&max=4&sortby=publishedAt&apikey=${key}`;
  try {
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), 8000);
    const res  = await fetch(url, { signal: ctrl.signal });
    clearTimeout(tid);
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data.articles) ? data.articles : null;
  } catch (_) { return null; }
}

function displayNews(articles, city) {
  const grid  = $('newsGrid');
  const skel  = $('newsSkel');
  const msgEl = $('newsMsg');
  if (!grid || !skel || !msgEl) return;

  if ($('newsCity')) $('newsCity').textContent = city || '—';
  skel.style.display = 'none';

  if (articles === null) {
    // API key not configured
    grid.innerHTML = '';
    msgEl.innerHTML = `<div class="news-no-key">
      <div class="nnk-icon"><i class="fas fa-newspaper"></i></div>
      <p>To show local news, add your free <strong>GNews API key</strong> to <code>js/config.js</code> (<code>NEWS_API_KEY</code>).</p>
      <a href="https://gnews.io" target="_blank" rel="noopener" class="btn-get-news-key">
        <i class="fas fa-external-link-alt"></i>&nbsp;Get Free Key at gnews.io
      </a>
    </div>`;
    msgEl.style.display = 'block';
    return;
  }

  msgEl.style.display = 'none';

  if (!articles.length) {
    grid.innerHTML = '<p class="news-empty"><i class="fas fa-search"></i> No recent news found for this city.</p>';
    return;
  }

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
  const radius = 2000;
  const tagQueries = {
    restaurants: 'node["amenity"~"restaurant|cafe|fast_food"]',
    sports:      'node["leisure"~"sports_centre|stadium|pitch"]',
    fitness:     'node["leisure"~"fitness_centre|gym|swimming_pool"]',
    health:      'node["amenity"~"hospital|pharmacy|clinic|doctors"]',
    shopping:    'node["shop"~"mall|supermarket|clothes|bakery"]',
    hotels:      'node["tourism"~"hotel|hostel|guest_house"]',
    attractions: 'node["tourism"~"attraction|museum|gallery"]',
    cafes:       'node["amenity"~"cafe|bar|pub"]',
    parks:       'node["leisure"~"park|garden"]'
  };

  const query = `[out:json][timeout:10];
${tagQueries[category] || tagQueries.restaurants}(around:${radius},${lat},${lon});
out body 8;`;

  try {
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), 12000);
    const res  = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body:   'data=' + encodeURIComponent(query),
      signal: ctrl.signal
    });
    clearTimeout(tid);
    if (!res.ok) return [];
    const data = await res.json();
    return data.elements
      .filter(el => el.tags?.name)
      .slice(0, 8)
      .map(el => ({
        name:     el.tags.name,
        type:     el.tags.amenity || el.tags.leisure || el.tags.tourism || el.tags.shop || '',
        address:  el.tags['addr:street']
                    ? `${el.tags['addr:street']} ${el.tags['addr:housenumber'] || ''}`.trim()
                    : '',
        phone:    el.tags.phone || el.tags['contact:phone'] || '',
        website:  el.tags.website || el.tags['contact:website'] || '',
        hours:    el.tags.opening_hours || '',
        lat:      el.lat,
        lon:      el.lon,
        distance: calcDistance(lat, lon, el.lat, el.lon)
      }))
      .sort((a, b) => a.distance - b.distance);
  } catch(_) { return []; }
}

async function loadDiscover(weatherData) {
  const city = weatherData.name;
  const lat  = weatherData.coord.lat;
  const lon  = weatherData.coord.lon;

  discoverLat          = lat;
  discoverLon          = lon;
  discoverPlacesCache  = {};

  if ($('discoverCity')) $('discoverCity').textContent = city;

  // Reset tab to restaurants
  document.querySelectorAll('.disc-tab').forEach((t, i) => {
    t.classList.toggle('active', i === 0);
  });
  currentDiscoverCat = 'restaurants';

  initDiscoverMap(lat, lon, city);
  showWeatherTip(weatherData);

  // Pre-load default tab
  $('placesLoading').style.display = 'block';
  $('placesGrid').innerHTML = '';
  const places = await fetchNearbyPlaces(lat, lon, 'restaurants');
  discoverPlacesCache['restaurants'] = places;
  $('placesLoading').style.display = 'none';
  renderPlaces(places);
}

function initDiscoverMap(lat, lon, city) {
  if (discoverMap) {
    discoverMap.remove();
    discoverMap    = null;
    discoverMarkers = [];
  }
  try {
    discoverMap = L.map('discoverMap', { zoomControl: true }).setView([lat, lon], 14);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19
    }).addTo(discoverMap);
    L.marker([lat, lon])
      .addTo(discoverMap)
      .bindPopup(`<b>${city}</b><br>City Center`)
      .openPopup();
  } catch(e) { console.warn('Map init failed:', e.message); }
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

window.switchDiscoverTab = async function(category, btn) {
  currentDiscoverCat = category;
  document.querySelectorAll('.disc-tab').forEach(t => t.classList.remove('active'));
  if (btn) btn.classList.add('active');
  if (!discoverLat) return;

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
  const grid = $('placesGrid');
  if (!grid) return;

  // Clear old map markers
  discoverMarkers.forEach(m => { try { discoverMap?.removeLayer(m); } catch(_){} });
  discoverMarkers = [];

  if (!places.length) {
    grid.innerHTML = '<div class="places-empty"><i class="fas fa-search"></i> No places found nearby. Try a larger city!</div>';
    return;
  }

  grid.innerHTML = places.map(p => `
    <div class="place-card" onclick="focusPlace(${p.lat},${p.lon},'${escAttr(p.name)}')">
      <div class="place-name">${escHtml(p.name)}</div>
      <div class="place-type">${escHtml(p.type)}</div>
      <div class="place-info">
        ${p.address ? `<div><i class="fas fa-location-dot"></i>${escHtml(p.address)}</div>` : ''}
        ${p.hours   ? `<div><i class="fas fa-clock"></i>${escHtml(p.hours.slice(0,35))}</div>` : ''}
        ${p.phone   ? `<div><i class="fas fa-phone"></i>${escHtml(p.phone)}</div>` : ''}
        ${p.website ? `<div><i class="fas fa-globe"></i><a href="${escAttr(p.website)}" target="_blank" rel="noopener" style="color:#38bdf8">Website</a></div>` : ''}
      </div>
      <span class="place-dist">${p.distance < 1000 ? p.distance + 'm' : (p.distance/1000).toFixed(1) + 'km'} away</span>
    </div>`).join('');

  // Add markers to map
  if (discoverMap) {
    places.forEach(p => {
      if (!p.lat || !p.lon) return;
      try {
        const m = L.marker([p.lat, p.lon])
          .addTo(discoverMap)
          .bindPopup(`<b>${p.name}</b>${p.address ? '<br>' + p.address : ''}`);
        discoverMarkers.push(m);
      } catch(_) {}
    });

    const validPlaces = places.filter(p => p.lat && p.lon);
    if (validPlaces.length > 0) {
      try {
        const bounds = L.latLngBounds(validPlaces.map(p => [p.lat, p.lon]));
        if (bounds.isValid()) discoverMap.fitBounds(bounds, { padding: [30, 30] });
      } catch(_) {}
    }
  }
}

window.focusPlace = function(lat, lon, name) {
  if (!discoverMap) return;
  discoverMap.setView([lat, lon], 17);
  discoverMarkers.forEach(m => {
    try {
      if (Math.abs(m.getLatLng().lat - lat) < 0.0001 &&
          Math.abs(m.getLatLng().lng - lon) < 0.0001) {
        m.openPopup();
      }
    } catch(_) {}
  });
  const mapEl = $('discoverMap');
  if (mapEl) mapEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
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
      $('newsSkel').style.display = 'block';
      $('newsGrid').innerHTML     = '';
      $('newsMsg').style.display  = 'none';
      const btn = $('newsRefresh');
      btn?.classList.add('spinning');
      fetchNews(w.name, w.sys?.country).then(articles => {
        btn?.classList.remove('spinning');
        displayNews(articles, w.name);
      });
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
