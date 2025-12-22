// Version: 5.0 - TypeScript login entry point
// Login page initialization - imports styles and handles authentication

// Import styles in order
import './styles/variables.css';
import './styles/base.css';
import './styles/login.css';

// Import services
import { AuthService } from '@services/auth.service';

console.log('[LOGIN] Page loaded');

// Check if already logged in
if (AuthService.isAuthenticated()) {
  console.log('[LOGIN] User already authenticated, redirecting to main');
  window.location.href = '/main.html';
}

// Wait for DOM
const initLogin = () => {
  const loginForm = document.getElementById('loginForm') as HTMLFormElement;
  const usernameInput = document.getElementById('username') as HTMLInputElement;
  const passwordInput = document.getElementById('password') as HTMLInputElement;
  const loginBtn = document.getElementById('loginBtn') as HTMLButtonElement;
  const errorMessage = document.getElementById('errorMessage') as HTMLDivElement;

  if (!loginForm || !usernameInput || !passwordInput || !loginBtn || !errorMessage) {
    console.error('[LOGIN] Required DOM elements not found');
    return;
  }

  const showError = (message: string) => {
    errorMessage.textContent = message;
    errorMessage.classList.add('show');
  };

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const username = usernameInput.value.trim();
    const password = passwordInput.value.trim();

    if (!username || !password) {
      showError('请输入用户名和密码');
      return;
    }

    // Disable button and show loading
    loginBtn.disabled = true;
    loginBtn.innerHTML = '<span class="loading"></span>登录中...';
    errorMessage.classList.remove('show');

    try {
      console.log('[LOGIN] Attempting login for user:', username);
      const result = await AuthService.login(username, password);

      if (result.success) {
        console.log('[LOGIN] Login successful, redirecting to main');
        // Success - redirect to main page
        window.location.href = '/main.html';
      } else {
        console.error('[LOGIN] Login failed:', result.error);
        showError(result.error || '登录失败，请检查用户名和密码');
        loginBtn.disabled = false;
        loginBtn.textContent = '登录';
      }
    } catch (error) {
      console.error('[LOGIN] Login error:', error);
      showError('登录失败，请重试');
      loginBtn.disabled = false;
      loginBtn.textContent = '登录';
    }
  });

  console.log('[LOGIN] Login form initialized');
};

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initLogin);
} else {
  initLogin();
}
