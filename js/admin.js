/* ============================================================
   WeatherPro – admin.js  (Login page logic)
   ============================================================ */

// If already logged in, go straight to dashboard
if (sessionStorage.getItem('wp_admin') === 'true') {
  window.location.href = 'admin-dashboard.html';
}

const loginForm   = document.getElementById('loginForm');
const loginBtn    = document.getElementById('loginBtn');
const loginError  = document.getElementById('loginError');
const errorMsg    = document.getElementById('loginErrorMsg');
const togglePw    = document.getElementById('togglePw');
const toggleIcon  = document.getElementById('togglePwIcon');
const pwInput     = document.getElementById('password');

// Toggle password visibility
togglePw.addEventListener('click', () => {
  const isPassword = pwInput.type === 'password';
  pwInput.type = isPassword ? 'text' : 'password';
  toggleIcon.classList.toggle('fa-eye',      !isPassword);
  toggleIcon.classList.toggle('fa-eye-slash', isPassword);
});

// Login form submit
loginForm.addEventListener('submit', e => {
  e.preventDefault();

  const username = document.getElementById('username').value.trim();
  const password = pwInput.value;

  // Simple feedback
  loginError.classList.remove('visible');
  loginBtn.disabled = true;
  loginBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Signing in…';

  setTimeout(() => {
    if (username === CONFIG.ADMIN_USERNAME && password === CONFIG.ADMIN_PASSWORD) {
      sessionStorage.setItem('wp_admin', 'true');
      loginBtn.innerHTML = '<i class="fas fa-check"></i> Redirecting…';
      window.location.href = 'admin-dashboard.html';
    } else {
      loginError.classList.add('visible');
      errorMsg.textContent = 'Invalid username or password. Please try again.';
      loginBtn.disabled  = false;
      loginBtn.innerHTML = '<i class="fas fa-sign-in-alt"></i> Sign In to Dashboard';
      pwInput.value = '';
      pwInput.focus();
    }
  }, 600); // small delay for UX feel
});
