/* ============================================================
   WeatherPro – weather.js
   Handles: search, current weather, 5-day forecast, UV Index,
            live clock, Supabase tracking, recent searches
   ============================================================ */

// ── Supabase ──────────────────────────────────────────────────
let supabaseClient = null;
try {
  supabaseClient = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
} catch (e) {
  console.warn('Supabase init failed:', e.message);
}

function getVisitorId() {
  let id = localStorage.getItem('wp_visitor_id');
  if (!id) {
    id = 'v_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
    localStorage.setItem('wp_visitor_id', id);
  }
  return id;
}

async function trackPageVisit() {
  if (!supabaseClient) return;
  try {
    await supabaseClient.from('page_visits').insert({ visitor_id: getVisitorId() });
  } catch (e) { /* silent */ }
}

// ── State ─────────────────────────────────────────────────────
let currentWeather = null;
let currentUnit = 'C';

// ── DOM helper ────────────────────────────────────────────────
const $ = id => document.getElementById(id);

// ── Live Clock ────────────────────────────────────────────────
function updateClock() {
  const now = new Date();
  const dateEl = $('heroDate');
  const timeEl = $('heroTime');
  if (dateEl) dateEl.textContent = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  if (timeEl) timeEl.textContent = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// ── Show / hide UI states ─────────────────────────────────────
function showState(state) {
  $('loading').classList.remove('visible');
  $('errorCard').classList.remove('visible');
  $('weatherCard').classList.remove('visible');

  if (state === 'loading') $('loading').classList.add('visible');
  if (state === 'error')   $('errorCard').classList.add('visible');
  if (state === 'weather') {
    $('weatherCard').classList.add('visible');
    setTimeout(() => {
      $('weatherCard').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 120);
  }
}

// ── Helpers ───────────────────────────────────────────────────
function fmtTime(unix, offset) {
  const d = new Date((unix + offset) * 1000);
  return d.getUTCHours().toString().padStart(2, '0') + ':' + d.getUTCMinutes().toString().padStart(2, '0');
}
function toF(c) { return ((c * 9) / 5 + 32).toFixed(1); }
function toC(c) { return parseFloat(c).toFixed(1); }

// ── Unit toggle ───────────────────────────────────────────────
function switchUnit(unit) {
  currentUnit = unit;
  $('celsiusBtn').classList.toggle('active', unit === 'C');
  $('fahrenheitBtn').classList.toggle('active', unit === 'F');
  if (!currentWeather) return;
  const { temp, feelsLike } = currentWeather;
  if (unit === 'C') {
    $('temperature').textContent   = `${toC(temp)}°C`;
    $('feelsLikeMain').textContent = `Feels like ${toC(feelsLike)}°C`;
  } else {
    $('temperature').textContent   = `${toF(temp)}°F`;
    $('feelsLikeMain').textContent = `Feels like ${toF(feelsLike)}°F`;
  }
}
window.switchUnit = switchUnit;

// ── API calls ─────────────────────────────────────────────────
async function fetchWeather(city) {
  const url = `${CONFIG.OPENWEATHER_BASE_URL}/weather?q=${encodeURIComponent(city)}&appid=${CONFIG.OPENWEATHER_API_KEY}&units=metric`;
  const res = await fetch(url);
  if (!res.ok) {
    if (res.status === 404) throw new Error('City not found. Please check the spelling and try again.');
    throw new Error(`API error (${res.status}). Please try again later.`);
  }
  return res.json();
}

async function fetchForecast(city) {
  try {
    const url = `${CONFIG.OPENWEATHER_BASE_URL}/forecast?q=${encodeURIComponent(city)}&appid=${CONFIG.OPENWEATHER_API_KEY}&units=metric`;
    const res = await fetch(url);
    if (!res.ok) return null;
    return res.json();
  } catch (e) { return null; }
}

async function fetchUVIndex(lat, lon) {
  try {
    const url = `${CONFIG.OPENWEATHER_BASE_URL}/uvi?lat=${lat}&lon=${lon}&appid=${CONFIG.OPENWEATHER_API_KEY}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const d = await res.json();
    return typeof d.value === 'number' ? d.value : null;
  } catch (e) { return null; }
}

// ── Display current weather ───────────────────────────────────
function displayWeather(data) {
  const { name, sys, main, weather, wind, visibility, dt, timezone, clouds, coord } = data;
  const icon = weather[0].icon;
  const desc = weather[0].description;

  // Store for unit toggle
  currentWeather = { temp: main.temp, feelsLike: main.feels_like };
  currentUnit = 'C';
  $('celsiusBtn').classList.add('active');
  $('fahrenheitBtn').classList.remove('active');

  // Icon
  $('weatherIcon').src = `https://openweathermap.org/img/wn/${icon}@4x.png`;
  $('weatherIcon').alt = desc;

  // Location & date
  $('cityName').textContent = `${name}, ${sys.country}`;
  const dateStr = new Date((dt + timezone) * 1000)
    .toUTCString().replace(' GMT', '').split(',')[1].trim().slice(0, -3);
  $('countryDate').textContent = dateStr;

  // Temperature & description
  $('temperature').textContent   = `${toC(main.temp)}°C`;
  $('weatherDesc').textContent   = desc;
  $('feelsLikeMain').textContent = `Feels like ${toC(main.feels_like)}°C`;

  // Details
  $('humidity').textContent   = `${main.humidity}%`;
  $('windSpeed').textContent  = `${(wind.speed * 3.6).toFixed(1)} km/h`;
  $('visibility').textContent = visibility ? `${(visibility / 1000).toFixed(1)} km` : 'N/A';
  $('pressure').textContent   = `${main.pressure} hPa`;
  $('sunrise').textContent    = fmtTime(sys.sunrise, timezone);
  $('sunset').textContent     = fmtTime(sys.sunset, timezone);
  $('cloudiness').textContent = `${clouds?.all ?? '--'}%`;
  $('uvIndex').textContent    = '—'; // updated async below

  return coord;
}

// ── Display 5-day forecast ────────────────────────────────────
function displayForecast(data) {
  const section = $('forecast');
  const grid    = $('forecastGrid');
  const loading = $('forecastLoading');

  loading.classList.remove('visible');

  if (!data || !data.list) {
    section.classList.remove('visible');
    return;
  }

  // Group entries by calendar day, skip today
  const today = new Date().toDateString();
  const days  = {};
  data.list.forEach(item => {
    const key = new Date(item.dt * 1000).toDateString();
    if (key === today) return;
    if (!days[key]) days[key] = [];
    days[key].push(item);
  });

  const dayKeys = Object.keys(days).slice(0, 5);
  if (!dayKeys.length) { section.classList.remove('visible'); return; }

  section.classList.add('visible');

  grid.innerHTML = dayKeys.map(key => {
    const items = days[key];
    const temps = items.map(i => i.main.temp);
    const high  = Math.round(Math.max(...temps));
    const low   = Math.round(Math.min(...temps));

    // Pick midday entry for icon/condition
    const mid = items.find(i => {
      const h = new Date(i.dt * 1000).getUTCHours();
      return h >= 11 && h <= 14;
    }) || items[Math.floor(items.length / 2)];

    const icon = mid.weather[0].icon;
    const cond = mid.weather[0].description;
    const d    = new Date(key);
    const dayName = d.toLocaleDateString('en-US', { weekday: 'short' });
    const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

    return `
      <div class="forecast-day">
        <div class="fc-day-name">${dayName}<small>${dateStr}</small></div>
        <img class="fc-icon" src="https://openweathermap.org/img/wn/${icon}@2x.png" alt="${cond}">
        <div class="fc-cond">${cond}</div>
        <div class="fc-temps">
          <span class="fc-high">${high}°</span>
          <span class="fc-low">${low}°</span>
        </div>
      </div>`;
  }).join('');
}

// ── Save to Supabase ──────────────────────────────────────────
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
  } catch (e) {
    console.warn('Supabase save failed:', e.message);
  }
}

// ── Recent searches ───────────────────────────────────────────
function getRecentSearches() {
  try { return JSON.parse(localStorage.getItem('wp_recent') || '[]'); } catch (e) { return []; }
}

function addRecentSearch(city, icon) {
  let recent = getRecentSearches().filter(r => r.city.toLowerCase() !== city.toLowerCase());
  recent.unshift({ city, icon });
  if (recent.length > 8) recent = recent.slice(0, 8);
  localStorage.setItem('wp_recent', JSON.stringify(recent));
}

function renderRecentSearches() {
  const recent  = getRecentSearches();
  const section = $('recentSearches');
  const list    = $('recentList');
  if (!recent.length) { section.classList.remove('visible'); return; }
  section.classList.add('visible');
  list.innerHTML = recent.map(r => `
    <button class="recent-chip" onclick="triggerSearch('${r.city.replace(/'/g, "\\'")}')">
      <img src="https://openweathermap.org/img/wn/${r.icon}.png" alt="${r.city}">
      ${r.city}
    </button>`).join('');
}

// ── Main search flow ──────────────────────────────────────────
async function triggerSearch(city) {
  if (!city.trim()) return;

  // Sync all inputs
  ['cityInput', 'headerCityInput', 'mobileCityInput'].forEach(id => {
    const el = $(id);
    if (el) el.value = city;
  });

  // Show forecast section with spinner
  const forecastSection = $('forecast');
  const forecastLoading = $('forecastLoading');
  const forecastGrid    = $('forecastGrid');
  forecastGrid.innerHTML = '';
  forecastSection.classList.add('visible');
  forecastLoading.classList.add('visible');

  showState('loading');

  try {
    // Fetch current weather + forecast in parallel
    const [weatherData, forecastData] = await Promise.all([
      fetchWeather(city),
      fetchForecast(city)
    ]);

    const coord = displayWeather(weatherData);
    showState('weather');
    displayForecast(forecastData);

    // Fetch UV Index asynchronously (non-blocking)
    if (coord) {
      fetchUVIndex(coord.lat, coord.lon).then(uv => {
        if (uv !== null) $('uvIndex').textContent = uv.toFixed(1);
      });
    }

    addRecentSearch(weatherData.name, weatherData.weather[0].icon);
    renderRecentSearches();
    await saveSearch(weatherData);

  } catch (err) {
    $('errorMessage').textContent = err.message || 'Something went wrong. Please try again.';
    forecastSection.classList.remove('visible');
    forecastLoading.classList.remove('visible');
    showState('error');
  }
}
window.triggerSearch = triggerSearch;

// ── Wire up all search forms ──────────────────────────────────
function setupForm(formId, inputId) {
  const form = $(formId);
  if (!form) return;
  form.addEventListener('submit', e => {
    e.preventDefault();
    const city = $(inputId)?.value.trim();
    if (city) triggerSearch(city);
  });
}
setupForm('heroSearchForm',   'cityInput');
setupForm('headerSearchForm', 'headerCityInput');
setupForm('mobileSearchForm', 'mobileCityInput');

// ── Mobile menu toggle ────────────────────────────────────────
const mobileBtn = $('mobileMenuBtn');
const mobileNav = $('mobileNav');
if (mobileBtn && mobileNav) {
  mobileBtn.addEventListener('click', () => mobileNav.classList.toggle('open'));
  // Close when a nav link is clicked
  mobileNav.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', () => mobileNav.classList.remove('open'));
  });
}

// ── Init ──────────────────────────────────────────────────────
updateClock();
setInterval(updateClock, 1000);
renderRecentSearches();
trackPageVisit();
