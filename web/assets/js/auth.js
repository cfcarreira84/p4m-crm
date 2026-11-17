/**
 * ==============================================================================
 * SDR COCKPIT - AUTENTICAÇÃO (Supabase Auth + RLS)
 * ==============================================================================
 * Login por e-mail e senha. Sem sessão válida, o app não carrega e o RLS do banco
 * bloqueia qualquer leitura/escrita. O nome do operador vem de user_metadata.name.
 * Vanilla JS, sem bundlers. Depende de supabase_client.js (sbSdkClient).
 * ==============================================================================
 */

const AuthGate = (() => {
    let session = null;

    const client = () => (typeof sbSdkClient !== 'undefined' ? sbSdkClient : null);

    function operatorName() {
        const u = session && session.user;
        if (!u) return '';
        const meta = u.user_metadata || {};
        if (meta.name) return meta.name;
        const prefix = String(u.email || '').split('@')[0];
        return prefix ? prefix.charAt(0).toUpperCase() + prefix.slice(1) : 'Operador';
    }

    function accessToken() {
        return session ? session.access_token : null;
    }

    function buildOverlay() {
        const brand = (CockpitConfig && CockpitConfig.brand) || {};
        const el = document.createElement('div');
        el.id = 'auth-overlay';
        el.className = 'auth-overlay';
        el.innerHTML = `
            <form class="auth-card" id="auth-form" autocomplete="on">
                <div class="auth-logo"><i data-lucide="${brand.logoIcon || 'lock'}"></i></div>
                <h1 class="auth-title">${brand.appName || 'CRM'}</h1>
                <p class="auth-sub">${brand.tagline || ''}</p>
                <label class="auth-label" for="auth-email">E-mail</label>
                <input class="auth-input" id="auth-email" type="email" required autocomplete="username" placeholder="voce@empresa.com.br">
                <label class="auth-label" for="auth-pass">Senha</label>
                <input class="auth-input" id="auth-pass" type="password" required autocomplete="current-password" placeholder="••••••••">
                <div class="auth-error" id="auth-error" role="alert"></div>
                <button class="btn-primary auth-submit" id="auth-submit" type="submit">Entrar</button>
            </form>`;
        document.body.appendChild(el);
        if (window.lucide) lucide.createIcons();
        return el;
    }

    function showLogin() {
        return new Promise(resolve => {
            const overlay = document.getElementById('auth-overlay') || buildOverlay();
            overlay.style.display = 'flex';
            const form = overlay.querySelector('#auth-form');
            const err = overlay.querySelector('#auth-error');
            const btn = overlay.querySelector('#auth-submit');
            form.onsubmit = async (e) => {
                e.preventDefault();
                err.textContent = '';
                btn.disabled = true;
                btn.textContent = 'Entrando...';
                const { data, error } = await client().auth.signInWithPassword({
                    email: overlay.querySelector('#auth-email').value.trim(),
                    password: overlay.querySelector('#auth-pass').value
                });
                btn.disabled = false;
                btn.textContent = 'Entrar';
                if (error || !data.session) {
                    err.textContent = 'E-mail ou senha inválidos.';
                    return;
                }
                session = data.session;
                overlay.style.display = 'none';
                resolve(session);
            };
        });
    }

    /** Resolve quando houver sessão válida (restaurada ou via login). */
    async function require() {
        const c = client();
        if (!c) {
            throw new Error('Supabase SDK indisponível: verifique a URL/chave em cockpit_config.js e a conexão com a CDN.');
        }
        c.auth.onAuthStateChange((_event, s) => { session = s; });
        const { data } = await c.auth.getSession();
        if (data && data.session) {
            session = data.session;
            return session;
        }
        return showLogin();
    }

    async function signOut() {
        const c = client();
        if (c) await c.auth.signOut();
        session = null;
        location.reload();
    }

    return { require, signOut, operatorName, accessToken };
})();

if (typeof window !== 'undefined') {
    window.AuthGate = AuthGate;
}
