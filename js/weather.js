/* ============================================================
   WeatherPro – weather.js
   Handles: visitor tracking, weather fetching, display, Supabase saves
   ============================================================ */

// ── Supabase client ─────────────────────────────────────────
let supabaseClient = null;
try {
  supabaseClient = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
} catch (e) {
  console.warn('Supabase init failed:', e.message);
}

// ── Visitor ID ───────────────────────────────────────────────
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

// ── Current weather state ─────────────────────────────────────
let currentWeather = null; // raw Celsius data
let currentUnit = 'C';

// ── DOM helpers ───────────────────────────────────────────────
const $ = id => document.getElementById(id);

function showState(state) {
  $('loading').classList.remove('visible');
  $('errorCard').classList.remove('visible');
  $('weatherCard').classList.remove('visible');

  if (state === 'loading') $('loading').classList.add('visible');
  if (state === 'error')   $('errorCard').classList.add('visible');
  if (state === 'weather') $('weatherCard').classList.add('visible');
}

// ── Weather theme (card background colour) ────────────────────
function getTheme(icon) {
  if (!icon) return '';
  if (icon.startsWith('01')) return icon.endsWith('d') ? 'clear-day' : 'clear-night';
  if (['02','03','04'].some(p => icon.startsWith(p))) return 'cloudy';
  if (['09','10'].some(p => icon.startsWith(p))) return 'rain';
  if (icon.startsWith('11')) return 'thunder';
  if (icon.startsWith('13')) return 'snow';
  if (icon.startsWith('50')) return 'mist';
  return '';
}

// ── Format time from Unix timestamp ──────────────────────────
function fmtTime(unix, offset) {
  const d = new Date((unix + offset) * 1000);
  const h = d.getUTCHours().toString().padStart(2,'0');
  const m = d.getUTCMinutes().toString().padStart(2,'0');
  return `${h}:${m}`;
}

// ── Temperature conversion ────────────────────────────────────
function toF(c) { return ((c * 9) / 5 + 32).toFixed(1); }
function toC(c) { return c.toFixed(1); }

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

// ── Fetch from OpenWeatherMap ─────────────────────────────────
async function fetchWeather(city) {
  const url = `${CONFIG.OPENWEATHER_BASE_URL}/weather?q=${encodeURIComponent(city)}&appid=${CONFIG.OPENWEATHER_API_KEY}&units=metric`;
  const res  = await fetch(url);
  if (!res.ok) {
    if (res.status === 404) throw new Error('City not found. Please check the spelling.');
    throw new Error(`API error (${res.status}). Please try again.`);
  }
  return res.json();
}

// ── Display weather data ──────────────────────────────────────
function displayWeather(data) {
  const { name, sys, main, weather, wind, visibility, dt, timezone } = data;
  const icon   = weather[0].icon;
  const desc   = weather[0].description;

  // Store raw data
  currentWeather = {
    temp:      main.temp,
    feelsLike: main.feels_like,
    icon,
    desc,
    city: name,
    country: sys.country
  };
  currentUnit = 'C'; // reset to Celsius on new search
  $('celsiusBtn').classList.add('active');
  $('fahrenheitBtn').classList.remove('active');

  // Set theme
  const card = $('weatherCard');
  card.className = 'weather-card visible ' + getTheme(icon);

  // Icon
  $('weatherIcon').src = `https://openweathermap.org/img/wn/${icon}@4x.png`;
  $('weatherIcon').alt = desc;

  // Location
  $('cityName').textContent   = `${name}, ${sys.country}`;
  const dateStr = new Date((dt + timezone) * 1000).toUTCString()
    .replace(' GMT', '').split(',')[1].trim().slice(0,-3);
  $('countryDate').textContent = dateStr;

  // Temperature
  $('temperature').textContent   = `${toC(main.temp)}°C`;
  $('weatherDesc').textContent   = desc;
  $('feelsLikeMain').textContent = `Feels like ${toC(main.feels_like)}°C`;

  // Details
  $('humidity').textContent  = `${main.humidity}%`;
  $('windSpeed').textContent = `${(wind.speed * 3.6).toFixed(1)} km/h`;
  $('visibility').textContent= visibility ? `${(visibility / 1000).toFixed(1)} km` : 'N/A';
  $('pressure').textContent  = `${main.pressure} hPa`;
  $('sunrise').textContent   = fmtTime(sys.sunrise, timezone);
  $('sunset').textContent    = fmtTime(sys.sunset,  timezone);
}

// ── Save search to Supabase ───────────────────────────────────
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
    console.warn('Could not save search to Supabase:', e.message);
  }
}

// ── Recent searches (LocalStorage for instant UX) ────────────
function getRecentSearches() {
  try { return JSON.parse(localStorage.getItem('wp_recent') || '[]'); }
  catch(e) { return []; }
}

function addRecentSearch(city, icon) {
  let recent = getRecentSearches().filter(r => r.city.toLowerCase() !== city.toLowerCase());
  recent.unshift({ city, icon });
  if (recent.length > 8) recent = recent.slice(0, 8);
  localStorage.setItem('wp_recent', JSON.stringify(recent));
}

function renderRecentSearches() {
  const recent = getRecentSearches();
  const section = $('recentSearches');
  const list    = $('recentList');

  if (!recent.length) { section.classList.remove('visible'); return; }

  section.classList.add('visible');
  list.innerHTML = recent.map(r => `
    <button class="recent-chip" onclick="triggerSearch('${r.city.replace(/'/g,"\\'")}')">
      <img src="https://openweathermap.org/img/wn/${r.icon}.png" alt="${r.city}">
      ${r.city}
    </button>
  `).join('');
}

// ── Main search flow ──────────────────────────────────────────
async function triggerSearch(city) {
  if (!city.trim()) return;
  $('cityInput').value = city;
  showState('loading');

  try {
    const data = await fetchWeather(city);
    displayWeather(data);
    showState('weather');
    addRecentSearch(data.name, data.weather[0].icon);
    renderRecentSearches();
    await saveSearch(data);
  } catch (err) {
    $('errorMessage').textContent = err.message || 'Something went wrong. Please try again.';
    showState('error');
  }
}
window.triggerSearch = triggerSearch;

// ── Form submit ───────────────────────────────────────────────
document.getElementById('searchForm').addEventListener('submit', e => {
  e.preventDefault();
  const city = $('cityInput').value.trim();
  if (!city) return;
  triggerSearch(city);
});

// ── Init ──────────────────────────────────────────────────────
renderRecentSearches();
trackPageVisit();
