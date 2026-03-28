/* ============================================================
   WeatherPro – dashboard.js  (Admin dashboard data & charts)
   ============================================================ */

// ── Auth guard ────────────────────────────────────────────────
if (sessionStorage.getItem('wp_admin') !== 'true') {
  window.location.href = 'admin-login.html';
}

// ── Supabase ──────────────────────────────────────────────────
let db = null;
try {
  db = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
} catch(e) {
  console.error('Supabase init error:', e.message);
}

// ── Logout ────────────────────────────────────────────────────
document.getElementById('logoutBtn').addEventListener('click', () => {
  sessionStorage.removeItem('wp_admin');
  window.location.href = 'admin-login.html';
});

// ── Live clock ────────────────────────────────────────────────
function updateClock() {
  const el = document.getElementById('dashDateTime');
  if (el) el.textContent = new Date().toLocaleString('en-GB', {
    weekday:'long', year:'numeric', month:'long', day:'numeric',
    hour:'2-digit', minute:'2-digit'
  });
}
updateClock();
setInterval(updateClock, 60000);

// ── Helpers ───────────────────────────────────────────────────
const $ = id => document.getElementById(id);

function set(id, val) {
  const el = $(id);
  if (el) el.textContent = val;
}

function todayISO() {
  return new Date().toISOString().split('T')[0];
}

// ── Chart instance ────────────────────────────────────────────
let chartInstance = null;

function renderChart(labels, values) {
  const ctx = document.getElementById('visitChart');
  if (!ctx) return;

  if (chartInstance) { chartInstance.destroy(); }

  chartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Searches',
        data: values,
        backgroundColor: 'rgba(79,172,254,0.25)',
        borderColor: '#4facfe',
        borderWidth: 2,
        borderRadius: 8,
        hoverBackgroundColor: 'rgba(79,172,254,0.45)'
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(14,19,48,0.95)',
          titleColor: '#fff',
          bodyColor: 'rgba(255,255,255,0.7)',
          borderColor: 'rgba(255,255,255,0.1)',
          borderWidth: 1
        }
      },
      scales: {
        x: {
          grid: { color: 'rgba(255,255,255,0.05)' },
          ticks: { color: 'rgba(255,255,255,0.5)', font: { family:'Poppins', size:11 } }
        },
        y: {
          grid: { color: 'rgba(255,255,255,0.05)' },
          ticks: { color: 'rgba(255,255,255,0.5)', font: { family:'Poppins', size:11 }, stepSize: 1 },
          beginAtZero: true
        }
      }
    }
  });
}

// ── Populate top cities ───────────────────────────────────────
function renderCityList(cities) {
  const list = $('cityList');
  if (!list) return;
  if (!cities || !cities.length) {
    list.innerHTML = '<div class="table-empty"><i class="fas fa-map-marker-alt"></i><p>No searches recorded yet</p></div>';
    return;
  }

  const max = cities[0].count;
  set('citiesCount', cities.length);

  list.innerHTML = cities.slice(0,10).map((c, i) => {
    const rankClass = i === 0 ? 'rank-1' : i === 1 ? 'rank-2' : i === 2 ? 'rank-3' : 'rank-other';
    const pct = max ? Math.round((c.count / max) * 100) : 0;
    return `
      <div class="city-row">
        <div class="city-rank ${rankClass}">${i+1}</div>
        <div class="city-name-text">${c.city}</div>
        <div class="city-bar-wrap"><div class="city-bar" style="width:${pct}%"></div></div>
        <div class="city-count">${c.count} ${c.count === 1 ? 'search' : 'searches'}</div>
      </div>
    `;
  }).join('');
}

