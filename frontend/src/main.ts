import './style.css';
import { renderRegister } from './register';

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <header class="top">
    <strong>Backtester</strong>
    <nav><a href="#prijava">Prijava</a> <a href="#registracija">Registracija</a></nav>
  </header>
  <main class="panels">
    <section id="prijava">
      <h2>Prijava</h2>
      <p id="login-message" class="success" role="status"></p>
    </section>
    <section id="registracija"></section>
  </main>`;

const loginMessage = app.querySelector<HTMLElement>('#login-message')!;

// Po registraciji uporabnika preusmerimo na prijavo s potrditvenim sporočilom.
renderRegister(app.querySelector<HTMLElement>('#registracija')!, (message) => {
  loginMessage.textContent = message;
  location.hash = 'prijava';
});
