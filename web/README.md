# SDR Cockpit - Hospedagem Web

A pasta `web/` é estática (qualquer servidor estático: Vercel, Netlify, Cloudflare Pages, Apache/Nginx, cPanel/HostGator).
Sem `npm install` e sem build. Parametrização gerada a partir de `project.config.json` (via `python tools/setup_projeto.py`) ou diretamente em `assets/js/cockpit_config.js`.
Teste local: `python -m http.server 8080 --directory web`.