// ── Populate recent searches table ───────────────────────────
function renderTable(rows) {
  const tbody = $('searchTableBody');
  if (!tbody) return;

  if (!rows || !rows.length) {
    tbody.innerHTML = `
      <tr><td colspan="8" class="table-empty">
        <i class="fas fa-database"></i><p>No searches recorded yet</p>
      </td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map((r, i) => {
    const time = r.created_at
      ? new Date(r.created_at).toLocaleString('en-GB', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' })
      : '—';
    const iconHtml = r.icon
      ? `<img class="weather-mini-icon" src="https://openweathermap.org/img/wn/${r.icon}.png" alt="">`
      : '';
    return `
      <tr>
        <td style="color:var(--text-muted)">${i + 1}</td>
        <td class="td-city">${r.city || '—'}</td>
        <td>${r.country || '—'}</td>
        <td class="td-temp">${r.temperature != null ? r.temperature + '°C' : '—'}</td>
        <td class="td-cond">${iconHtml}${r.condition || '—'}</td>
        <td>${r.humidity != null ? r.humidity + '%' : '—'}</td>
        <td>${r.wind_speed != null ? r.wind_speed + ' km/h' : '—'}</td>
        <td class="td-time">${time}</td>
      </tr>
    `;
  }).join('');
}

// ── Load all dashboard data ───────────────────────────────────
async function loadDashboard() {
  const loading = $('dashLoading');
  if (loading) loading.classList.add('visible');

  if (!db) {
    if (loading) loading.classList.remove('visible');
    showNoDatabase();
    return;
  }

  try {
    const today = todayISO();

    // 1. Total searches
    const { count: totalSearches } = await db
      .from('weather_searches')
      .select('*', { count: 'exact', head: true });

    // 2. Today's searches
    const { count: todaySearches } = await db
      .from('weather_searches')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', today + 'T00:00:00Z');

    // 3. Total visitors (unique visitor_ids in page_visits)
    const { data: visitorData } = await db
      .from('page_visits')
      .select('visitor_id');
    const totalVisitors = visitorData ? new Set(visitorData.map(v => v.visitor_id)).size : 0;

    // 4. Today's visitors
    const { data: todayVisitorData } = await db
      .from('page_visits')
      .select('visitor_id')
      .gte('visited_at', today + 'T00:00:00Z');
    const todayVisitors = todayVisitorData ? new Set(todayVisitorData.map(v => v.visitor_id)).size : 0;

    // 5. All cities for grouping
    const { data: allSearches } = await db
      .from('weather_searches')
      .select('city, created_at');

    // Group cities
    const cityMap = {};
    (allSearches || []).forEach(s => {
      const key = s.city;
      cityMap[key] = (cityMap[key] || 0) + 1;
    });
    const sortedCities = Object.entries(cityMap)
      .map(([city, count]) => ({ city, count }))
      .sort((a,b) => b.count - a.count);

    const uniqueCities = sortedCities.length;
    const topCity = sortedCities[0]?.city || '—';

    // 6. Daily breakdown (last 7 days)
    const dayMap = {};
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().split('T')[0];
      dayMap[key] = 0;
    }
    (allSearches || []).forEach(s => {
      const day = s.created_at ? s.created_at.split('T')[0] : null;
      if (day && dayMap.hasOwnProperty(day)) dayMap[day]++;
    });

    const chartLabels = Object.keys(dayMap).map(d => {
      const dt = new Date(d);
      return dt.toLocaleDateString('en-GB', { month:'short', day:'numeric' });
    });
    const chartValues = Object.values(dayMap);

    // 7. Recent 30 searches
    const { data: recentRows } = await db
      .from('weather_searches')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(30);

    // ── Update UI ──────────────────────────────────────────────
    set('statTotalSearches', (totalSearches || 0).toLocaleString());
    set('statTodaySearches', `+${todaySearches || 0} today`);
    set('statUniqueCities', (uniqueCities || 0).toLocaleString());
    set('statTopCity', topCity);
    set('statVisitors', (totalVisitors || 0).toLocaleString());
    set('statTodayVisitors', `+${todayVisitors} today`);

    const avg = totalVisitors > 0
      ? (totalSearches / totalVisitors).toFixed(1)
      : '0.0';
    set('statAvgPerVisitor', avg);

    renderCityList(sortedCities);
    renderChart(chartLabels, chartValues);
    renderTable(recentRows);

    $('chartNote').textContent = `Total: ${(totalSearches || 0)} searches in the last 7 days shown`;

  } catch (err) {
    console.error('Dashboard load error:', err.message);
    $('chartNote').textContent = 'Could not load data. Check Supabase setup.';
  } finally {
    if (loading) loading.classList.remove('visible');
  }
}

function showNoDatabase() {
  $('statTotalSearches').textContent = '–';
  $('chartNote').textContent = 'Database not connected. Run setup.sql in Supabase.';
}

// ── Refresh button ────────────────────────────────────────────
const refreshBtn = $('refreshBtn');
if (refreshBtn) {
  refreshBtn.addEventListener('click', () => {
    refreshBtn.classList.add('spinning');
    loadDashboard().finally(() => refreshBtn.classList.remove('spinning'));
  });
}

// ── Init ──────────────────────────────────────────────────────
loadDashboard();
