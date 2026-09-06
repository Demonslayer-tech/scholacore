import './style.css';
import { initTelegramWebApp } from './telegram';

// Bootstraps Telegram Mini App context if present; harmless in a normal
// browser tab. Every page entry point should call this.
initTelegramWebApp();
