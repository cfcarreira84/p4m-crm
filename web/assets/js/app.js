/**
 * ==============================================================================
 * SDR COCKPIT - APLICAÇÃO WEB PRINCIPAL (KANBAN, FORECAST DUAL & DRAG-AND-DROP)
 * ==============================================================================
 */

// Estado Global da Aplicação
const AppState = {
    leads: [],
    selectedLead: null,
    currentView: 'kanban',
    searchTerm: '',
    filterCluster: 'todos',
    filterCidade: 'todas', // filtro por cidade desativado (atuação nacional); filtro por perfil via filterCluster
    filterResp: 'todos',   // 'todos' | nome do operador | '__sem__' (cartão sem responsável)
    filterValor: null,     // null | 'ponderado' | 'potencial' | 'fechados' (botões do cabeçalho)
    mostrarArquivados: false,
    periodMonth: 'todos',
    periodGranularity: 'semana'
};

// Colunas do Kanban (Lidas dinamicamente de CockpitConfig)
const KANBAN_STAGES = (typeof CockpitConfig !== 'undefined' && Array.isArray(CockpitConfig.stages) && CockpitConfig.stages.length > 0)
    ? CockpitConfig.stages
    : [
        { id: 'aguardando_contato', label: 'Aguardando Contato', icon: 'hourglass', color: '#60A5FA', isInitial: true },
        { id: 'declinou', label: 'Declinou', icon: 'archive', color: '#9CA3AF', isLost: true }
    ];

// Inicialização da Aplicação
document.addEventListener('DOMContentLoaded', async () => {
    try {
        await AuthGate.require();
    } catch (e) {
        showSystemAlertModal({ title: 'Falha na autenticação', message: e.message });
        return;
    }
    initApp();
});

// Helpers de fase (lidos de CockpitConfig.stages, sem IDs fixos)
function stageByFlag(flag) {
    return KANBAN_STAGES.find(s => s[flag]) || null;
}
function initialStageId() { const s = stageByFlag('isInitial'); return s ? s.id : KANBAN_STAGES[0].id; }
function lostStageId() { const s = stageByFlag('isLost'); return s ? s.id : 'declinou'; }
function scheduledStageId() { const s = stageByFlag('isScheduled'); return s ? s.id : null; }
function isLostLikeStage(id) { const s = KANBAN_STAGES.find(x => x.id === id); return !!(s && (s.isLost || s.isAlert)); }
function categoryLabel(id) {
    const c = (CockpitConfig.categories || []).find(x => x.id === id);
    return c ? c.label : String(id || '').replace(/_/g, ' ');
}
function operatorName() { return AuthGate.operatorName() || 'Operador'; }
function brandCompanyName() {
    return (typeof CockpitConfig !== 'undefined' && (CockpitConfig.brand?.companyName || CockpitConfig.brand?.appName)) || 'Nossa Empresa';
}
function brandSubtitle() {
    return (typeof CockpitConfig !== 'undefined' && (CockpitConfig.brand?.subtitle || CockpitConfig.brand?.tagline)) || 'soluções e parcerias B2B';
}
// Marcadores de fonte como (site: "...") servem à verificação no servidor; na leitura só atrapalham.
const RE_MARCADOR_FONTE = /\s*\((?:site|contexto do operador|pesquisa pr[eé]via|hist[oó]rico)\b(?:[^"“”()]|["“][^"”]*["”])*\)/gi;
function limparCitacoes(texto) {
    return String(texto || '').replace(RE_MARCADOR_FONTE, '').replace(/\s+([.,;:!?])/g, '$1').replace(/[ \t]{2,}/g, ' ').trim();
}
// O rótulo da tela já diz "Oportunidade a Validar:" e "Proposta Recomendada:"; o prefixo repetido sai.
function semPrefixo(texto, rotulo) {
    return String(texto || '').replace(new RegExp('^\\s*' + rotulo + '\\s*:\\s*', 'i'), '').trim();
}

// Barra de progresso para operações de IA, para ninguém achar que a tela travou. Devolve a função que a remove.
function iniciarProgressoIA(pai, titulo, antesDe = null) {
    const el = document.createElement('div');
    el.className = 'ia-progresso';
    el.innerHTML = `<div class="ia-progresso-topo"><i data-lucide="loader-2" class="spin"></i><strong>${escapeHtml(titulo)}</strong><span class="ia-progresso-tempo">0 s</span></div>
        <div class="ia-barra"><span></span></div>
        <p>Isso pode levar até 1 minuto. Aguarde: a tela não travou.</p>`;
    if (antesDe && antesDe.parentNode === pai) pai.insertBefore(el, antesDe); else pai.appendChild(el);
    const t0 = Date.now();
    const timer = setInterval(() => { el.querySelector('.ia-progresso-tempo').textContent = Math.round((Date.now() - t0) / 1000) + ' s'; }, 500);
    lucide.createIcons();
    return () => { clearInterval(timer); el.remove(); };
}

// Aviso dentro do dossiê (ex.: dados insuficientes para a análise). Some ao reabrir o cartão.
function mostrarAvisoDossie(texto) {
    const card = document.querySelector('.dossier-card');
    if (!card) return;
    card.querySelectorAll('.ia-aviso').forEach(e => e.remove());
    const p = document.createElement('p');
    p.className = 'scout-item ia-aviso';
    p.innerHTML = `<i data-lucide="info"></i> ${escapeHtml(texto)}`;
    card.insertBefore(p, card.querySelector('.dossier-title-row').nextSibling);
    lucide.createIcons();
}

// Leads da base enriquecida já têm pesquisa pronta: a IA só a complementa, sem apagar nada
function daBaseEnriquecida(scout) { return String((scout || {}).origem || '').startsWith('carga'); }
function rotuloAnalise(scout) {
    if (daBaseEnriquecida(scout)) return 'Complementar com IA';
    return (scout || {}).analise_ia ? 'Refazer análise' : 'Gerar análise';
}

// Troca a lista de leads por uma versão recém-lida do banco SEM trocar os objetos: o cartão aberto, o que a IA acabou de
// gravar e as mensagens recém-coladas continuam apontando para o mesmo lead (antes, o evento em tempo real substituía
// tudo e o cartão reabria com a linha do tempo vazia e sem a análise).
function sincronizarLeads(novos) {
    const atuais = new Map(AppState.leads.map(l => [l.id, l]));
    AppState.leads = novos.map(n => {
        const atual = atuais.get(n.id);
        if (!atual) return n;
        Object.assign(atual, n);
        return atual;
    });
    if (AppState.selectedLead) {
        const igual = AppState.leads.find(l => l.id === AppState.selectedLead.id);
        if (igual) AppState.selectedLead = igual;
    }
}

// ---- Matriz de discovery por tipo de cliente (B2B x B2C): rótulos, opções e o campo gravado mudam com a categoria
function matrizDoLead(lead) {
    const cat = (CockpitConfig.categories || []).find(c => c.id === lead.cluster_estrategico) || {};
    const m = CockpitConfig.matrizes || {};
    return m[cat.matriz || 'b2b'] || m.b2b;
}
function campoAfinidade(lead) { return matrizDoLead(lead).afinidade.campo; }

function configurarMatrizDiscovery(lead) {
    const m = matrizDoLead(lead);
    const montar = (selId, labelId, def, valor) => {
        const sel = document.getElementById(selId), lab = document.getElementById(labelId);
        if (!sel) return;
        sel.innerHTML = '';
        sel.add(new Option('Indefinido', 'indefinido'));
        def.opcoes.forEach(([v, t]) => sel.add(new Option(t, v)));
        const valido = def.opcoes.some(([v]) => v === valor);
        sel.value = valido ? valor : 'indefinido';   // valor de outro tipo de cliente não se aplica: volta a indefinido
        if (lab) { lab.textContent = def.label; lab.title = def.dica || ''; }
    };
    montar('select-discovery-interlocutor', 'label-discovery-interlocutor', m.interlocutor, lead.discovery_interlocutor);
    montar('select-discovery-parceria', 'label-discovery-parceria', m.afinidade, lead[m.afinidade.campo]);
}

function prioridadeLabel(id) {
    const p = (CockpitConfig.prioridades || {})[id];
    return p ? p.label : '';
}

// Operadores cadastrados na config (opções do seletor de Responsável)
function operatorNames() {
    return ((CockpitConfig.brand && CockpitConfig.brand.operators) || []).map(o => o.name);
}

// Regra do Responsável: quem move o cartão de fase passa a ser o responsável (o último a mover).
// Devolve os campos a gravar junto com a mudança de fase e já aplica no lead local.
function assumirResponsavel(lead) {
    const nome = operatorName();
    lead.responsavel_operador = nome;
    return { responsavel_operador: nome };
}

// Registra uma ocorrência de sistema na linha do tempo (banco + memória local)
async function registrarEventoSistema(lead, texto) {
    if (typeof SupabaseBridge !== 'undefined' && lead.id) {
        await SupabaseBridge.insertInteraction(lead.id, 'nota_operador', texto, 'system', operatorName());
    }
    if (!lead.timeline) lead.timeline = [];
    lead.timeline.push({
        id: 'evt_' + Date.now(),
        autor: operatorName(),
        tipo: 'nota_operador',
        direcao: 'outbound',
        data: 'Hoje, ' + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
        texto
    });
}

// Atualiza o indicador visual de conexão do Supabase na Navbar
function updateDbStatusPill(status, label, tooltip = '') {
    const pill = document.getElementById('db-status-indicator');
    const txt = document.getElementById('db-status-text');
    if (!pill) return;

    pill.className = `db-status-pill ${status}`;
    if (txt) txt.innerText = label;
    if (tooltip) {
        pill.title = tooltip;
    } else if (label) {
        pill.title = `BD Supabase: ${label}`;
    }
}

// Modal de Integridade e Erro do Sistema / BD
function showSystemAlertModal({ title, message, details = '' }) {
    const modal = document.getElementById('modal-system-alert');
    if (!modal) {
        alert(`${title}\n\n${message}\n\n${details ? 'Detalhes: ' + details : ''}`);
        return;
    }
    document.getElementById('sys-alert-title').innerText = title || 'Aviso do Sistema';
    document.getElementById('sys-alert-message').innerText = message || 'Ocorreu um erro na operação.';
    const detailsEl = document.getElementById('sys-alert-details');
    if (details) {
        detailsEl.style.display = 'block';
        detailsEl.innerText = details;
    } else {
        detailsEl.style.display = 'none';
    }
    modal.classList.add('active');
    lucide.createIcons();
}

function closeSystemAlertModal() {
    const modal = document.getElementById('modal-system-alert');
    if (modal) modal.classList.remove('active');
}

async function initApp() {
    renderBrandHeader();
    setupKanbanColumns();
    setupNavigation();
    setupFilters();
    setupModals();
    setupCardEnhancements();
    setupKanbanDropZones();
    setupPeriodControls();

    // Listener para fechar o Modal de Alerta do Sistema
    const btnCloseAlert = document.getElementById('btn-close-sys-alert');
    if (btnCloseAlert) btnCloseAlert.addEventListener('click', closeSystemAlertModal);
    const modalAlert = document.getElementById('modal-system-alert');
    if (modalAlert) {
        modalAlert.addEventListener('click', (e) => {
            if (e.target === modalAlert) closeSystemAlertModal();
        });
    }

    // 1. Boot imediato a partir do cache IndexedDB local (conexões lentas abrem na hora)
    updateDbStatusPill('connecting', 'Sincronizando...');
    let leadsLoaded = false;

    if (typeof CockpitStore !== 'undefined') {
        const cached = await CockpitStore.getCachedLeads();
        if (Array.isArray(cached) && cached.length > 0) {
            sincronizarLeads(cached);
            leadsLoaded = true;
            renderKanban();
            updateGlobalMetrics();
            updateDbStatusPill('connecting', `Sincronizando (${cached.length})...`, 'Exibindo cache local enquanto sincroniza o delta com o Supabase');
        }
    }

    if (typeof SupabaseBridge !== 'undefined') {
        const syncRes = (typeof CockpitStore !== 'undefined')
            ? await CockpitStore.syncWithServer(AppState.leads)
            : await SupabaseBridge.fetchLeads().then(r => ({ success: r.success, leads: r.data, error: r.error, mode: 'full' }));

        if (syncRes.success && Array.isArray(syncRes.leads)) {
            console.log(`⚡ Leads sincronizados (${syncRes.mode || 'full'}):`, syncRes.leads.length);
            sincronizarLeads(syncRes.leads);
            leadsLoaded = true;
            updateDbStatusPill('online', `BD Conectado (${syncRes.leads.length})`, 'Supabase PostgreSQL conectado e sincronizado via Delta Sync + Realtime');
        } else {
            const errStr = syncRes.error || "Nenhum dado retornado";
            console.error("Falha ao sincronizar com o Supabase:", errStr);
            updateDbStatusPill('offline', 'BD Offline', `Erro: ${errStr}`);
            showToast(`⚠️ Supabase Offline: ${errStr}`, 'error', 6000);
            if (!leadsLoaded) {
                showSystemAlertModal({
                    title: "Falha de Conexão com o Supabase",
                    message: `O ${brandCompanyName()} não conseguiu carregar a lista de empresas do banco de dados na inicialização.`,
                    details: errStr
                });
            }
        }

        // Ativa Sincronização Realtime in-place (sem refazer download completo da base)
        let renderTimer = null;
        SupabaseBridge.subscribe(async (payload) => {
            if (typeof CockpitStore !== 'undefined') {
                const applied = await CockpitStore.applyRealtimePayload(AppState.leads, payload);
                if (applied.updated) {
                    AppState.leads = applied.leads;
                    clearTimeout(renderTimer);
                    renderTimer = setTimeout(() => {
                        renderKanban();
                        updateGlobalMetrics();
                    }, 350);
                    return;
                }
            }
            clearTimeout(renderTimer);
            renderTimer = setTimeout(async () => {
                if (typeof CockpitStore !== 'undefined') {
                    const delta = await CockpitStore.syncWithServer(AppState.leads);
                    if (delta.success && Array.isArray(delta.leads)) {
                        sincronizarLeads(delta.leads);
                        renderKanban();
                        updateGlobalMetrics();
                    }
                }
            }, 1200);
        });
    }

    if (!leadsLoaded) {
        try {
            const stored = localStorage.getItem('sdr_leads_v2');
            if (stored) {
                AppState.leads = JSON.parse(stored);
                showToast("Aviso: Exibindo dados locais do navegador (Cache)", "error", 5000);
            }
        } catch (e) {}
    }

    renderKanban();
    updateGlobalMetrics();
}

function saveState() {
    if (typeof CockpitStore !== 'undefined' && AppState.selectedLead) {
        CockpitStore.putLeads([AppState.selectedLead]);
    }
    try {
        // Guarda versão enxuta (sem timeline pesada) como fallback secundário
        const lean = AppState.leads.slice(0, 300).map(l => ({ ...l, timeline: [] }));
        localStorage.setItem('sdr_leads_v2', JSON.stringify(lean));
    } catch (e) {}
    updateGlobalMetrics();
}

// 0. Renderização da Marca, Logo e Versão (Dinâmico via CockpitConfig)
function renderBrandHeader() {
    if (typeof CockpitConfig === 'undefined' || !CockpitConfig.brand) return;
    const b = CockpitConfig.brand;

    const logoIconEl = document.querySelector('.logo-icon');
    if (logoIconEl && b.logoIcon) {
        logoIconEl.innerHTML = `<i data-lucide="${b.logoIcon}"></i>`;
        logoIconEl.title = b.productName || b.appName || 'SDR Cockpit';
    }
    document.title = `${b.appName} | ${b.tagline || ''}`;

    const versionBadge = document.getElementById('cockpit-version-badge');
    if (versionBadge && b.version) {
        versionBadge.innerText = b.version;
    }

    const versionList = document.querySelector('.version-list');
    if (versionList && Array.isArray(b.versionHistory) && b.versionHistory.length > 0) {
        versionList.innerHTML = '';
        b.versionHistory.forEach((v, idx) => {
            const item = document.createElement('div');
            item.className = `version-item ${idx === 0 ? 'current' : ''}`;
            item.innerHTML = `
                <div class="version-item-top">
                    <span class="version-tag">${v.tag}</span>
                    ${idx === 0 ? '<span class="version-badge-status">Atual</span>' : ''}
                    <span class="version-commit">${v.commit || ''}</span>
                </div>
                <p class="version-desc">${v.desc || ''}</p>
            `;
            versionList.appendChild(item);
        });
    }

    const opName = operatorName();
    const userNameEl = document.querySelector('.user-name');
    if (userNameEl) userNameEl.innerText = opName;
    const avatarEl = document.querySelector('.user-profile .avatar');
    if (avatarEl) avatarEl.innerText = opName.substring(0, 2).toUpperCase();
    const btnLogout = document.getElementById('btn-logout');
    if (btnLogout) btnLogout.addEventListener('click', () => AuthGate.signOut());
}

// 0.1. Renderização das Colunas do Kanban (Dinâmico via CockpitConfig.stages)
function setupKanbanColumns() {
    const board = document.getElementById('kanban-board');
    if (!board) return;

    if (typeof CockpitConfig !== 'undefined' && Array.isArray(CockpitConfig.stages) && CockpitConfig.stages.length > 0) {
        board.innerHTML = '';
        CockpitConfig.stages.forEach(st => {
            const col = document.createElement('div');
            col.className = 'kanban-col';
            col.dataset.status = st.id;
            col.innerHTML = `
                <div class="col-header" style="border-top: 3px solid ${st.color || '#3B82F6'}; color: ${st.color || 'inherit'};">
                    <div class="col-header-top">
                        <span class="col-title"><i data-lucide="${st.icon || 'circle'}"></i> ${st.label}</span>
                        <span class="count-badge" id="count-${st.id}">0</span>
                    </div>
                    <div class="col-pipe-val" id="pipe-val-${st.id}">Pipe: R$ 0</div>
                </div>
                <div class="col-cards" id="cards-${st.id}"></div>
            `;
            board.appendChild(col);
        });
    }
}

// 1. Navegação de Abas
function setupNavigation() {
    const tabKanban = document.getElementById('tab-kanban');
    const tabPipeline = document.getElementById('tab-pipeline');
    const viewKanban = document.getElementById('view-kanban');
    const viewPipeline = document.getElementById('view-pipeline');

    tabKanban.addEventListener('click', () => {
        tabKanban.classList.add('active');
        tabPipeline.classList.remove('active');
        viewKanban.classList.add('active');
        viewPipeline.classList.remove('active');
        AppState.currentView = 'kanban';
    });

    tabPipeline.addEventListener('click', () => {
        tabPipeline.classList.add('active');
        tabKanban.classList.remove('active');
        viewPipeline.classList.add('active');
        viewKanban.classList.remove('active');
        AppState.currentView = 'pipeline';
        renderPipelineView();
    });

    document.getElementById('btn-rodar-monte-carlo').addEventListener('click', () => {
        renderPipelineView();
    });
}

// 2. Filtros e Busca (Dinâmicos via CockpitConfig)
function setupFilters() {
    const inputBusca = document.getElementById('input-filtro-busca');
    const selectCluster = document.getElementById('select-filtro-cluster');
    const selectCidade = document.getElementById('select-filtro-cidade');

    // Popula perfis (clusters) a partir de CockpitConfig.categories
    const cats = (typeof CockpitConfig !== 'undefined' && Array.isArray(CockpitConfig.categories)) ? CockpitConfig.categories : [];
    if (selectCluster) {
        selectCluster.innerHTML = '<option value="todos">Todos os Perfis</option>';
        cats.forEach(cat => {
            const opt = document.createElement('option');
            opt.value = cat.id;
            opt.innerText = cat.label || cat.id;
            selectCluster.appendChild(opt);
        });
    }

    // Filtro por cidade removido: atuação em todo o território nacional
    if (selectCidade) selectCidade.style.display = 'none';

    // Popula dropdown do modal de novo lead
    const novoLeadCluster = document.getElementById('novo-lead-cluster');
    if (novoLeadCluster) {
        novoLeadCluster.innerHTML = '';
        cats.forEach(cat => {
            const opt = document.createElement('option');
            opt.value = cat.id;
            opt.innerText = cat.label || cat.id;
            novoLeadCluster.appendChild(opt);
        });
    }

    inputBusca.addEventListener('input', (e) => {
        AppState.searchTerm = e.target.value.toLowerCase();
        renderKanban();
    });

    selectCluster.addEventListener('change', (e) => {
        AppState.filterCluster = e.target.value;
        renderKanban();
    });

    const selectResp = document.getElementById('select-filtro-responsavel');
    if (selectResp) {
        selectResp.addEventListener('change', (e) => {
            AppState.filterResp = e.target.value;
            renderKanban();
        });
    }

    // Botões do cabeçalho: clicar filtra os cartões daquele valor; clicar de novo (ou no chip) remove o filtro
    document.querySelectorAll('[data-filtro-valor]').forEach(btn => {
        btn.addEventListener('click', () => {
            const alvo = btn.dataset.filtroValor;
            definirFiltroValor(AppState.filterValor === alvo ? null : alvo);
            if (AppState.filterValor) document.getElementById('tab-kanban')?.click();   // os cartões estão no Kanban
        });
    });
    const chip = document.getElementById('chip-filtro-valor');
    if (chip) chip.addEventListener('click', () => definirFiltroValor(null));


    const checkArquivados = document.getElementById('check-mostrar-arquivados');
    if (checkArquivados) {
        checkArquivados.addEventListener('change', (e) => {
            AppState.mostrarArquivados = e.target.checked;
            renderKanban();
        });
    }
}

const ROTULO_FILTRO_VALOR = { ponderado: 'Forecast Ponderado', potencial: 'Potencial Funil', fechados: 'Negócios Fechados' };

function definirFiltroValor(valor) {
    AppState.filterValor = valor;
    document.querySelectorAll('[data-filtro-valor]').forEach(btn => {
        const ativo = btn.dataset.filtroValor === valor;
        btn.classList.toggle('ativo', ativo);
        btn.setAttribute('aria-pressed', ativo ? 'true' : 'false');
    });
    const chip = document.getElementById('chip-filtro-valor');
    if (chip) {
        chip.hidden = !valor;
        chip.textContent = valor ? `Filtrando: ${ROTULO_FILTRO_VALOR[valor]} ✕` : '';
    }
    renderKanban();
}

// Opções do filtro de responsável: operadores da configuração + quem já consta em algum cartão + "Sem responsável"
let assinaturaOpcoesResp = '';
function atualizarOpcoesResponsavel() {
    const sel = document.getElementById('select-filtro-responsavel');
    if (!sel) return;
    const nomes = [...new Set([...operatorNames(), ...AppState.leads.map(l => l.responsavel_operador).filter(Boolean)])];
    const assinatura = nomes.join('|');
    if (assinatura === assinaturaOpcoesResp) return;
    assinaturaOpcoesResp = assinatura;
    sel.innerHTML = '<option value="todos">Todos os Responsáveis</option>'
        + nomes.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('')
        + '<option value="__sem__">Sem responsável</option>';
    sel.value = nomes.includes(AppState.filterResp) || AppState.filterResp === '__sem__' ? AppState.filterResp : 'todos';
}

// 3. Setup de Drop Zones do Kanban (Drag & Drop)
function setupKanbanDropZones() {
    document.querySelectorAll('.kanban-col').forEach(col => {
        col.addEventListener('dragover', (e) => {
            e.preventDefault();
            col.classList.add('drag-over');
        });

        col.addEventListener('dragleave', () => {
            col.classList.remove('drag-over');
        });

        col.addEventListener('drop', async (e) => {
            e.preventDefault();
            col.classList.remove('drag-over');
            const leadId = e.dataTransfer.getData('text/plain');
            const targetStatus = col.dataset.status;
            if (leadId && targetStatus) {
                await window.alterarFaseCard(leadId, targetStatus);
            }
        });
    });
}

// Retorna os leads filtrados de acordo com os filtros globais ativos
function getFilteredLeads() {
    return AppState.leads.filter(lead => {
        const isArq = lead.is_arquivado || lead.status_venda === 'venda_realizada';
        // "Negócios Fechados" mostra justamente os cartões de venda realizada, mesmo com o toggle de arquivados desligado
        if (!AppState.mostrarArquivados && isArq && AppState.filterValor !== 'fechados') {
            return false;
        }
        if (AppState.filterValor && MonteCarloEngine.classificarForecast(lead) !== AppState.filterValor) return false;
        if (AppState.filterResp === '__sem__' ? !!lead.responsavel_operador
            : AppState.filterResp !== 'todos' && lead.responsavel_operador !== AppState.filterResp) return false;

        const matchSearch = (lead.nome_fantasia || '').toLowerCase().includes(AppState.searchTerm) ||
                            (lead.whatsapp_disparo || '').includes(AppState.searchTerm) ||
                            (lead.cluster_estrategico || '').toLowerCase().includes(AppState.searchTerm);
        const matchCluster = AppState.filterCluster === 'todos' || lead.cluster_estrategico === AppState.filterCluster;
        const matchCidade = AppState.filterCidade === 'todas' || lead.cidade === AppState.filterCidade;
        return matchSearch && matchCluster && matchCidade;
    }).sort((a, b) => MonteCarloEngine.compareLeads(a, b)); // maior pontuação do Monte Carlo primeiro
}

// Retorna os leads pertencentes à respectiva lista (coluna/fase Kanban do lead)
function getRespectiveListForLead(lead) {
    if (!lead) return [];
    const filtered = getFilteredLeads();
    const stage = lead.status_kanban || initialStageId();
    const stageLeads = filtered.filter(l => (l.status_kanban || initialStageId()) === stage);
    return stageLeads.length > 0 ? stageLeads : filtered;
}

// Atualiza o contador e estado dos botões de navegação no header do modal
function updateModalNavCounter(lead) {
    const counterEl = document.getElementById('modal-nav-counter');
    const prevBtn = document.getElementById('btn-modal-nav-prev');
    const nextBtn = document.getElementById('btn-modal-nav-next');
    if (!counterEl || !lead) return;

    const list = getRespectiveListForLead(lead);
    const idx = list.findIndex(l => l.id === lead.id);

    if (idx === -1) {
        counterEl.innerText = `- / ${list.length}`;
        if (prevBtn) prevBtn.disabled = true;
        if (nextBtn) nextBtn.disabled = true;
        return;
    }

    counterEl.innerText = `${idx + 1} de ${list.length}`;
    if (prevBtn) prevBtn.disabled = (idx === 0);
    if (nextBtn) nextBtn.disabled = (idx === list.length - 1);
}

// Navega sequencialmente entre os cartões da respectiva lista
function navegarCardModal(direction) {
    if (!AppState.selectedLead) return;
    const list = getRespectiveListForLead(AppState.selectedLead);
    const idx = list.findIndex(l => l.id === AppState.selectedLead.id);
    if (idx === -1) return;

    const newIdx = idx + direction;
    if (newIdx >= 0 && newIdx < list.length) {
        abrirModalLead(list[newIdx].id);
    }
}

// 4. Renderização do Kanban Board
function renderKanban() {
    atualizarOpcoesResponsavel();
    // Limpa colunas e contadores
    KANBAN_STAGES.forEach(st => {
        const container = document.getElementById(`cards-${st.id}`);
        if (container) container.innerHTML = '';
        const countBadge = document.getElementById(`count-${st.id}`);
        if (countBadge) countBadge.innerText = '0';
        const pipeBadge = document.getElementById(`pipe-val-${st.id}`);
        if (pipeBadge) pipeBadge.innerText = 'Pipe: R$ 0';
    });

    // Atualiza badge de contagem de arquivados
    const totalArquivados = AppState.leads.filter(l => l.is_arquivado || l.status_venda === 'venda_realizada').length;
    const countArqBadge = document.getElementById('count-arquivados-badge');
    if (countArqBadge) countArqBadge.innerText = totalArquivados;

    // Filtra leads respeitando termos de busca, cluster, cidade e arquivados
    const filteredLeads = getFilteredLeads();

    // Totais e Pipes por coluna
    const counts = {};
    const pipeSums = {};
    KANBAN_STAGES.forEach(st => {
        counts[st.id] = 0;
        pipeSums[st.id] = 0;
    });

    filteredLeads.forEach(lead => {
        const colId = lead.status_kanban || initialStageId();
        const tkt = (lead.ticket_estimado !== undefined && lead.ticket_estimado !== null && !isNaN(Number(lead.ticket_estimado)))
            ? Number(lead.ticket_estimado)
            : 0;

        if (counts[colId] !== undefined) {
            counts[colId]++;
            pipeSums[colId] += tkt;
        }

        const card = createLeadCardElement(lead);
        const container = document.getElementById(`cards-${colId}`);
        if (container) container.appendChild(card);
    });

    // Atualiza badges de contagem e valores do Pipe por coluna
    KANBAN_STAGES.forEach(st => {
        const countBadge = document.getElementById(`count-${st.id}`);
        if (countBadge) countBadge.innerText = counts[st.id] || 0;

        const pipeBadge = document.getElementById(`pipe-val-${st.id}`);
        if (pipeBadge) {
            pipeBadge.innerText = `Pipe: R$ ${(pipeSums[st.id] || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
        }
    });

    lucide.createIcons();
}

// 5. Criação do Elemento Card do Lead
function createLeadCardElement(lead) {
    const card = document.createElement('div');
    card.className = 'lead-card';
    card.dataset.id = lead.id;
    card.draggable = true;

    const isArquivado = lead.is_arquivado || lead.status_venda === 'venda_realizada';
    if (isArquivado) {
        card.classList.add('card-arquivado');
    }

    // Listeners de Drag & Drop
    card.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', lead.id);
        card.classList.add('dragging');
    });

    card.addEventListener('dragend', () => {
        card.classList.remove('dragging');
    });

    const prob = (MonteCarloEngine.calculateLeadProbability(lead) * 100).toFixed(0);
    const clusterLabel = categoryLabel(lead.cluster_estrategico);
    const currentTicket = (lead.ticket_estimado !== undefined && lead.ticket_estimado !== null && !isNaN(Number(lead.ticket_estimado)))
        ? Number(lead.ticket_estimado)
        : 0;

    // Ação de Venda Realizada / Arquivado no Topo do Card
    const headerActionHtml = isArquivado ? `
        <div class="card-header-action-row" onclick="event.stopPropagation()">
            <span class="badge-arquivado">🏆 Venda Fechada</span>
            <button class="btn-card-desarquivar" onclick="window.desarquivarLead('${lead.id}')" title="Reativar lead no Kanban">Desarquivar</button>
        </div>
    ` : `
        <div class="card-header-action-row" onclick="event.stopPropagation()">
            <button class="btn-card-venda" onclick="window.marcarVendaRealizada('${lead.id}')" title="Marcar Venda Realizada e Arquivar Cartão">
                <i data-lucide="check-check" style="width:11px;height:11px;"></i> Venda Realizada
            </button>
        </div>
    `;

    // Dropdown de seleção rápida de fase
    let optionsHtml = '';
    KANBAN_STAGES.forEach(st => {
        const selected = st.id === lead.status_kanban ? 'selected' : '';
        optionsHtml += `<option value="${st.id}" ${selected}>${st.label}</option>`;
    });

    // Campo de data de retorno (apenas para Programado ou se já houver data)
    const isProgramado = lead.status_kanban === scheduledStageId();
    const dateVal = lead.data_reativacao_programada || '';
    const touchpointHtml = isProgramado ? `
        <div class="card-touchpoint-field" onclick="event.stopPropagation()">
            <label><i data-lucide="calendar" style="width:12px;height:12px;"></i> Retorno:</label>
            <input type="date" class="card-date-input" value="${dateVal}" onchange="window.alterarDataRetornoCard('${lead.id}', this.value)" />
        </div>
    ` : '';

    card.innerHTML = `
        ${headerActionHtml}
        <div class="card-top">
            <span class="card-title">${lead.nome_fantasia}</span>
            <div class="card-ticket-field" onclick="event.stopPropagation()" title="Clique para editar o ticket base deste lead (permite valor 0)">
                <label>R$</label>
                <input type="number" class="card-ticket-input" id="input-tkt-${lead.id}" value="${currentTicket}" step="100" min="0" onchange="window.alterarTicketCard('${lead.id}', this.value)" />
            </div>
        </div>

        <div class="card-cluster">${escapeHtml(clusterLabel)}${lead.cidade && lead.cidade !== 'Brasil' ? ' • ' + escapeHtml(lead.cidade) : ''}${lead.responsavel_operador ? ` • <span class="card-resp"><i data-lucide="user-round" style="width:10px;height:10px;"></i> ${escapeHtml(lead.responsavel_operador)}</span>` : ''}</div>

        <div class="card-meta">
            <span class="meta-badge prob" title="Probabilidade de fechamento calculada pelo Monte Carlo"><i data-lucide="percent" style="width:10px;height:10px;"></i> ${prob}% de fechamento</span>
            ${lead.prioridade_carga ? `<span class="meta-badge prio-${lead.prioridade_carga}" title="Prioridade da base${lead.pontuacao_carga != null ? ' • ' + lead.pontuacao_carga + ' pontos' : ''}">${escapeHtml(prioridadeLabel(lead.prioridade_carga))}</span>` : ''}
            ${!lead.whatsapp_disparo ? '<span class="meta-badge sem-zap" title="Sem WhatsApp: buscar contato por e-mail, site ou Instagram">Sem WhatsApp</span>' : ''}
            ${(() => { const sp = lead.pre_analise_scout?.status_presenca; return sp && sp.length <= 32 ? `<span class="meta-badge">${escapeHtml(sp)}</span>` : ''; })()}
            ${(() => {
                const rawSite = (lead.website_original || lead.website || lead.pre_analise_scout?.website || "").trim();
                const hasSite = rawSite && !rawSite.toLowerCase().includes('não possui') && !rawSite.toLowerCase().includes('ausente');
                if (!hasSite) return '';
                const siteUrl = (rawSite.startsWith('http://') || rawSite.startsWith('https://')) ? rawSite : 'https://' + rawSite;
                return `<a href="${siteUrl}" target="_blank" rel="noopener noreferrer" class="meta-badge site-link" onclick="event.stopPropagation()" title="Abrir site oficial: ${siteUrl}"><i data-lucide="globe" style="width:10px;height:10px;"></i> Site ↗</a>`;
            })()}
        </div>

        <!-- Seletor Rápido de Fase (Dropdown) -->
        <div class="card-stage-select-wrap" onclick="event.stopPropagation()" title="Mudar fase do lead">
            <label><i data-lucide="move" style="width:12px;height:12px;"></i> Fase:</label>
            <select class="card-stage-select" id="select-stage-${lead.id}" onchange="window.alterarFaseCard('${lead.id}', this.value)">
                ${optionsHtml}
            </select>
        </div>

        <!-- Touchpoint Programado -->
        ${touchpointHtml}

        <div class="card-actions">
            <button class="btn-card-zap" onclick="event.stopPropagation(); dispararWhatsAppWeb('${lead.id}')" title="Copiar texto e abrir WhatsApp Web">
                <i data-lucide="message-circle" style="width:14px;height:14px;"></i> WhatsApp
            </button>
            <button class="btn-card-save" id="btn-save-${lead.id}" onclick="event.stopPropagation(); window.salvarAlteracoesCard('${lead.id}')" title="Gravar alterações no banco Supabase">
                <i data-lucide="save" style="width:14px;height:14px;"></i> Salvar
            </button>
        </div>
    `;

    card.addEventListener('click', () => {
        abrirModalLead(lead.id);
    });

    return card;
}

// 6. Funções de Ação Globais nos Cards

// Alteração de Ticket Base (Suporta valor 0 estritamente)
window.alterarTicketCard = function(leadId, newTicket) {
    const lead = AppState.leads.find(l => l.id === leadId);
    if (!lead) return;
    
    const trimmed = String(newTicket).trim();
    let val;
    if (trimmed === '0') {
        val = 0;
    } else {
        const num = Number(trimmed);
        val = (!isNaN(num) && trimmed !== '') ? num : 0;
    }
    
    lead.ticket_estimado = val;
    saveState();
    updateGlobalMetrics();
    renderKanban();
};

// Alteração de Fase (via Dropdown ou Drag & Drop)
window.alterarFaseCard = async function(leadId, newStatus) {
    const lead = AppState.leads.find(l => l.id === leadId);
    if (!lead || lead.status_kanban === newStatus) return;

    const oldStatus = lead.status_kanban;
    lead.status_kanban = newStatus;
    if (newStatus === scheduledStageId() && !lead.data_reativacao_programada) {
        lead.data_reativacao_programada = '';
    }

    const calcProbFase = MonteCarloEngine.calculateLeadProbability(lead);
    lead.probabilidade_montecarlo = Number(calcProbFase.toFixed(4));
    const oldResp = lead.responsavel_operador;

    if (typeof SupabaseBridge !== 'undefined' && lead.id) {
        const res = await SupabaseBridge.updateLead(lead.id, {
            status_kanban: newStatus,
            data_reativacao_programada: lead.data_reativacao_programada,
            probabilidade_montecarlo: lead.probabilidade_montecarlo,
            ...assumirResponsavel(lead)
        });
        if (!res.success) {
            lead.status_kanban = oldStatus;
            lead.responsavel_operador = oldResp;
            renderKanban();
            showSystemAlertModal({
                title: "Falha ao Mover Card no Banco de Dados",
                message: `O Supabase recusou a atualização de fase para o lead "${lead.nome_fantasia}". O card retornou para a coluna anterior.`,
                details: res.error
            });
            showToast(`❌ Falha no BD: ${res.error}`, 'error', 6000);
            return;
        }
    }

    saveState();
    renderKanban();
    updateGlobalMetrics();
    showToast(`Fase atualizada com sucesso no BD!`);
};

// Alteração de Data de Retorno
window.alterarDataRetornoCard = function(leadId, newDate) {
    const lead = AppState.leads.find(l => l.id === leadId);
    if (!lead) return;
    lead.data_reativacao_programada = newDate;
    saveState();
};

// Salvar Alterações do Card no Banco Supabase (Permite salvar valor 0)
window.salvarAlteracoesCard = async function(leadId) {
    const lead = AppState.leads.find(l => l.id === leadId);
    if (!lead) return;

    // Captura o valor diretamente do input do card
    const inputTkt = document.getElementById(`input-tkt-${leadId}`);
    if (inputTkt) {
        const trimmed = String(inputTkt.value).trim();
        if (trimmed === '0') {
            lead.ticket_estimado = 0;
        } else {
            const num = Number(trimmed);
            if (!isNaN(num) && trimmed !== '') lead.ticket_estimado = num;
        }
    }

    const btn = document.getElementById(`btn-save-${leadId}`);
    if (btn) {
        btn.innerHTML = `<i data-lucide="loader-2" class="spin" style="width:14px;height:14px;"></i> Salvando...`;
    }

    const calcProbCard = MonteCarloEngine.calculateLeadProbability(lead);
    lead.probabilidade_montecarlo = Number(calcProbCard.toFixed(4));

    if (typeof SupabaseBridge !== 'undefined' && lead.id) {
        const res = await SupabaseBridge.updateLead(lead.id, {
            ticket_estimado: lead.ticket_estimado,
            status_kanban: lead.status_kanban,
            data_reativacao_programada: lead.data_reativacao_programada,
            probabilidade_montecarlo: lead.probabilidade_montecarlo
        });

        if (!res.success) {
            if (btn) {
                btn.classList.add('btn-error-state');
                btn.innerHTML = `<i data-lucide="alert-octagon" style="width:14px;height:14px;"></i> Erro!`;
                setTimeout(() => {
                    btn.classList.remove('btn-error-state');
                    btn.innerHTML = `<i data-lucide="save" style="width:14px;height:14px;"></i> Salvar`;
                    lucide.createIcons();
                }, 3000);
            }
            showSystemAlertModal({
                title: "Falha ao Salvar Card no Banco de Dados",
                message: `Não foi possível salvar as alterações de "${lead.nome_fantasia}" no Supabase. O frontend não salvará falsamente.`,
                details: res.error
            });
            showToast(`❌ Falha no BD: ${res.error}`, 'error', 6000);
            return;
        }

        if (res.data) Object.assign(lead, res.data);
    }

    saveState();
    updateGlobalMetrics();
    renderKanban();

    const updatedBtn = document.getElementById(`btn-save-${leadId}`);
    if (updatedBtn) {
        updatedBtn.classList.add('saved');
        updatedBtn.innerHTML = `<i data-lucide="check" style="width:14px;height:14px;"></i> Salvo!`;
        setTimeout(() => {
            updatedBtn.classList.remove('saved');
            updatedBtn.innerHTML = `<i data-lucide="save" style="width:14px;height:14px;"></i> Salvar`;
            lucide.createIcons();
        }, 2000);
    }
    showToast("💾 Alterações gravadas no banco de dados com sucesso!");
};

// Marcar Venda Realizada e Arquivar Cartão
window.marcarVendaRealizada = async function(leadId) {
    const lead = AppState.leads.find(l => l.id === leadId);
    if (!lead) return;

    const tkt = (lead.ticket_estimado !== undefined && lead.ticket_estimado !== null && !isNaN(Number(lead.ticket_estimado)))
        ? Number(lead.ticket_estimado)
        : 0;

    const confirmMsg = `Confirmar Venda Realizada para "${lead.nome_fantasia}"?\n\n• Valor da Venda: R$ ${tkt.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}\n• O cartão será arquivado do Kanban ativo\n• A receita será registrada em "Negócios Fechados"`;
    if (!confirm(confirmMsg)) return;

    lead.is_arquivado = true;
    lead.status_venda = 'venda_realizada';
    lead.valor_fechado = tkt;
    lead.data_fechamento_venda = new Date().toISOString();

    // Fecha o modal caso esteja aberto
    const modal = document.getElementById('modal-lead-details');
    if (modal) modal.classList.remove('active');

    // Salva no Supabase com validação estrita
    if (typeof SupabaseBridge !== 'undefined' && lead.id) {
        const res = await SupabaseBridge.updateLead(lead.id, {
            is_arquivado: true,
            status_venda: 'venda_realizada',
            valor_fechado: lead.valor_fechado,
            data_fechamento_venda: lead.data_fechamento_venda
        });

        if (!res.success) {
            showSystemAlertModal({
                title: "Falha ao Registrar Venda no Banco de Dados",
                message: `O Supabase recusou a gravação da venda para o lead "${lead.nome_fantasia}". O cartão NÃO foi arquivado.`,
                details: res.error
            });
            showToast(`❌ Erro no BD: ${res.error}`, 'error', 6000);
            return;
        }

        await SupabaseBridge.insertInteraction(lead.id, 'venda_realizada', `🎉 Venda Realizada no valor de R$ ${tkt.toLocaleString('pt-BR')}. Lead arquivado com sucesso.`, 'system', operatorName());
    }

    saveState();
    updateGlobalMetrics();
    renderKanban();
    if (AppState.currentView === 'pipeline') {
        renderPipelineView();
    }
    showToast(`🎉 Venda Realizada para ${lead.nome_fantasia}! Cartão arquivado.`);
};

// Desarquivar Lead
window.desarquivarLead = async function(leadId) {
    const lead = AppState.leads.find(l => l.id === leadId);
    if (!lead) return;
    if (!confirm(`Deseja desarquivar "${lead.nome_fantasia}" e retornar ao Kanban ativo?`)) return;

    if (typeof SupabaseBridge !== 'undefined' && lead.id) {
        const res = await SupabaseBridge.updateLead(lead.id, {
            is_arquivado: false,
            status_venda: 'em_aberto'
        });

        if (!res.success) {
            showSystemAlertModal({
                title: "Falha ao Desarquivar no Banco de Dados",
                message: `O Supabase não confirmou o desarquivamento de "${lead.nome_fantasia}".`,
                details: res.error
            });
            showToast(`❌ Erro no BD: ${res.error}`, 'error', 6000);
            return;
        }
    }

    lead.is_arquivado = false;
    lead.status_venda = 'em_aberto';

    saveState();
    updateGlobalMetrics();
    renderKanban();
    if (AppState.currentView === 'pipeline') {
        renderPipelineView();
    }
    showToast(`Cartão de ${lead.nome_fantasia} retornado ao Kanban.`);
};

// Descartar e Arquivar Lead (Sem Venda Realizada - Fora do ICP / Duplicidade / Sem Fit)
window.descartarLead = async function(leadId) {
    const lead = AppState.leads.find(l => l.id === leadId);
    if (!lead) return;

    const confirmMsg = `Confirmar descarte e arquivamento de "${lead.nome_fantasia}"?\n\n• O cartão será arquivado do Kanban ativo\n• Não será contabilizado em Vendas Realizadas nem no Forecast\n• Motivo: Fora do ICP / Duplicidade / Sem Fit Comercial`;
    if (!confirm(confirmMsg)) return;

    lead.is_arquivado = true;
    lead.status_venda = 'descartado';
    lead.valor_fechado = 0;
    lead.status_kanban = lostStageId();

    // Fecha o modal caso esteja aberto
    const modal = document.getElementById('modal-lead-details');
    if (modal) modal.classList.remove('active');

    if (typeof SupabaseBridge !== 'undefined' && lead.id) {
        const res = await SupabaseBridge.updateLead(lead.id, {
            is_arquivado: true,
            status_venda: 'descartado',
            valor_fechado: 0,
            status_kanban: lostStageId(),
            ...assumirResponsavel(lead)
        });

        if (!res.success) {
            showSystemAlertModal({
                title: "Falha ao Descartar Lead no Banco de Dados",
                message: `O Supabase recusou o descarte do lead "${lead.nome_fantasia}". O cartão NÃO foi arquivado.`,
                details: res.error
            });
            showToast(`❌ Erro no BD: ${res.error}`, 'error', 6000);
            return;
        }

        await SupabaseBridge.insertInteraction(lead.id, 'nota_operador', `📦 Lead descartado e arquivado da visão ativa (fora do ICP / duplicidade / sem fit comercial).`, 'system', operatorName());
    }

    saveState();
    updateGlobalMetrics();
    renderKanban();
    if (AppState.currentView === 'pipeline') {
        renderPipelineView();
    }
    showToast(`📦 Lead "${lead.nome_fantasia}" descartado e arquivado com sucesso.`);
};

// Copia a mensagem e abre o WhatsApp Web. Lead sem WhatsApp: só copia e orienta a busca manual.
function copiarEAbrirWhatsApp(lead, mensagem) {
    const zapClean = String(lead.whatsapp_disparo || '').replace(/\D/g, '');
    return navigator.clipboard.writeText(mensagem).then(() => {
        if (!zapClean) {
            showToast('Mensagem copiada. Este lead não tem WhatsApp: use o e-mail, o Instagram ou o site do cartão e preencha o número no lápis.', 'warning', 7000);
            return;
        }
        window.open(`https://web.whatsapp.com/send?phone=${zapClean}&text=${encodeURIComponent(mensagem)}`, '_blank');
    }).catch(err => {
        console.error("Falha ao copiar:", err);
    });
}

// 7. Disparo Direto de WhatsApp Web (1-Clique a partir do Card)
window.dispararWhatsAppWeb = function(leadId) {
    const lead = AppState.leads.find(l => l.id === leadId);
    if (!lead) return;
    copiarEAbrirWhatsApp(lead, generateNextMessageRecommendation(lead).message);
};

// 8. Inteligência do BOX PRÓXIMA MENSAGEM & Extração de Contato

// Nome de contato válido: não pode ser telefone, rótulo de sistema nem nome de operador/empresa
function nomeContatoValido(n) {
    const v = String(n || '').trim();
    if (v.length < 2 || v.length > 40) return false;
    if (/^[+\d][\d\s().-]{5,}$/.test(v)) return false;
    if (/hist[oó]rico|anexado|sistema|especialista|operador/i.test(v)) return false;
    const company = brandCompanyName().toLowerCase();
    if (company && v.toLowerCase().includes(company)) return false;
    return !isOperatorName(v);
}

function extractLeadContactName(lead) {
    if (nomeContatoValido(lead.contato_responsavel)) {
        return lead.contato_responsavel.trim();
    }
    if (lead.notas_operador) {
        const m = lead.notas_operador.match(/Contato:\s*([^\n,]+)/i);
        if (m && nomeContatoValido(m[1])) return m[1].trim();
    }
    if (lead.timeline && lead.timeline.length > 0) {
        for (const t of lead.timeline) {
            // Só mensagens recebidas do cliente identificam o contato. Notas, eventos de sistema e
            // históricos anexados nunca são fonte de nome (evitava "Histórico Anexado" como contato).
            if (t.tipo === 'nota_operador' || t.direcao === 'system' || t.direcao === 'outbound') continue;
            if (t.autor && !isOperatorName(t.autor) && !t.autor.includes('Sistema') && !t.autor.includes('Operador')) {
                const clean = t.autor.replace(/\(.*?\)/g, '').replace(/Atendimento/g, '').trim();
                if (nomeContatoValido(clean)) return clean;
            }
            const text = t.texto || '';
            const matchNome = text.match(/(?:sou a|sou o|me chamo|meu nome é|fala com a|fala com o)\s+([A-ZÁÉÍÓÚÂÊÔÃÕÇ][a-záéíóúâêôãõç]+)/i);
            if (matchNome) return matchNome[1].trim();
        }
    }
    return "";
}

// Retorna a data nominal amigável do calendário (ex: Quinta-feira, 29/10/2026 às 10:30)
function calcularDataNominalFollowUp(lead, targetStage) {
    if (typeof SupabaseBridge !== 'undefined' && typeof SupabaseBridge.calculateNominalFollowupDate === 'function') {
        return SupabaseBridge.calculateNominalFollowupDate(lead, targetStage);
    }
    const now = new Date();
    const dias = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];
    const d = String(now.getDate()).padStart(2, '0');
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const y = now.getFullYear();
    return `${dias[now.getDay()]}, ${d}/${m}/${y} às 10:30`;
}

// Saudação por horário + apresentação do operador. O gancho vem pronto da base (sem IA).
function saudacaoInicial() {
    const h = new Date().getHours();
    const periodo = h < 12 ? 'bom dia' : (h < 18 ? 'boa tarde' : 'boa noite');
    return `Olá, ${periodo}! Tudo bem? Meu nome é ${operatorName()}.`;
}

// Primeira mensagem: gancho já escrito (base enriquecida ou análise) com a camada de saudação.
// Retorna '' quando o lead não tem gancho.
function montarPrimeiraMensagem(lead) {
    const gancho = (lead.pre_analise_scout?.gancho_kickoff_gerado || '').trim();
    if (!gancho) return '';
    const jaTemSaudacao = /^\s*(ol[aá]|oi|bom dia|boa tarde|boa noite)(?![\p{L}])/iu.test(gancho);
    return jaTemSaudacao ? gancho : `${saudacaoInicial()}

${gancho}`;
}

// Gancho pronto da base enriquecida dispensa a IA na primeira abordagem
function usaGanchoDaBase(lead, etapa) {
    return etapa === initialStageId() && String(lead.pre_analise_scout?.origem || '').startsWith('carga')
        && !!(lead.pre_analise_scout?.gancho_kickoff_gerado || '').trim();
}

function generateNextMessageRecommendation(lead, contactNameOverride = null, stageOverride = null) {
    const stage = stageOverride || lead.status_kanban || initialStageId();
    const contactName = contactNameOverride !== null ? contactNameOverride : extractLeadContactName(lead);

    let firstName = "";
    if (contactName) {
        const parts = contactName.split(/[\s(]/);
        if (parts.length > 0 && parts[0].trim()) {
            firstName = parts[0].trim();
        }
    }

    const nome = lead.nome_fantasia;
    const op = operatorName();
    const marca = brandCompanyName();
    const subtitulo = brandSubtitle();
    const greeting = firstName ? `Olá, ${firstName}!` : "Olá, tudo bem?";
    const nominalDate = calcularDataNominalFollowUp(lead, stage);
    const catalogUrl = (CockpitConfig.categories || []).find(c => c.id === lead.cluster_estrategico)?.caseHeroUrl || CockpitConfig.brand?.catalogUrl || '';
    const catalogRef = catalogUrl ? ` (${catalogUrl})` : '';
    const tkt = Number(lead.ticket_estimado);
    const tktFormatted = tkt > 0 ? `R$ ${tkt.toLocaleString('pt-BR')}` : "condições especiais";
    let timingLabel = nominalDate;
    let messageText = "";

    switch (stage) {
        case 'aguardando_contato':
            messageText = montarPrimeiraMensagem(lead) ||
                `${greeting} Sou ${op}, da ${marca} (${subtitulo}). Quem aí na ${nome} cuida de projetos e compras? Posso enviar o nosso catálogo?`;
            break;

        case 'ativado':
            timingLabel = `${nominalDate} (Retomada do primeiro contato)`;
            messageText = `${greeting} Conseguiu dar uma olhada na minha mensagem sobre a ${marca} para a ${nome}? Posso enviar o catálogo${catalogRef} por aqui, se preferir.`;
            break;

        case 'atendimento':
            timingLabel = `${nominalDate} (Conversa em andamento)`;
            messageText = `${greeting} Obrigado pelo retorno! Para indicar a opção ideal para a ${nome}, pode me contar qual a demanda ou escopo que vocês têm em mente?`;
            break;

        case 'interessado':
            timingLabel = `${nominalDate} (Avançar para proposta)`;
            messageText = `${greeting} Com base no que conversamos, já separei as opções da ${marca} que melhor atendem a ${nome}${catalogRef}. Posso montar a proposta com valores e prazos?`;
            break;

        case 'proposta':
            timingLabel = `${nominalDate} (Acompanhamento da proposta)`;
            messageText = `${greeting} Conseguiu avaliar a proposta que enviei para a ${nome}? Fico à disposição para ajustar itens, quantidades ou prazo de entrega.`;
            break;

        case 'oferta':
            timingLabel = `${nominalDate} (Gatilho de fechamento)`;
            messageText = `${greeting} Sobre a condição que apresentei para a ${nome} (${tktFormatted}): consigo manter essas condições se confirmarmos nesta semana. Podemos avançar com o pedido?`;
            break;

        case 'retomar_em':
            timingLabel = `${nominalDate} (Retorno agendado)`;
            messageText = `${greeting} Conforme combinamos, estou retomando o contato da ${marca} para a ${nome}. Como estão os planos para darmos o próximo passo?`;
            break;

        case 'atencao':
            timingLabel = `${nominalDate} (Revisar cadastro)`;
            messageText = `${greeting} Estou revisando o cadastro da ${nome} para garantir que os dados e o contato estejam corretos. Pode confirmar com quem devo falar na área responsável?`;
            break;

        case 'declinou':
            timingLabel = `${nominalDate} (Reativação amigável D+30)`;
            messageText = `${greeting} Passando para deixar um abraço e avisar que a ${marca} recebeu novidades${catalogRef}. Se fizer sentido para a ${nome} no futuro, seguimos à disposição!`;
            break;

        default:
            messageText = `${greeting} Gostaria de saber como estão os planos para a ${nome}...`;
    }

    return {
        timing: timingLabel,
        contactName: contactName,
        message: messageText
    };
}



function formatarTelefoneExibicao(rawPhone) {
    if (!rawPhone) return "";
    let clean = String(rawPhone).replace(/\D/g, "");
    if (clean.startsWith("55") && clean.length >= 12) {
        clean = clean.substring(2);
    }
    if (clean.length === 11) {
        return `(${clean.substring(0, 2)}) ${clean.substring(2, 7)}-${clean.substring(7)}`;
    } else if (clean.length === 10) {
        return `(${clean.substring(0, 2)}) ${clean.substring(2, 6)}-${clean.substring(6)}`;
    } else if (clean.length === 9) {
        return `${clean.substring(0, 5)}-${clean.substring(5)}`;
    } else if (clean.length === 8) {
        return `${clean.substring(0, 4)}-${clean.substring(4)}`;
    }
    return rawPhone;
}

// 9. Modal de Detalhes do Lead (Card Aberto)
function abrirModalLead(leadId) {
    const lead = AppState.leads.find(l => l.id === leadId);
    if (!lead) return;

    AppState.selectedLead = lead;

    document.getElementById('modal-lead-nome').innerText = lead.nome_fantasia;
    document.querySelectorAll('.ia-aviso').forEach(e => e.remove());
    popularSeletoresCabecalho(lead);
    document.getElementById('modal-lead-cidade').innerHTML = `<i data-lucide="map-pin"></i> ${lead.cidade || 'Brasil'}`;

    // Pill unificado de WhatsApp (exibição + cópia + edição in-place no mesmo elemento)
    const rawZap = lead.whatsapp_disparo || "";
    const formattedZap = formatarTelefoneExibicao(rawZap);
    const pill = document.getElementById('modal-phone-pill');
    const pillText = document.getElementById('phone-pill-text');
    const pillInput = document.getElementById('phone-pill-input');
    if (pill && pillText) {
        pill.classList.remove('is-editing', 'copied');
        pillText.innerText = formattedZap || "Sem WhatsApp";
        if (pillInput) pillInput.value = rawZap;
    }

    // Telefone Fixo Adicional (se houver cadastrado)
    const phoneWrap = document.getElementById('modal-lead-phone-wrap');
    const phoneVal = document.getElementById('modal-lead-phone-val');
    const telFixo = lead.telefone_fixo || lead.telefone || lead.pre_analise_scout?.telefone_fixo || "";
    if (phoneWrap && phoneVal) {
        const cleanZapDigits = String(rawZap).replace(/\D/g, "");
        const cleanTelDigits = String(telFixo).replace(/\D/g, "");
        if (cleanTelDigits && cleanTelDigits !== cleanZapDigits) {
            phoneWrap.classList.remove('hidden');
            phoneVal.innerText = formatarTelefoneExibicao(telFixo);
        } else {
            phoneWrap.classList.add('hidden');
        }
    }

    // Website Oficial (se houver cadastrado)
    const websiteLink = document.getElementById('modal-lead-website-link');
    const websiteVal = document.getElementById('modal-lead-website-val');
    const rawSite = (lead.website_original || lead.website || lead.pre_analise_scout?.website || "").trim();
    const isSemSite = !rawSite || rawSite.toLowerCase().includes('não possui') || rawSite.toLowerCase().includes('ausente');

    if (websiteLink && websiteVal) {
        if (!isSemSite) {
            let finalUrl = rawSite;
            if (!finalUrl.startsWith('http://') && !finalUrl.startsWith('https://')) {
                finalUrl = 'https://' + finalUrl;
            }
            websiteLink.href = finalUrl;
            
            // Domínio limpo para visualização compacta
            let displayDomain = rawSite.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/.*$/, '');
            websiteVal.innerText = displayDomain || "Site Oficial";
            websiteLink.title = `Abrir site oficial: ${finalUrl}`;
            websiteLink.classList.remove('hidden');
        } else {
            websiteLink.classList.add('hidden');
        }
    }

    // Canais alternativos para lead sem WhatsApp: e-mail e Instagram
    const emailLink = document.getElementById('modal-lead-email-link');
    const emailRaw = (lead.email_contato || lead.email_parcerias || '').trim();
    if (emailLink) {
        emailLink.classList.toggle('hidden', !emailRaw);
        if (emailRaw) {
            emailLink.dataset.email = emailRaw;
            emailLink.title = 'Clique para copiar o e-mail';
            document.getElementById('modal-lead-email-val').innerText = emailRaw;
        }
    }
    const instaLink = document.getElementById('modal-lead-instagram-link');
    const instaRaw = (lead.instagram_url || '').trim();
    if (instaLink) {
        instaLink.classList.toggle('hidden', !/^https?:\/\//i.test(instaRaw));
        if (/^https?:\/\//i.test(instaRaw)) {
            instaLink.href = instaRaw;
            document.getElementById('modal-lead-instagram-val').innerText = '@' + (instaRaw.replace(/\/+$/, '').split('/').pop() || 'instagram');
        }
    }

    // Atualiza contador de navegação (ex: 5 de 174)
    updateModalNavCounter(lead);

    // Probabilidade Monte Carlo
    const prob = (MonteCarloEngine.calculateLeadProbability(lead) * 100).toFixed(0);
    const probBadge = document.getElementById('modal-lead-prob-badge');
    if (probBadge) probBadge.innerText = `${prob}% de fechamento`;

    // Pre-Audit
    document.getElementById('modal-scout-status').innerText = lead.pre_analise_scout?.status_presenca || "Ativo";

    // Dossiê: campos que a IA não preencheu ficam explícitos como "sem análise", sem texto de enchimento
    const scout = lead.pre_analise_scout || {};
    const daBase = String(scout.origem || '').startsWith('carga');
    const semAnalise = daBase ? "Não levantado na pesquisa" : "Sem análise da IA";
    const setScout = (id, valor) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.innerText = (valor && String(valor).trim()) ? valor : semAnalise;
        el.classList.toggle('scout-val-empty', !(valor && String(valor).trim()));
    };
    const lblSolucao = document.getElementById('label-scout-solucao');
    if (lblSolucao) lblSolucao.textContent = `Proposta ${brandCompanyName()}:`;
    setScout('modal-scout-status', limparCitacoes(scout.status_presenca) || 'Ativo');
    setScout('modal-scout-pontos-fortes', limparCitacoes(scout.pontos_fortes));
    setScout('modal-scout-pontos-fracos', limparCitacoes(scout.pontos_fracos));
    setScout('modal-scout-gargalo', semPrefixo(limparCitacoes(scout.gargalo_critico), 'A validar'));
    setScout('modal-scout-solucao', semPrefixo(limparCitacoes(scout.solucao_recomendada), 'Proposta'));

    // Campos dinâmicos do segmento (dados_segmento JSONB + CockpitConfig.segmentFields)
    const segContainer = document.getElementById('modal-scout-segment-fields');
    if (segContainer) {
        segContainer.innerHTML = '';
        const segDefs = (typeof CockpitConfig !== 'undefined' && Array.isArray(CockpitConfig.segmentFields)) ? CockpitConfig.segmentFields : [];
        const dadosSeg = lead.dados_segmento || {};
        const renderSegRow = (label, val) => {
            if (val === undefined || val === null || String(val).trim() === '') return;
            const p = document.createElement('p');
            p.className = 'scout-item';
            p.innerHTML = `<strong>${escapeHtml(label)}:</strong> <span>${escapeHtml(String(val))}</span>`;
            segContainer.appendChild(p);
        };
        if (segDefs.length > 0) {
            segDefs.forEach(def => {
                renderSegRow(def.label || def.key, dadosSeg[def.key]);
            });
        } else {
            Object.entries(dadosSeg).forEach(([k, v]) => {
                const rotulo = k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                renderSegRow(rotulo, v);
            });
        }
    }
    const mostrarLinha = (wrapId, valId, valor) => {
        const wrap = document.getElementById(wrapId);
        if (!wrap) return;
        const ok = !!(valor && String(valor).trim());
        wrap.classList.toggle('hidden', !ok);
        if (ok) document.getElementById(valId).innerText = valor;
    };
    const comp = scout.analise_complementar;
    const rotuloComp = document.querySelector('#modal-scout-comp-wrap strong');
    if (rotuloComp) rotuloComp.textContent = (comp && comp.metodo === 'regras_base') ? 'Proposta da base:' : 'Análise com IA:';
    mostrarLinha('modal-scout-comp-wrap', 'modal-scout-comp', comp
        ? [comp.gargalo_critico && ('Oportunidade: ' + semPrefixo(limparCitacoes(comp.gargalo_critico), 'A validar')),
           comp.solucao_recomendada && ('Proposta: ' + semPrefixo(limparCitacoes(comp.solucao_recomendada), 'Proposta')),
           comp.gerado_em && ('Gerada em ' + new Date(comp.gerado_em).toLocaleDateString('pt-BR'))].filter(Boolean).join(String.fromCharCode(10))
        : '');
    mostrarLinha('modal-scout-bio-wrap', 'modal-scout-bio', scout.mini_bio);
    mostrarLinha('modal-scout-obras-wrap', 'modal-scout-obras', scout.obras_referencia);
    mostrarLinha('modal-scout-obs-wrap', 'modal-scout-obs', lead.observacao_dados);
    mostrarLinha('modal-scout-prioridade-wrap', 'modal-scout-prioridade',
        lead.prioridade_carga ? `${prioridadeLabel(lead.prioridade_carga)}${lead.pontuacao_carga != null ? ` (${lead.pontuacao_carga} pontos)` : ''}` : '');
    const btnGerar = document.getElementById('btn-gerar-analise');
    if (btnGerar) {
        // Dossiê vindo da base enriquecida já foi pesquisado e revisado: não se refaz por aqui
        btnGerar.classList.remove('hidden');
        btnGerar.title = daBase
            ? 'A pesquisa da base é mantida; a IA acrescenta oportunidade e proposta usando essa pesquisa, o histórico e as notas'
            : 'Gerar a análise deste lead com a IA (site, histórico e notas)';
        btnGerar.disabled = false;
        btnGerar.innerHTML = `<i data-lucide="sparkles"></i> ${rotuloAnalise(scout)}`;
    }
    const wrapFontes = document.getElementById('modal-scout-fontes-wrap');
    const elFontes = document.getElementById('modal-scout-fontes');
    if (wrapFontes && elFontes) {
        const fontes = Array.isArray(scout.fontes) ? scout.fontes.filter(f => /^https?:\/\//i.test(f.url || '')) : [];
        wrapFontes.classList.toggle('hidden', fontes.length === 0);
        elFontes.innerHTML = fontes.map(f => `<a href="${escapeHtml(f.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(f.titulo || f.url)}</a>`).join(' · ');
    }

    const tktVal = (lead.ticket_estimado !== undefined && lead.ticket_estimado !== null && !isNaN(Number(lead.ticket_estimado)))
        ? Number(lead.ticket_estimado)
        : 0;
    document.getElementById('modal-scout-ticket').innerText = `R$ ${tktVal.toLocaleString('pt-BR')}`;

    // Discovery Selectors
    configurarMatrizDiscovery(lead);
    document.getElementById('select-discovery-potencial').value = lead.discovery_potencial_negocio || 'indefinido';
    document.getElementById('select-discovery-demanda').value = lead.discovery_demanda_imediata || 'indefinido';

    // Ticket Base & Fase no Modal (permite valor 0)
    const modalTktInput = document.getElementById('modal-ticket-base');
    if (modalTktInput) modalTktInput.value = tktVal;

    const modalStageSelect = document.getElementById('modal-stage-select');
    if (modalStageSelect) {
        modalStageSelect.innerHTML = '';
        KANBAN_STAGES.forEach(st => {
            const opt = document.createElement('option');
            opt.value = st.id;
            opt.innerText = st.label;
            if (st.id === lead.status_kanban) opt.selected = true;
            modalStageSelect.appendChild(opt);
        });
    }

    // BOX PRÓXIMA MENSAGEM & CONTATO
    const rec = generateNextMessageRecommendation(lead);
    const inputContact = document.getElementById('modal-contact-name');
    if (inputContact) inputContact.value = rec.contactName;

    const timingBadge = document.getElementById('modal-next-msg-timing');
    if (timingBadge) {
        timingBadge.innerHTML = `<i data-lucide="clock"></i> Enviar: ${rec.timing}`;
    }

    // Prévia: mostra o modelo padrão na hora e troca pelo texto da IA assim que ele chega (ou do cache)
    atualizarMensagemRecomendada(lead, { forcar: false });   // mostra o texto guardado ou o modelo padrão; a IA só roda em "Regenerar"

    // Renderiza Notas do Operador e Linha do Tempo de Mensagens separadamente
    renderNotes(lead);
    renderTimeline(lead);

    // Carrega interacoes_sdr sob demanda caso ainda não tenham sido carregadas para este cartão
    if (typeof CockpitStore !== 'undefined' && !lead._timelineLoaded) {
        CockpitStore.ensureTimeline(lead).then(() => {
            if (AppState.selectedLead && AppState.selectedLead.id === lead.id) {
                renderNotes(lead);
                renderTimeline(lead);
                const detectedContact = extractLeadContactName(lead);
                const inputC = document.getElementById('modal-contact-name');
                if (inputC && !inputC.value && detectedContact) {
                    inputC.value = detectedContact;
                    atualizarMensagemRecomendada(lead, { forcar: false });
                }
            }
        });
    }

    // Limpa Console de IA
    document.getElementById('textarea-smart-console').value = '';
    document.getElementById('box-sugestao-ia').classList.add('hidden');

    document.getElementById('modal-lead-details').classList.add('active');
    lucide.createIcons();
}

// ---- Cabeçalho do cartão: Categoria e Responsável editáveis (mesmo padrão visual) ----
function popularSeletoresCabecalho(lead) {
    const selCat = document.getElementById('modal-lead-cluster');
    if (selCat) {
        selCat.innerHTML = '';
        const cats = CockpitConfig.categories || [];
        const ids = cats.map(c => c.id);
        cats.forEach(c => selCat.add(new Option(c.label, c.id)));
        if (lead.cluster_estrategico && !ids.includes(lead.cluster_estrategico)) {
            selCat.add(new Option(categoryLabel(lead.cluster_estrategico), lead.cluster_estrategico));
        }
        selCat.value = lead.cluster_estrategico;
    }
    const selResp = document.getElementById('modal-lead-responsavel');
    if (selResp) {
        selResp.innerHTML = '';
        selResp.add(new Option('Sem responsável', ''));
        const nomes = operatorNames();
        nomes.forEach(n => selResp.add(new Option(n, n)));
        if (lead.responsavel_operador && !nomes.includes(lead.responsavel_operador)) {
            selResp.add(new Option(lead.responsavel_operador, lead.responsavel_operador));
        }
        selResp.value = lead.responsavel_operador || '';
    }
}

// ---- Próxima mensagem: IA com cache por contexto e modelo padrão como alternativa ----
// Próxima fase do funil (para o objetivo da mensagem): a seguinte na ordem das colunas que ainda é fluxo ativo.
function proximaEtapa(etapaId) {
    const ativas = KANBAN_STAGES.filter(s => !s.isLost && !s.isAlert && !s.isScheduled);
    const i = ativas.findIndex(s => s.id === etapaId);
    if (i >= 0) return i + 1 < ativas.length ? ativas[i + 1] : null;       // última fase ativa: o próximo passo é fechar
    return ativas.find(s => !s.isInitial) || null;                           // lead em Retomar/Atenção/Declinou volta ao fluxo
}

let msgReqSeq = 0;
let msgDebounce = null;

function hashTexto(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return String(h >>> 0);
}

function contextoMensagem(lead, contato, etapa) {
    const tl = lead.timeline || [];
    const ultimo = tl.length ? (tl[tl.length - 1].id || '') : '';
    const tamanho = tl.reduce((s, t) => s + (t.texto ? t.texto.length : 0), 0);
    return hashTexto(JSON.stringify([
        lead.id, etapa, contato, lead.cluster_estrategico, tl.length, ultimo, tamanho,
        lead.notas_operador || '', lead.discovery_interlocutor, lead.discovery_potencial_negocio,
        lead[campoAfinidade(lead)], lead.discovery_demanda_imediata,
        Number(lead.ticket_estimado) || 0, operatorName()
    ]));
}

function mostrarOrigemMensagem(tipo, detalhe) {
    const el = document.getElementById('next-msg-source');
    if (!el) return;
    const textos = {
        carregando: '<i data-lucide="loader-2" class="spin"></i> Gerando texto com IA…',
        ia: '<i data-lucide="sparkles"></i> Texto gerado por IA a partir do histórico deste lead',
        base: '<i data-lucide="file-check"></i> Primeira mensagem pronta da base enriquecida (sem uso de IA)',
        manual: `<i data-lucide="mouse-pointer-click"></i> ${detalhe || 'Modelo padrão. Clique em Regenerar para gerar o texto com IA'}`,
        padrao: `<i data-lucide="info"></i> Modelo padrão: ${detalhe || 'a IA está indisponível no momento'}`
    };
    el.className = 'next-msg-source ' + tipo;
    el.innerHTML = textos[tipo] || '';
    lucide.createIcons();
}

async function snapshotLeadDoModal(lead) {
    if (!lead) return lead;
    if (!lead._timelineLoaded && typeof CockpitStore !== 'undefined' && typeof CockpitStore.ensureTimeline === 'function') {
        await CockpitStore.ensureTimeline(lead);
    }
    const inputContact = document.getElementById('modal-contact-name');
    if (inputContact && inputContact.value.trim()) {
        lead.contato_responsavel = inputContact.value.trim();
    }
    const selV1 = document.getElementById('select-discovery-interlocutor');
    if (selV1) lead.discovery_interlocutor = selV1.value;
    const selV2 = document.getElementById('select-discovery-potencial');
    if (selV2) lead.discovery_potencial_negocio = selV2.value;
    const selV3 = document.getElementById('select-discovery-parceria');
    if (selV3) lead[campoAfinidade(lead)] = selV3.value;
    const selV4 = document.getElementById('select-discovery-demanda');
    if (selV4) lead.discovery_demanda_imediata = selV4.value;

    const modalTktInput = document.getElementById('modal-ticket-base');
    if (modalTktInput) {
        const trimmedTkt = String(modalTktInput.value).trim();
        if (trimmedTkt === '0') {
            lead.ticket_estimado = 0;
        } else if (trimmedTkt !== '' && !isNaN(Number(trimmedTkt))) {
            lead.ticket_estimado = Number(trimmedTkt);
        }
    }
    const stageSel = document.getElementById('modal-stage-select');
    if (stageSel && stageSel.value) lead.status_kanban = stageSel.value;

    const taNext = document.getElementById('textarea-next-msg');
    if (taNext && taNext.value.trim()) {
        lead.proxima_mensagem_customizada = taNext.value.trim();
    }
    return lead;
}

async function atualizarMensagemRecomendada(lead, opts = {}) {
    const ta = document.getElementById('textarea-next-msg');
    if (!ta || !lead) return;
    if (opts.forcar) {
        await snapshotLeadDoModal(lead);
    }
    const contato = opts.contato !== undefined ? opts.contato
        : (document.getElementById('modal-contact-name')?.value ?? extractLeadContactName(lead));
    const etapa = opts.etapa || document.getElementById('modal-stage-select')?.value || lead.status_kanban;
    const rec = generateNextMessageRecommendation(lead, contato, etapa);
    const seq = ++msgReqSeq;

    if (usaGanchoDaBase(lead, etapa)) {
        ta.value = rec.message;
        mostrarOrigemMensagem('base');
        return;
    }
    const hash = contextoMensagem(lead, contato, etapa);

    const cache = lead.pre_analise_scout?.mensagem_ia;
    if (!opts.forcar && cache && cache.hash === hash && cache.texto) {
        ta.value = cache.texto;
        mostrarOrigemMensagem('ia');
        return;
    }

    ta.value = rec.message;
    if (!opts.forcar) {
        // A IA só roda quando o operador pede (Regenerar): a cota diária é limitada e abrir cartões não pode consumi-la
        mostrarOrigemMensagem('manual', cache && cache.texto
            ? 'O contexto mudou desde o último texto de IA. Clique em Regenerar para atualizar'
            : '');
        return;
    }
    mostrarOrigemMensagem('carregando');
    const btnRegen = document.getElementById('btn-regenerar-msg');
    if (btnRegen) btnRegen.disabled = true; // evita cliques repetidos, que gastariam a cota diária da IA
    const blocoMsg = document.querySelector('.next-msg-body-wrap');
    const pararProgresso = blocoMsg ? iniciarProgressoIA(blocoMsg, 'Gerando a mensagem com IA', document.getElementById('next-msg-source')) : () => {};

    let res = { success: false, reason: 'erro' };
    if (typeof SupabaseBridge !== 'undefined' && SupabaseBridge.generateNextMessageAI) {
        res = await SupabaseBridge.generateNextMessageAI(lead, {
            contato,
            etapaId: etapa,
            aiGoal: (KANBAN_STAGES.find(s => s.id === etapa) || {}).aiGoal || '',
            etapaLabel: (KANBAN_STAGES.find(s => s.id === etapa) || {}).label || etapa,
            categoriaLabel: categoryLabel(lead.cluster_estrategico),
            proximaEtapaLabel: (proximaEtapa(etapa) || {}).label || 'Fechamento da venda',
            operador: operatorName(),
            prazoSugerido: rec.timing
        });
    }
    pararProgresso();
    if (btnRegen) btnRegen.disabled = false;
    // Ignora respostas atrasadas (usuário trocou de cartão ou pediu outro texto)
    if (seq !== msgReqSeq || !AppState.selectedLead || AppState.selectedLead.id !== lead.id) return;

    if (res.success) {
        ta.value = res.text;
        mostrarOrigemMensagem('ia');
        lead.pre_analise_scout = {
            ...(lead.pre_analise_scout || {}),
            mensagem_ia: { texto: res.text, hash, gerado_em: new Date().toISOString() }
        };
        if (lead.id && typeof SupabaseBridge !== 'undefined') {
            SupabaseBridge.updateLead(lead.id, { pre_analise_scout: lead.pre_analise_scout })
                .then(r => { if (!r.success) console.warn('Cache da mensagem não gravado:', r.error); });
        }
    } else {
        mostrarOrigemMensagem('padrao', res.reason === 'sem_chave'
            ? 'a chave da IA não está configurada'
            : (res.reason === 'cota'
                ? 'limite de uso da IA atingido; tente de novo em alguns instantes'
                : 'a IA está indisponível no momento'));
    }
}

function agendarMensagemRecomendada(opts) {
    clearTimeout(msgDebounce);
    msgDebounce = setTimeout(() => {
        if (AppState.selectedLead) atualizarMensagemRecomendada(AppState.selectedLead, opts);
    }, 900);
}

// Listeners dos recursos do cartão aberto: categoria, responsável, análise e mensagem
function setupCardEnhancements() {
    const emailLink = document.getElementById('modal-lead-email-link');
    if (emailLink) {
        emailLink.addEventListener('click', (ev) => {
            ev.preventDefault();
            const email = emailLink.dataset.email;
            if (!email) return;
            navigator.clipboard.writeText(email)
                .then(() => showToast(`📋 E-mail copiado: ${email}`))
                .catch(() => showToast('Não foi possível copiar o e-mail.', 'error'));
        });
    }

    const selCat = document.getElementById('modal-lead-cluster');
    if (selCat) {
        selCat.addEventListener('change', async () => {
            const lead = AppState.selectedLead;
            if (!lead) return;
            const anterior = lead.cluster_estrategico;
            const novo = selCat.value;
            if (novo === anterior) return;
            const prob = Number(MonteCarloEngine.calculateLeadProbability({ ...lead, cluster_estrategico: novo }).toFixed(4));
            const res = await SupabaseBridge.updateLead(lead.id, { cluster_estrategico: novo, probabilidade_montecarlo: prob });
            if (!res.success) {
                selCat.value = anterior;
                showToast(`❌ Não foi possível trocar a categoria: ${res.error}`, 'error', 6000);
                return;
            }
            lead.cluster_estrategico = novo;
            lead.probabilidade_montecarlo = prob;
            configurarMatrizDiscovery(lead);
            await registrarEventoSistema(lead, `🏷️ Categoria alterada de ${categoryLabel(anterior)} para ${categoryLabel(novo)}`);
            renderNotes(lead);
            document.getElementById('modal-lead-prob-badge').innerText = `${(prob * 100).toFixed(0)}% de fechamento`;
            saveState();
            renderKanban();
            agendarMensagemRecomendada({});
            showToast('Categoria atualizada.');
        });
    }

    const selResp = document.getElementById('modal-lead-responsavel');
    if (selResp) {
        selResp.addEventListener('change', async () => {
            const lead = AppState.selectedLead;
            if (!lead) return;
            const anterior = lead.responsavel_operador || '';
            const novo = selResp.value;
            if (novo === anterior) return;
            const res = await SupabaseBridge.updateLead(lead.id, { responsavel_operador: novo || null });
            if (!res.success) {
                selResp.value = anterior;
                showToast(`❌ Não foi possível trocar o responsável: ${res.error}`, 'error', 6000);
                return;
            }
            lead.responsavel_operador = novo || null;
            await registrarEventoSistema(lead, `👤 Responsável alterado de ${anterior || 'ninguém'} para ${novo || 'ninguém'}`);
            renderNotes(lead);
            saveState();
            renderKanban();
            showToast('Responsável atualizado.');
        });
    }

    const btnRegen = document.getElementById('btn-regenerar-msg');
    if (btnRegen) {
        btnRegen.addEventListener('click', () => {
            if (AppState.selectedLead) atualizarMensagemRecomendada(AppState.selectedLead, { forcar: true });
        });
    }

    const taNextMsg = document.getElementById('textarea-next-msg');
    if (taNextMsg) {
        taNextMsg.addEventListener('click', () => {
            if (taNextMsg.selectionStart !== taNextMsg.selectionEnd) return;
            const texto = taNextMsg.value.trim();
            setTimeout(() => {
                taNextMsg.select();
            }, 0);
            if (texto && navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(texto).then(() => {
                    showToast('📋 Recomendação selecionada e copiada!');
                }).catch(() => {});
            }
        });
    }

    const btnGerar = document.getElementById('btn-gerar-analise');
    if (btnGerar) {
        btnGerar.addEventListener('click', async () => {
            const lead = AppState.selectedLead;
            if (!lead) return;
            btnGerar.disabled = true;
            btnGerar.innerHTML = `<i data-lucide="loader-2" class="spin"></i> Analisando…`;
            lucide.createIcons();
            const card = btnGerar.closest('.dossier-card');
            const pararProgresso = iniciarProgressoIA(card, 'Analisando o lead com IA', card.querySelector('.scout-item'));
            await snapshotLeadDoModal(lead);
            // Contexto para a análise: notas do operador e conversa (sem eventos automáticos do sistema)
            const historico = (lead.timeline || [])
                .filter(t => t.texto && !/^(🏷️|👤|📞)/.test(t.texto))
                .map(t => `${t.autor}: ${t.texto}`).join('\n').slice(-3500);
            const d = await SupabaseBridge.enrichLeadScoutAI({
                ...lead,
                etapaId: lead.status_kanban,
                etapaLabel: (KANBAN_STAGES.find(s => s.id === lead.status_kanban) || {}).label,
                historico
            });
            pararProgresso();
            if (d && d.insuficiente) {
                btnGerar.disabled = false;
                btnGerar.innerHTML = `<i data-lucide="sparkles"></i> ${rotuloAnalise(lead.pre_analise_scout)}`;
                mostrarAvisoDossie(d.mensagem || 'Não há dados suficientes para elaborar uma proposta.');
                lucide.createIcons();
                return;
            }
            if (!d || !d.analise_ia) {
                btnGerar.disabled = false;
                btnGerar.innerHTML = `<i data-lucide="sparkles"></i> ${rotuloAnalise(lead.pre_analise_scout)}`;
                lucide.createIcons();
                showToast('A IA está indisponível no momento. Tente novamente em instantes.', 'error', 5000);
                return;
            }
            // Lead da base enriquecida: a pesquisa original fica intacta e a IA acrescenta um bloco próprio
            const merged = daBaseEnriquecida(lead.pre_analise_scout) ? {
                ...(lead.pre_analise_scout || {}),
                analise_complementar: {
                    gargalo_critico: d.gargalo_critico, solucao_recomendada: d.solucao_recomendada,
                    gerado_em: d.analisado_em, verificacao: d.verificacao
                }
            } : {
                ...(lead.pre_analise_scout || {}),
                status_presenca: d.status_presenca,
                pontos_fortes: d.pontos_fortes,
                pontos_fracos: d.pontos_fracos,
                gargalo_critico: d.gargalo_critico,
                solucao_recomendada: d.solucao_recomendada,
                fontes: d.fontes || [],
                gancho_kickoff_gerado: d.gancho_kickoff_gerado || (lead.pre_analise_scout || {}).gancho_kickoff_gerado,
                analisado_em: d.analisado_em,
                verificacao: d.verificacao,
                analise_ia: true
            };
            const res = await SupabaseBridge.updateLead(lead.id, { pre_analise_scout: merged });
            if (!res.success) {
                btnGerar.disabled = false;
                btnGerar.innerHTML = `<i data-lucide="sparkles"></i> ${rotuloAnalise(lead.pre_analise_scout)}`;
                lucide.createIcons();
                showToast(`❌ Análise gerada, mas não gravada: ${res.error}`, 'error', 6000);
                return;
            }
            lead.pre_analise_scout = merged;
            saveState();
            abrirModalLead(lead.id);
            showToast('Análise gerada pela IA.');
        });
    }
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * Parser inteligente de conversas exportadas/copiadas do WhatsApp
 * Suporta formatos padrão com colchetes e com traço:
 * - [10:45, 20/10/2026] Nome do Operador: Bom dia...
 * - [20/10/2026, 10:45] Papelaria Conceito: Olá...
 * - 20/10/2026, 10:45 - Nome do Operador: ...
 * - 10:45, 20/10/2026 - Papelaria Conceito: ...
 * Mantém quebras de linha e emojis em linhas de continuação
 */
function parseWhatsAppChat(text) {
    if (!text || typeof text !== 'string') return [];
    const lines = text.split(/\r?\n/);
    const messages = [];
    let currentMsg = null;

    const regexBracketTimeFirst = /^\[(\d{1,2}:\d{2}(?::\d{2})?),?\s+(\d{1,2}\/\d{1,2}\/\d{2,4})\]\s*([^:]+):\s*(.*)$/;
    const regexBracketDateFirst = /^\[(\d{1,2}\/\d{1,2}\/\d{2,4}),?\s+(\d{1,2}:\d{2}(?::\d{2})?)\]\s*([^:]+):\s*(.*)$/;
    const regexDashDateFirst = /^(\d{1,2}\/\d{1,2}\/\d{2,4}),?\s+(\d{1,2}:\d{2}(?::\d{2})?)\s*-\s*([^:]+):\s*(.*)$/;
    const regexDashTimeFirst = /^(\d{1,2}:\d{2}(?::\d{2})?),?\s+(\d{1,2}\/\d{1,2}\/\d{2,4})\s*-\s*([^:]+):\s*(.*)$/;

    for (const rawLine of lines) {
        const line = rawLine.trimEnd();
        if (!line.trim() && !currentMsg) continue;

        let match = line.match(regexBracketTimeFirst);
        let time = '', date = '', author = '', content = '';

        if (match) {
            time = match[1];
            date = match[2];
            author = match[3].trim();
            content = match[4];
        } else if ((match = line.match(regexBracketDateFirst))) {
            date = match[1];
            time = match[2];
            author = match[3].trim();
            content = match[4];
        } else if ((match = line.match(regexDashDateFirst))) {
            date = match[1];
            time = match[2];
            author = match[3].trim();
            content = match[4];
        } else if ((match = line.match(regexDashTimeFirst))) {
            time = match[1];
            date = match[2];
            author = match[3].trim();
            content = match[4];
        }

        if (author && date) {
            if (currentMsg) {
                currentMsg.texto = currentMsg.texto.trim();
                messages.push(currentMsg);
            }

            const lowerAuthor = author.toLowerCase();
            const isOperador = isOperatorName(lowerAuthor) || lowerAuthor.includes('você') || lowerAuthor.includes('voce') || lowerAuthor.includes('operador') || lowerAuthor === 'eu';
            const direcao = isOperador ? 'outbound' : 'inbound';
            const tipo = isOperador ? 'whatsapp_outbound' : 'whatsapp_inbound';
            const displayDate = `${date}, ${time}`;

            let dataEnvioIso = new Date().toISOString();
            try {
                const [d, m, y] = date.split('/');
                const fullYear = y.length === 2 ? '20' + y : y;
                const [hh, mm, ss] = time.split(':');
                const isoDate = new Date(parseInt(fullYear, 10), parseInt(m, 10) - 1, parseInt(d, 10), parseInt(hh, 10), parseInt(mm, 10), ss ? parseInt(ss, 10) : 0);
                if (!isNaN(isoDate.getTime())) {
                    dataEnvioIso = isoDate.toISOString();
                }
            } catch (e) {}

            currentMsg = {
                autor: author,
                texto: content,
                data: displayDate,
                data_envio: dataEnvioIso,
                direcao: direcao,
                tipo_mensagem: tipo
            };
        } else if (currentMsg) {
            currentMsg.texto += '\n' + rawLine;
        }
    }

    if (currentMsg) {
        currentMsg.texto = currentMsg.texto.trim();
        messages.push(currentMsg);
    }

    return messages;
}

// Renderiza o box exclusivo de NOTAS DO OPERADOR
function renderNotes(lead) {
    const container = document.getElementById('lead-notes-entries');
    const countBadge = document.getElementById('lead-notes-count');
    if (!container) return;
    container.innerHTML = '';

    const allNotes = (lead.timeline || []).filter(t => t.tipo === 'nota_operador');

    // Suporte caso haja apenas a string legada notas_operador sem interações estruturadas
    if (allNotes.length === 0 && lead.notas_operador && lead.notas_operador.trim()) {
        allNotes.push({
            id: null,
            autor: "Operador",
            tipo: "nota_operador",
            data: "Cadastrado",
            texto: lead.notas_operador
        });
    }

    if (countBadge) {
        countBadge.innerText = `${allNotes.length} ${allNotes.length === 1 ? 'nota' : 'notas'}`;
    }

    if (allNotes.length === 0) {
        container.innerHTML = '<p style="color:var(--text-muted);font-size:0.8rem;padding:6px 0;">Nenhuma nota do operador registrada ainda. Digite no console acima e clique em "Salvar Nota" para registrar.</p>';
        return;
    }

    allNotes.forEach((t, idx) => {
        const itemKey = t.id ? String(t.id) : `idx_${idx}`;
        const entry = document.createElement('div');
        entry.className = 'note-entry';
        entry.id = `entry-note-${itemKey}`;

        entry.innerHTML = `
            <div class="entry-header">
                <div class="entry-header-info">
                    <strong style="color:#FBBF24;"><i data-lucide="notebook-pen" style="width:12px;height:12px;vertical-align:middle;display:inline-block;"></i> ${escapeHtml(t.autor || 'Operador')}</strong>
                    <span>${escapeHtml(t.data || '')}</span>
                </div>
                <div class="entry-actions">
                    <button type="button" class="btn-entry-action btn-edit-entry" title="Editar nota" onclick="window.iniciarEdicaoItem('${lead.id}', '${itemKey}', 'nota', event)">
                        <i data-lucide="pencil" style="width:12px;height:12px;"></i>
                    </button>
                    <button type="button" class="btn-entry-action btn-delete-entry" title="Excluir nota" onclick="window.excluirItem('${lead.id}', '${itemKey}', 'nota', event)">
                        <i data-lucide="trash-2" style="width:12px;height:12px;"></i>
                    </button>
                </div>
            </div>
            <div class="entry-body" id="entry-body-${itemKey}">${escapeHtml(t.texto)}</div>
        `;
        container.appendChild(entry);
    });

    lucide.createIcons();
}

// Renderiza a LINHA DO TEMPO DE MENSAGENS (WhatsApp / Disparos / Histórico)
function renderTimeline(lead) {
    const container = document.getElementById('lead-timeline-entries');
    const countBadge = document.getElementById('lead-timeline-count');
    const checkSelectAll = document.getElementById('check-select-all-timeline');
    const btnBatchDelete = document.getElementById('btn-delete-selected-timeline');
    const countSelected = document.getElementById('count-selected-timeline');

    if (!container) return;
    container.innerHTML = '';

    // Reseta estado do checkbox selecionar todos e botão de exclusão
    if (checkSelectAll) {
        checkSelectAll.checked = false;
        checkSelectAll.indeterminate = false;
    }
    if (btnBatchDelete) btnBatchDelete.classList.add('hidden');
    if (countSelected) countSelected.innerText = '0';

    const allMsgs = (lead.timeline || []).filter(t => t.tipo !== 'nota_operador');

    if (countBadge) {
        countBadge.innerText = `${allMsgs.length} ${allMsgs.length === 1 ? 'msg' : 'msgs'}`;
    }

    if (allMsgs.length === 0) {
        container.innerHTML = '<p style="color:var(--text-muted);font-size:0.8rem;padding:6px 0;">Nenhuma mensagem registrada na linha do tempo ainda.</p>';
        return;
    }

    const tonsContato = {};
    allMsgs.forEach((t, idx) => {
        const itemKey = t.id ? String(t.id) : `idx_${idx}`;
        const entry = document.createElement('div');

        // Detecção robusta de direção (Operadores -> outbound/azul; Lead/Omni -> inbound/verde)
        const lowerAutor = (t.autor || '').toLowerCase();
        const isOutbound = (t.direcao === 'outbound') ||
                           isOperatorName(lowerAutor) ||
                           lowerAutor.includes('operador') ||
                           lowerAutor.includes('você') ||
                           lowerAutor.includes('voce') ||
                           lowerAutor === 'eu';
        // Cada contato externo ganha uma cor própria, na ordem em que aparece (o lado da empresa é azul)
        let dirClass = isOutbound ? 'entry-outbound' : 'entry-inbound';
        if (!isOutbound) {
            const chave = (t.autor || '').trim().toLowerCase();
            if (!(chave in tonsContato)) tonsContato[chave] = Object.keys(tonsContato).length % 4;
            dirClass += ` entry-tone-${tonsContato[chave]}`;
        }
        entry.className = `timeline-entry ${dirClass}`;
        entry.id = `entry-msg-${itemKey}`;

        entry.innerHTML = `
            <div class="entry-header">
                <div class="entry-header-info">
                    <label class="entry-checkbox-label" onclick="event.stopPropagation()" title="Selecionar mensagem">
                        <input type="checkbox" class="entry-checkbox check-timeline-item" data-id="${itemKey}" onchange="window.onTimelineItemCheckChange()" />
                    </label>
                    <strong class="entry-author-title">${escapeHtml(t.autor || 'Sistema')}</strong>
                    <span>${escapeHtml(t.data || '')}</span>
                </div>
                <div class="entry-actions">
                    <button type="button" class="btn-entry-action btn-edit-entry" title="Editar mensagem" onclick="window.iniciarEdicaoItem('${lead.id}', '${itemKey}', 'timeline', event)">
                        <i data-lucide="pencil" style="width:12px;height:12px;"></i>
                    </button>
                    <button type="button" class="btn-entry-action btn-delete-entry" title="Excluir mensagem" onclick="window.excluirItem('${lead.id}', '${itemKey}', 'timeline', event)">
                        <i data-lucide="trash-2" style="width:12px;height:12px;"></i>
                    </button>
                </div>
            </div>
            <div class="entry-body" id="entry-body-${itemKey}">${escapeHtml(t.texto)}</div>
        `;
        container.appendChild(entry);
    });

    lucide.createIcons();

    // Rola para a mensagem mais recente automaticamente
    setTimeout(() => {
        container.scrollTop = container.scrollHeight;
    }, 50);
}

// Manipula seleção / desseleção de todos os checkboxes da timeline
window.toggleSelectAllTimeline = function(isChecked) {
    const checkboxes = document.querySelectorAll('.check-timeline-item');
    checkboxes.forEach(cb => {
        cb.checked = isChecked;
    });
    window.onTimelineItemCheckChange();
};

// Monitora mudanças nos checkboxes individuais da timeline
window.onTimelineItemCheckChange = function() {
    const allCheckboxes = document.querySelectorAll('.check-timeline-item');
    const checkedBoxes = document.querySelectorAll('.check-timeline-item:checked');
    const checkSelectAll = document.getElementById('check-select-all-timeline');
    const btnBatchDelete = document.getElementById('btn-delete-selected-timeline');
    const countSelected = document.getElementById('count-selected-timeline');

    if (checkSelectAll) {
        checkSelectAll.checked = (allCheckboxes.length > 0 && checkedBoxes.length === allCheckboxes.length);
        checkSelectAll.indeterminate = (checkedBoxes.length > 0 && checkedBoxes.length < allCheckboxes.length);
    }

    if (btnBatchDelete && countSelected) {
        countSelected.innerText = String(checkedBoxes.length);
        if (checkedBoxes.length > 0) {
            btnBatchDelete.classList.remove('hidden');
        } else {
            btnBatchDelete.classList.add('hidden');
        }
    }
};

// Exclusão em lote de mensagens selecionadas da linha do tempo
window.excluirLoteTimeline = async function() {
    const activeLead = AppState.selectedLead;
    if (!activeLead || !activeLead.timeline) {
        showToast("⚠️ Nenhum lead ativo selecionado.", "warning");
        return;
    }

    const checkedBoxes = Array.from(document.querySelectorAll('.check-timeline-item:checked'));
    if (checkedBoxes.length === 0) {
        showToast("⚠️ Nenhuma mensagem selecionada para exclusão.", "warning");
        return;
    }

    const totalToDelete = checkedBoxes.length;
    const confirmDelete = confirm(`Deseja realmente excluir em lote as ${totalToDelete} ${totalToDelete === 1 ? 'mensagem selecionada' : 'mensagens selecionadas'} da Linha do Tempo?`);
    if (!confirmDelete) return;

    // Coleta IDs selecionados
    const selectedKeys = checkedBoxes.map(cb => cb.getAttribute('data-id'));
    const supabaseIds = [];

    selectedKeys.forEach(k => {
        if (!k.startsWith('idx_')) {
            supabaseIds.push(k);
        } else {
            const rawIdx = parseInt(k.replace('idx_', ''), 10);
            const msgList = activeLead.timeline.filter(t => t.tipo !== 'nota_operador');
            const targetMsg = msgList[rawIdx];
            if (targetMsg && targetMsg.id) {
                supabaseIds.push(String(targetMsg.id));
            }
        }
    });

    // Se houver IDs no Supabase, exclui via SupabaseBridge
    if (supabaseIds.length > 0 && typeof SupabaseBridge !== 'undefined' && typeof SupabaseBridge.deleteMultipleInteractions === 'function') {
        const res = await SupabaseBridge.deleteMultipleInteractions(supabaseIds);
        if (!res.success) {
            showToast(`❌ Falha ao excluir do Supabase: ${res.error}`, "error");
            return;
        }
    }

    // Remove do estado local do lead
    activeLead.timeline = activeLead.timeline.filter((t, idx) => {
        if (t.tipo === 'nota_operador') return true;
        if (t.id && supabaseIds.includes(String(t.id))) return false;
        if (selectedKeys.includes(`idx_${idx}`)) return false;
        return true;
    });

    saveState();
    renderTimeline(activeLead);
    showToast(`🗑️ ${totalToDelete} ${totalToDelete === 1 ? 'mensagem excluída' : 'mensagens excluídas'} com sucesso!`);
};

// Inicia a edição inline suave de uma nota ou mensagem
window.iniciarEdicaoItem = function(leadId, itemKey, origin, event) {
    if (event) event.stopPropagation();
    const lead = AppState.leads.find(l => l.id === leadId);
    if (!lead || !lead.timeline) return;

    let item = null;
    if (itemKey.startsWith('idx_')) {
        const rawIdx = parseInt(itemKey.replace('idx_', ''), 10);
        const subList = origin === 'nota' 
            ? lead.timeline.filter(t => t.tipo === 'nota_operador')
            : lead.timeline.filter(t => t.tipo !== 'nota_operador');
        item = subList[rawIdx];
    } else {
        item = lead.timeline.find(t => String(t.id) === String(itemKey));
    }

    if (!item) return;

    const bodyEl = document.getElementById(`entry-body-${itemKey}`);
    if (!bodyEl) return;
    if (bodyEl.querySelector('.entry-inline-edit-input')) return;

    const currentText = item.texto || '';
    bodyEl.innerHTML = `
        <textarea class="entry-inline-edit-input" id="input-edit-${itemKey}">${escapeHtml(currentText)}</textarea>
        <div class="entry-inline-edit-actions">
            <button type="button" class="btn-inline-save" onclick="window.salvarEdicaoItem('${leadId}', '${itemKey}', '${origin}', event)">Salvar</button>
            <button type="button" class="btn-inline-cancel" onclick="window.cancelarEdicaoItem('${leadId}', '${itemKey}', '${origin}', event)">Cancelar</button>
        </div>
    `;

    const inputArea = document.getElementById(`input-edit-${itemKey}`);
    if (inputArea) {
        inputArea.focus();
        inputArea.selectionStart = inputArea.value.length;
        inputArea.selectionEnd = inputArea.value.length;
    }
};

// Cancela a edição inline restaurando o visual
window.cancelarEdicaoItem = function(leadId, itemKey, origin, event) {
    if (event) event.stopPropagation();
    const lead = AppState.leads.find(l => l.id === leadId);
    if (!lead) return;
    if (origin === 'nota') {
        renderNotes(lead);
    } else {
        renderTimeline(lead);
    }
};

// Salva a alteração inline persistindo no Supabase e no estado local
window.salvarEdicaoItem = async function(leadId, itemKey, origin, event) {
    if (event) event.stopPropagation();
    const lead = AppState.leads.find(l => l.id === leadId);
    if (!lead || !lead.timeline) return;

    const inputArea = document.getElementById(`input-edit-${itemKey}`);
    if (!inputArea) return;
    const novoTexto = inputArea.value.trim();
    if (!novoTexto) {
        showToast("⚠️ O texto não pode ficar vazio.", "warning");
        return;
    }

    let item = null;
    if (itemKey.startsWith('idx_')) {
        const rawIdx = parseInt(itemKey.replace('idx_', ''), 10);
        const subList = origin === 'nota' 
            ? lead.timeline.filter(t => t.tipo === 'nota_operador')
            : lead.timeline.filter(t => t.tipo !== 'nota_operador');
        item = subList[rawIdx];
    } else {
        item = lead.timeline.find(t => String(t.id) === String(itemKey));
    }

    if (!item) return;

    // Persiste no Supabase caso possua ID
    if (item.id && typeof SupabaseBridge !== 'undefined' && typeof SupabaseBridge.updateInteraction === 'function') {
        const res = await SupabaseBridge.updateInteraction(item.id, novoTexto);
        if (!res.success) {
            showToast(`❌ Falha ao atualizar no BD: ${res.error}`, "error");
            return;
        }
    }

    item.texto = novoTexto;
    saveState();

    if (origin === 'nota') {
        renderNotes(lead);
    } else {
        renderTimeline(lead);
    }

    showToast("✅ Registro atualizado com sucesso!");
};

// Exclui uma nota ou mensagem item a item
window.excluirItem = async function(leadId, itemKey, origin, event) {
    if (event) event.stopPropagation();
    const lead = AppState.leads.find(l => l.id === leadId);
    if (!lead || !lead.timeline) return;

    let itemIdx = -1;
    let item = null;

    if (itemKey.startsWith('idx_')) {
        const rawIdx = parseInt(itemKey.replace('idx_', ''), 10);
        const subList = origin === 'nota' 
            ? lead.timeline.filter(t => t.tipo === 'nota_operador')
            : lead.timeline.filter(t => t.tipo !== 'nota_operador');
        item = subList[rawIdx];
        itemIdx = lead.timeline.indexOf(item);
    } else {
        itemIdx = lead.timeline.findIndex(t => String(t.id) === String(itemKey));
        if (itemIdx !== -1) item = lead.timeline[itemIdx];
    }

    if (!item || itemIdx === -1) return;

    const preview = item.texto ? item.texto.substring(0, 50) + (item.texto.length > 50 ? '...' : '') : 'este item';
    const confirmar = confirm(`Deseja realmente excluir este registro?\n\n"${preview}"`);
    if (!confirmar) return;

    // Remove no Supabase caso possua ID
    if (item.id && typeof SupabaseBridge !== 'undefined' && typeof SupabaseBridge.deleteInteraction === 'function') {
        const res = await SupabaseBridge.deleteInteraction(item.id);
        if (!res.success) {
            showToast(`❌ Falha ao excluir do BD: ${res.error}`, "error");
            return;
        }
    }

    lead.timeline.splice(itemIdx, 1);
    saveState();

    if (origin === 'nota') {
        renderNotes(lead);
    } else {
        renderTimeline(lead);
    }

    showToast("🗑️ Registro excluído com sucesso!");
};

// 10. Setup de Modals e Event Listeners
function setupModals() {
    const modalLeadDetails = document.getElementById('modal-lead-details');
    const btnCloseLeadModal = document.getElementById('btn-close-lead-modal');

    if (btnCloseLeadModal && modalLeadDetails) {
        btnCloseLeadModal.addEventListener('click', () => {
            modalLeadDetails.classList.remove('active');
        });
    }

    // Botões de navegação sequencial no Header do Modal
    const btnNavPrev = document.getElementById('btn-modal-nav-prev');
    if (btnNavPrev) {
        btnNavPrev.addEventListener('click', (e) => {
            e.stopPropagation();
            navegarCardModal(-1);
        });
    }

    const btnNavNext = document.getElementById('btn-modal-nav-next');
    if (btnNavNext) {
        btnNavNext.addEventListener('click', (e) => {
            e.stopPropagation();
            navegarCardModal(1);
        });
    }

    // Fecha o cartão ao clicar fora da janela (backdrop click)
    if (modalLeadDetails) {
        modalLeadDetails.addEventListener('click', (e) => {
            if (e.target === modalLeadDetails) {
                modalLeadDetails.classList.remove('active');
            }
        });
    }

    // Atalhos de Teclado (Escape para fechar, Setas Esquerda/Direita para correr sequência)
    window.addEventListener('keydown', (e) => {
        const isModalOpen = modalLeadDetails && modalLeadDetails.classList.contains('active');

        if (e.key === 'Escape') {
            if (isModalOpen) {
                modalLeadDetails.classList.remove('active');
            }
            const modalNovo = document.getElementById('modal-novo-lead');
            if (modalNovo && modalNovo.classList.contains('active')) {
                modalNovo.classList.remove('active');
            }
            return;
        }

        // Navegação sequencial pelos cartões com as setas laterais (ArrowLeft / ArrowRight)
        if (isModalOpen) {
            const activeEl = document.activeElement;
            const isEditing = activeEl && (
                activeEl.tagName === 'INPUT' ||
                activeEl.tagName === 'TEXTAREA' ||
                activeEl.tagName === 'SELECT' ||
                activeEl.isContentEditable
            );

            // Não intercepta se o usuário estiver digitando em campos de texto
            if (!isEditing) {
                if (e.key === 'ArrowLeft') {
                    e.preventDefault();
                    navegarCardModal(-1);
                } else if (e.key === 'ArrowRight') {
                    e.preventDefault();
                    navegarCardModal(1);
                }
            }
        }
    });

    // Atualização dinâmica da prévia da próxima mensagem ao mudar contato ou fase no modal
    const inputContact = document.getElementById('modal-contact-name');
    if (inputContact) {
        inputContact.addEventListener('input', (e) => {
            if (!AppState.selectedLead) return;
            // Espera o operador terminar de digitar antes de chamar a IA
            agendarMensagemRecomendada({ contato: e.target.value });
        });
    }

    const modalStageSelect = document.getElementById('modal-stage-select');
    if (modalStageSelect) {
        modalStageSelect.addEventListener('change', (e) => {
            if (!AppState.selectedLead) return;
            const contact = document.getElementById('modal-contact-name').value;
            const rec = generateNextMessageRecommendation(AppState.selectedLead, contact, e.target.value);
            document.getElementById('modal-next-msg-timing').innerHTML = `<i data-lucide="clock"></i> Enviar: ${rec.timing}`;
            lucide.createIcons();
            atualizarMensagemRecomendada(AppState.selectedLead, { contato: contact, etapa: e.target.value });
        });
    }

    // BOTÃO DE SALVAR NO CARTÃO ABERTO (CARD ABERTO - VALIDAÇÃO ZERO-MENTIRA)
    const btnSalvarModal = document.getElementById('btn-salvar-modal-lead');
    if (btnSalvarModal) {
        btnSalvarModal.addEventListener('click', async () => {
            const lead = AppState.selectedLead;
            if (!lead) return;

            btnSalvarModal.disabled = true;
            btnSalvarModal.innerHTML = `<i data-lucide="loader-2" class="spin"></i> Gravando no BD...`;
            lucide.createIcons();

            // Lê matriz de discovery
            const discV1 = document.getElementById('select-discovery-interlocutor').value;
            const discV2 = document.getElementById('select-discovery-potencial').value;
            const discV3 = document.getElementById('select-discovery-parceria').value;
            const campoAf = campoAfinidade(lead);   // inclinação de parceria (B2B) ou encantamento com os produtos (B2C)
            const discV4 = document.getElementById('select-discovery-demanda').value;

            // Lê ticket base (suporta 0)
            const rawTkt = document.getElementById('modal-ticket-base').value;
            const trimmedTkt = String(rawTkt).trim();
            let finalTkt = 0;
            if (trimmedTkt === '0') {
                finalTkt = 0;
            } else {
                const num = Number(trimmedTkt);
                finalTkt = (!isNaN(num) && trimmedTkt !== '') ? num : 0;
            }

            // Lê fase
            const newStage = document.getElementById('modal-stage-select').value;

            // Lê contato e próxima mensagem customizada
            const contact = document.getElementById('modal-contact-name').value.trim();
            // O contato vai para a coluna própria; as notas do operador não são tocadas
            const newNotas = lead.notas_operador || '';
            const mudouDeFase = newStage !== lead.status_kanban;

            // Calcula probabilidade Monte Carlo dinâmica antes de persistir no BD
            const tempLead = {
                ...lead,
                discovery_interlocutor: discV1,
                discovery_potencial_negocio: discV2,
                [campoAf]: discV3,
                discovery_demanda_imediata: discV4,
                ticket_estimado: finalTkt,
                status_kanban: newStage
            };
            const calcProbModal = MonteCarloEngine.calculateLeadProbability(tempLead);
            const probMonteCarloDb = Number(calcProbModal.toFixed(4));

            const payloadFields = {
                discovery_interlocutor: discV1,
                discovery_potencial_negocio: discV2,
                [campoAf]: discV3,
                discovery_demanda_imediata: discV4,
                ticket_estimado: finalTkt,
                status_kanban: newStage,
                contato_responsavel: contact || null,
                probabilidade_montecarlo: probMonteCarloDb
            };
            // Mover o cartão de fase torna o operador o responsável por ele
            if (mudouDeFase) payloadFields.responsavel_operador = operatorName();

            // Atualiza no Supabase e valida a resposta explicitamente
            if (typeof SupabaseBridge !== 'undefined' && lead.id) {
                const res = await SupabaseBridge.updateLead(lead.id, payloadFields);

                btnSalvarModal.disabled = false;

                if (!res.success) {
                    console.error("❌ Erro retornado pelo Supabase no salvar do modal:", res.error);
                    btnSalvarModal.classList.remove('saved');
                    btnSalvarModal.classList.add('btn-error-state');
                    btnSalvarModal.innerHTML = `<i data-lucide="alert-octagon"></i> FALHA AO GRAVAR NO BD!`;
                    lucide.createIcons();

                    showSystemAlertModal({
                        title: "Falha de Gravação no Banco de Dados Supabase",
                        message: `As alterações no cartão "${lead.nome_fantasia}" (inclusive Potencial de Negócio: "${discV2}") NÃO foram salvas no Supabase. O frontend não salvará falsamente no sistema.`,
                        details: res.error
                    });
                    showToast(`❌ Erro no BD: ${res.error}`, 'error', 6000);

                    setTimeout(() => {
                        btnSalvarModal.classList.remove('btn-error-state');
                        btnSalvarModal.innerHTML = `<i data-lucide="save"></i> Tentar Salvar Novamente`;
                        lucide.createIcons();
                    }, 3500);
                    return; // NÃO atualiza tela como sucesso nem salva mentira no localStorage!
                }

                // Mescla os dados confirmados do banco
                if (res.data) Object.assign(lead, res.data);
            }

            btnSalvarModal.disabled = false;

            // Atualiza propriedades locais do lead
            lead.discovery_interlocutor = discV1;
            lead.discovery_potencial_negocio = discV2;
            lead[campoAf] = discV3;
            lead.discovery_demanda_imediata = discV4;
            lead.ticket_estimado = finalTkt;
            lead.status_kanban = newStage;
            lead.contato_responsavel = contact;
            lead.notas_operador = newNotas;
            if (mudouDeFase) {
                lead.responsavel_operador = operatorName();
                const selR = document.getElementById('modal-lead-responsavel');
                if (selR) selR.value = lead.responsavel_operador;
            }

            // Recalcula Monte Carlo e atualiza badges no modal e na tela
            const prob = (MonteCarloEngine.calculateLeadProbability(lead) * 100).toFixed(0);
            document.getElementById('modal-lead-prob-badge').innerText = `${prob}% de fechamento`;
            document.getElementById('modal-scout-ticket').innerText = `R$ ${lead.ticket_estimado.toLocaleString('pt-BR')}`;

            saveState();
            updateGlobalMetrics();
            renderKanban();

            // Feedback visual no botão
            btnSalvarModal.classList.remove('btn-error-state');
            btnSalvarModal.classList.add('saved');
            btnSalvarModal.innerHTML = `<i data-lucide="check"></i> Confirmado no BD com Sucesso!`;
            lucide.createIcons();
            showToast("✅ Alterações gravadas com sucesso no Supabase!");

            setTimeout(() => {
                btnSalvarModal.classList.remove('saved');
                btnSalvarModal.innerHTML = `<i data-lucide="save"></i> Salvar Alterações do Lead`;
                lucide.createIcons();
            }, 2200);
        });
    }

    // Botão de Copiar & Abrir WhatsApp Web a partir do Box Próxima Mensagem
    document.getElementById('btn-abrir-zap-modal').addEventListener('click', () => {
        if (!AppState.selectedLead) return;
        const lead = AppState.selectedLead;
        const mensagem = document.getElementById('textarea-next-msg').value.trim() || `Olá! Sou ${operatorName()}, da ${brandCompanyName()}...`;

        copiarEAbrirWhatsApp(lead, mensagem);
    });

    // Botão de Venda Realizada dentro do Modal Aberto
    const btnModalVenda = document.getElementById('btn-modal-venda');
    if (btnModalVenda) {
        btnModalVenda.addEventListener('click', () => {
            if (AppState.selectedLead) {
                window.marcarVendaRealizada(AppState.selectedLead.id);
            }
        });
    }

    // Botão de Descartar Lead dentro do Modal Aberto
    const btnModalDescartar = document.getElementById('btn-modal-descartar');
    if (btnModalDescartar) {
        btnModalDescartar.addEventListener('click', () => {
            if (AppState.selectedLead) {
                window.descartarLead(AppState.selectedLead.id);
            }
        });
    }

    // Pill unificado de Telefone: copiar (clique no texto/ícone) e editar in-place (lápis, Enter, Esc)
    const pill = document.getElementById('modal-phone-pill');
    const pillText = document.getElementById('phone-pill-text');
    const pillHint = document.getElementById('phone-pill-copy-hint');
    const pillIcon = document.getElementById('phone-pill-zap-icon');
    const inputEditPhone = document.getElementById('phone-pill-input');
    const btnEditPhone = document.getElementById('btn-phone-pill-edit');
    const btnSavePhone = document.getElementById('btn-phone-pill-save');
    const btnCancelPhone = document.getElementById('btn-phone-pill-cancel');

    function fecharEdicaoTelefone() {
        if (pill) pill.classList.remove('is-editing');
    }

    function abrirEdicaoTelefone() {
        if (!AppState.selectedLead || !pill) return;
        const currentZap = AppState.selectedLead.whatsapp_disparo || '';
        if (inputEditPhone) inputEditPhone.value = formatarTelefoneExibicao(currentZap) || currentZap;
        pill.classList.add('is-editing');
        if (inputEditPhone) {
            inputEditPhone.focus();
            inputEditPhone.select();
        }
    }

    function copiarTelefone(e) {
        e.stopPropagation();
        const lead = AppState.selectedLead;
        if (!lead || !lead.whatsapp_disparo || pill.classList.contains('is-editing')) return;
        const texto = formatarTelefoneExibicao(lead.whatsapp_disparo) || lead.whatsapp_disparo;
        navigator.clipboard.writeText(texto).then(() => {
            pill.classList.add('copied');
            if (pillHint) pillHint.innerText = "Copiado!";
            showToast(`📋 WhatsApp ${texto} copiado!`);
            setTimeout(() => {
                pill.classList.remove('copied');
                if (pillHint) pillHint.innerText = "Copiar";
            }, 2200);
        }).catch(err => console.error("Erro ao copiar WhatsApp:", err));
    }

    if (pillText) pillText.addEventListener('click', copiarTelefone);
    if (pillIcon) pillIcon.addEventListener('click', copiarTelefone);
    if (btnEditPhone) btnEditPhone.addEventListener('click', (e) => { e.stopPropagation(); abrirEdicaoTelefone(); });
    if (btnCancelPhone) btnCancelPhone.addEventListener('click', (e) => { e.stopPropagation(); fecharEdicaoTelefone(); });

    async function salvarTelefoneModal() {
        const lead = AppState.selectedLead;
        if (!lead || !inputEditPhone) return;

        const raw = inputEditPhone.value.trim();
        let clean = raw.replace(/\D/g, '');

        if (!clean || clean.length < 10) {
            showToast("⚠️ Informe um número válido com DDD (mínimo 10 dígitos).", "warning");
            inputEditPhone.focus();
            return;
        }

        // Se tiver 10 ou 11 dígitos (DDD + número), adiciona código do Brasil 55
        if ((clean.length === 10 || clean.length === 11) && !clean.startsWith('55')) {
            clean = '55' + clean;
        }

        const oldZap = lead.whatsapp_disparo;
        lead.whatsapp_disparo = clean;

        if (btnSavePhone) {
            btnSavePhone.innerHTML = `<i data-lucide="loader-2" class="spin"></i>`;
            lucide.createIcons();
        }

        if (typeof SupabaseBridge !== 'undefined' && lead.id) {
            const res = await SupabaseBridge.updateLead(lead.id, {
                whatsapp_disparo: clean,
                whatsapp_confirmado: true
            });

            if (!res.success) {
                lead.whatsapp_disparo = oldZap;
                if (btnSavePhone) {
                    btnSavePhone.innerHTML = `<i data-lucide="check"></i>`;
                    lucide.createIcons();
                }
                showToast(`❌ Falha ao atualizar telefone no BD: ${res.error}`, "error");
                return;
            }

            // Registra nota na timeline com a alteração
            const formattedNew = formatarTelefoneExibicao(clean);
            await SupabaseBridge.insertInteraction(lead.id, 'nota_operador', `📞 Telefone de WhatsApp atualizado para: ${formattedNew} (${clean})`, 'system', operatorName());
            if (!lead.timeline) lead.timeline = [];
            lead.timeline.push({
                id: 'note_phone_' + Date.now(),
                autor: operatorName(),
                tipo: 'nota_operador',
                direcao: 'outbound',
                data: 'Hoje, ' + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
                texto: `📞 Telefone de WhatsApp atualizado para: ${formattedNew} (${clean})`
            });
            renderNotes(lead);
        }

        // Atualiza visual no modal e no Kanban
        if (pillText) pillText.innerText = formatarTelefoneExibicao(clean);

        fecharEdicaoTelefone();

        if (btnSavePhone) {
            btnSavePhone.innerHTML = `<i data-lucide="check"></i>`;
            lucide.createIcons();
        }

        saveState();
        renderKanban();
        showToast(`📞 Telefone de "${lead.nome_fantasia}" atualizado com sucesso!`);
    }

    if (btnSavePhone) {
        btnSavePhone.addEventListener('click', (e) => {
            e.stopPropagation();
            salvarTelefoneModal();
        });
    }

    if (inputEditPhone) {
        inputEditPhone.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                salvarTelefoneModal();
            } else if (e.key === 'Escape') {
                fecharEdicaoTelefone();
            }
        });
    }

    // Smart Console
    document.getElementById('btn-analisar-ia').addEventListener('click', async () => {
        const lead = AppState.selectedLead;
        const textoEntrada = document.getElementById('textarea-smart-console').value.trim();
        if (!lead || !textoEntrada) return;

        // Garante timeline carregada e sincroniza os dados visíveis no modal para que a IA fique 100% inteirada
        await snapshotLeadDoModal(lead);

        const btnAnalisar = document.getElementById('btn-analisar-ia');
        btnAnalisar.disabled = true;
        btnAnalisar.innerHTML = `<i data-lucide="loader-2" class="spin"></i> Consultando IA...`;
        lucide.createIcons();

        let sugestaoResposta = "";
        let statusSugerido = lead.status_kanban;
        let statusSugeridoNome = "Manter Atual";
        let perfilCadencia = "";
        let followupNominal = "";

        // 1. Consulta ao Cérebro Gemini AI (gemini-3-flash-preview) 100% inteirado do atendimento exclusivo
        let geminiOk = false;
        if (typeof SupabaseBridge !== 'undefined' && typeof SupabaseBridge.consultGeminiBrain === 'function') {
            try {
                const aiRes = await SupabaseBridge.consultGeminiBrain(lead, textoEntrada);
                if (aiRes.success && aiRes.data) {
                    sugestaoResposta = aiRes.data.sugestao_resposta;
                    statusSugerido = aiRes.data.status_sugerido || lead.status_kanban;
                    statusSugeridoNome = aiRes.data.status_sugerido_nome || "Fase Recomendada";
                    perfilCadencia = aiRes.data.perfil_cadencia || "";
                    followupNominal = aiRes.data.proximo_followup_nominal || "";
                    geminiOk = true;
                    console.log(`⚡ Smart Console respondeu via ${aiRes.modelUsed || 'Gemini'} com sucesso!`);
                }
            } catch (err) {
                console.warn("Fallback para heurística ativado:", err);
            }
        }

        // 2. Fallback heurístico contextualizado caso a API oscile
        if (!geminiOk) {
            const lower = textoEntrada.toLowerCase();
            const contactName = lead.contato_responsavel || "responsável";
            const marca = brandCompanyName();
            const subtitulo = brandSubtitle();
            const stageFor = (flag, fallback) => (stageByFlag(flag) || { id: fallback, label: fallback });
            const pick = (id) => KANBAN_STAGES.find(x => x.id === id) || { id, label: id };
            let alvo;
            if (lower.includes('não tenho interesse') || lower.includes('não temos interesse') || lower.includes('sem interesse')) {
                sugestaoResposta = `Agradeço a atenção, ${contactName}! Se fizer sentido no futuro para a ${lead.nome_fantasia}, a ${marca} (${subtitulo}) continua à disposição. Posso deixar nosso catálogo com você?`;
                alvo = stageFor('isLost', 'declinou');
            } else if (lower.includes('passar') || lower.includes('responsável') || lower.includes('secretária') || lower.includes('proprietária') || lower.includes('proprietário') || lower.includes('e-mail')) {
                sugestaoResposta = `Muito obrigado! Para facilitar o repasse à direção da ${lead.nome_fantasia}: somos a ${marca} (${subtitulo}). Posso enviar uma apresentação resumida para você encaminhar?`;
                alvo = pick('ativado');
            } else if (lower.includes('quanto custa') || lower.includes('qual o valor') || lower.includes('preço')) {
                sugestaoResposta = `Os valores variam conforme a configuração, a quantidade e o prazo de entrega. Para passar a condição exata para a ${lead.nome_fantasia}, qual demanda ou projeto você tem em mente?`;
                alvo = pick('interessado');
            } else {
                sugestaoResposta = `Perfeito! Meu contato é para apresentar a ${marca} (${subtitulo}) para a ${lead.nome_fantasia}. Posso enviar nosso catálogo e entender o que vocês procuram?`;
                alvo = pick('atendimento');
            }
            statusSugerido = alvo.id;
            statusSugeridoNome = alvo.label;

            const cadence = (typeof SupabaseBridge !== 'undefined' && typeof SupabaseBridge.analyzeCadence === 'function')
                ? SupabaseBridge.analyzeCadence(lead)
                : { padraoGeral: "Cadência equilibrada" };
            perfilCadencia = cadence.padraoGeral;
            followupNominal = calcularDataNominalFollowUp(lead, statusSugerido);
        }

        btnAnalisar.disabled = false;
        btnAnalisar.innerHTML = `<i data-lucide="bot"></i> Analisar com IA`;
        lucide.createIcons();

        document.getElementById('text-sugestao-ia').innerText = sugestaoResposta;
        document.getElementById('badge-status-sugerido').innerText = statusSugeridoNome;

        // Renderiza telemetria de cadência e data nominal
        const textCadence = document.getElementById('text-cadence-profile');
        if (textCadence) textCadence.innerText = perfilCadencia || "Cadência padrão identificada";
        const textFollowup = document.getElementById('text-followup-nominal');
        if (textFollowup) textFollowup.innerText = followupNominal || calcularDataNominalFollowUp(lead, statusSugerido);

        // Atualiza dinamicamente o badge de timing do box Próxima Mensagem com a data nominal sugerida
        if (followupNominal) {
            const timingBadge = document.getElementById('modal-next-msg-timing');
            if (timingBadge) {
                timingBadge.innerHTML = `<i data-lucide="clock"></i> Enviar: ${followupNominal}`;
            }
        }

        document.getElementById('box-sugestao-ia').classList.remove('hidden');
        lucide.createIcons();

        document.getElementById('btn-aplicar-status-sugerido').onclick = async () => {
            await window.alterarFaseCard(lead.id, statusSugerido);
            const stageSelect = document.getElementById('modal-stage-select');
            if (stageSelect) stageSelect.value = statusSugerido;
            showToast(`Lead movido para: ${statusSugeridoNome}`);
        };

        document.getElementById('btn-copiar-sugestao').onclick = () => {
            navigator.clipboard.writeText(sugestaoResposta).then(() => {
                showToast("📋 Resposta copiada para a área de transferência!");
            });
        };
    });

    const btnSalvarNota = document.getElementById('btn-salvar-nota-rapida');
    if (btnSalvarNota) {
        btnSalvarNota.addEventListener('click', async () => {
            const lead = AppState.selectedLead;
            const textarea = document.getElementById('textarea-smart-console');
            const texto = textarea ? textarea.value.trim() : '';
            if (!lead || !texto) return;

            btnSalvarNota.disabled = true;

            // 1. Identifica se o texto colado é um fluxo/conversa exportado do WhatsApp
            const parsedMessages = parseWhatsAppChat(texto);

            if (parsedMessages.length > 0) {
                // FLUXO DE CONVERSA DO WHATSAPP DETECTADO
                btnSalvarNota.innerHTML = `<i data-lucide="loader-2" class="spin"></i> Gravando ${parsedMessages.length} msgs no BD...`;
                lucide.createIcons();

                let insertedRows = [];
                // Persistência em batch no Supabase para rastreabilidade estrita
                if (typeof SupabaseBridge !== 'undefined' && lead.id) {
                    const res = await SupabaseBridge.insertMultipleInteractions(lead.id, parsedMessages);
                    if (!res.success) {
                        btnSalvarNota.disabled = false;
                        btnSalvarNota.innerHTML = `<i data-lucide="save"></i> Salvar Nota / Mensagem`;
                        lucide.createIcons();

                        showSystemAlertModal({
                            title: "Falha ao Gravar Conversa do WhatsApp no BD",
                            message: `Não foi possível persistir as ${parsedMessages.length} mensagens no Supabase. O cockpit não salvará dados de forma enganosa.`,
                            details: res.error
                        });
                        showToast(`❌ Falha no BD: ${res.error}`, 'error', 6000);
                        return;
                    }
                    insertedRows = Array.isArray(res.data) ? res.data : [];
                }

                // Adiciona na linha do tempo do lead em ordem cronológica
                if (!lead.timeline) lead.timeline = [];
                parsedMessages.forEach((m, mIdx) => {
                    const linha = insertedRows[mIdx];
                    if (linha && linha.id && typeof SupabaseBridge.mapInteraction === 'function') {
                        // Linha gravada no banco: mesmo mapeamento do carregamento (lado da conversa e data corretos)
                        lead.timeline.push(SupabaseBridge.mapInteraction(linha));
                    } else {
                        lead.timeline.push({
                            id: 'temp_chat_' + Date.now() + '_' + mIdx,
                            autor: m.autor,
                            tipo: m.tipo_mensagem,
                            direcao: m.direcao,
                            data: m.data,
                            texto: m.texto
                        });
                    }
                });
                // Ordem cronológica quando todas as mensagens têm data
                if (lead.timeline.every(t => t.iso)) lead.timeline.sort((a, b) => new Date(a.iso) - new Date(b.iso));

                // Auto-detecção inteligente de nome de interlocutor no diálogo (ex: "fala com a Fernanda", "sou a Joana")
                const matchContact = texto.match(/(?:fala com a|falar com a|meu nome é|chamo|aqui é a|sou a)\s+([A-ZÁÉÍÓÚÂÊÔÃÕÇ][a-záéíóúâêôãõç]+)/i);
                if (matchContact && matchContact[1]) {
                    const detectedName = matchContact[1];
                    const inputContact = document.getElementById('modal-contact-name');
                    if (inputContact && (!inputContact.value.trim() || inputContact.value.trim() === 'Não identificado')) {
                        inputContact.value = detectedName;
                        lead.contato_responsavel = detectedName;
                    }
                }

                saveState();
                renderTimeline(lead);
                if (textarea) textarea.value = '';

                btnSalvarNota.disabled = false;
                btnSalvarNota.innerHTML = `<i data-lucide="check"></i> ${parsedMessages.length} Mensagens Salvas!`;
                lucide.createIcons();
                showToast(`💬 ${parsedMessages.length} mensagens do WhatsApp organizadas e salvas no BD com sucesso!`);

                setTimeout(() => {
                    btnSalvarNota.innerHTML = `<i data-lucide="save"></i> Salvar Nota / Mensagem`;
                    lucide.createIcons();
                }, 2500);

            } else {
                // FLUXO DE NOTA COMUM DO OPERADOR
                btnSalvarNota.innerHTML = `<i data-lucide="loader-2" class="spin"></i> Gravando nota...`;
                lucide.createIcons();

                let insertedId = 'temp_note_' + Date.now();
                if (typeof SupabaseBridge !== 'undefined' && lead.id) {
                    const res = await SupabaseBridge.insertInteraction(lead.id, 'nota_operador', texto, 'inbound', operatorName());
                    if (!res.success) {
                        btnSalvarNota.disabled = false;
                        btnSalvarNota.innerHTML = `<i data-lucide="save"></i> Salvar Nota / Mensagem`;
                        lucide.createIcons();

                        showSystemAlertModal({
                            title: "Falha ao Gravar Nota no Banco de Dados",
                            message: "A nota do operador não pôde ser salva no Supabase.",
                            details: res.error
                        });
                        showToast(`❌ Falha no BD: ${res.error}`, 'error', 6000);
                        return;
                    }
                    if (res.data && res.data.id) {
                        insertedId = res.data.id;
                    }
                }

                if (!lead.timeline) lead.timeline = [];
                lead.timeline.push({
                    id: insertedId,
                    autor: `Operador (${operatorName()})`,
                    tipo: "nota_operador",
                    direcao: "outbound",
                    data: "Hoje, " + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
                    texto: texto
                });

                saveState();
                renderNotes(lead);
                if (textarea) textarea.value = '';

                btnSalvarNota.disabled = false;
                btnSalvarNota.innerHTML = `<i data-lucide="check"></i> Nota Salva!`;
                lucide.createIcons();
                showToast("Nota do operador gravada com sucesso!");

                setTimeout(() => {
                    btnSalvarNota.innerHTML = `<i data-lucide="save"></i> Salvar Nota / Mensagem`;
                    lucide.createIcons();
                }, 2000);
            }
        });
    }

    // Modal Novo Lead
    const modalNovoLead = document.getElementById('modal-novo-lead');
    document.getElementById('btn-novo-lead-modal').addEventListener('click', () => {
        modalNovoLead.classList.add('active');
    });
    document.getElementById('btn-close-novo-lead').addEventListener('click', () => {
        modalNovoLead.classList.remove('active');
    });

    document.getElementById('form-novo-lead').addEventListener('submit', async (e) => {
        e.preventDefault();
        const nome = document.getElementById('novo-lead-nome').value.trim();
        const zap = document.getElementById('novo-lead-zap').value.trim();
        const cidade = document.getElementById('novo-lead-cidade').value.trim() || 'Brasil';
        const cluster = document.getElementById('novo-lead-cluster').value;
        const websiteInput = document.getElementById('novo-lead-website');
        const website = websiteInput ? websiteInput.value.trim() : '';
        const contatoInput = document.getElementById('novo-lead-contato');
        const contato = contatoInput ? contatoInput.value.trim() : '';
        const historico = document.getElementById('novo-lead-historico').value.trim();

        const submitBtn = e.target.querySelector('button[type="submit"]');
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.innerHTML = `<i data-lucide="loader-2" class="spin"></i> Salvando contato...`;
            lucide.createIcons();
        }

        // Normalização de WhatsApp com DDI 55
        let cleanZap = zap.replace(/\D/g, '');
        if ((cleanZap.length === 10 || cleanZap.length === 11) && !cleanZap.startsWith('55')) {
            cleanZap = '55' + cleanZap;
        }

        // O cadastro só salva o contato. A análise por IA é uma ação do operador, com o cartão aberto.

        const novoLead = {
            nome_fantasia: nome,
            cluster_estrategico: cluster,
            cidade: cidade,
            whatsapp_disparo: cleanZap,
            website_original: website || null,
            contato_responsavel: contato || null,
            ticket_estimado: 0, // definido pelo operador
            status_kanban: initialStageId(),
            discovery_interlocutor: 'indefinido',
            discovery_potencial_negocio: 'indefinido',
            discovery_inclinacao_parceria: 'indefinido',
            discovery_demanda_imediata: 'indefinido',
            pre_analise_scout: {
                status_presenca: 'Cadastro manual',
                pontos_fortes: '',
                pontos_fracos: '',
                gargalo_critico: '',
                solucao_recomendada: '',
                analise_ia: false
            }
        };

        if (typeof SupabaseBridge !== 'undefined') {
            const res = await SupabaseBridge.insertLead(novoLead);
            if (!res.success) {
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.innerHTML = `<i data-lucide="alert-octagon"></i> Erro ao Criar`;
                    lucide.createIcons();
                }
                showSystemAlertModal({
                    title: "Falha ao Criar Lead no Banco de Dados",
                    message: `O Supabase recusou a inserção do lead "${nome}". O sistema não salvará de forma falsa.`,
                    details: res.error
                });
                showToast(`❌ Falha no BD: ${res.error}`, 'error', 6000);
                return;
            }

            const inserted = res.data;
            if (historico && inserted && inserted.id) {
                await SupabaseBridge.insertInteraction(inserted.id, 'nota_operador', `Histórico anexado no cadastro:\n${historico}`, 'system', operatorName());
            }

            if (inserted && inserted.id) {
                const novoComTimeline = { ...inserted, timeline: [], _timelineLoaded: false };
                AppState.leads.unshift(novoComTimeline);
                if (typeof CockpitStore !== 'undefined') {
                    await CockpitStore.putLeads([novoComTimeline]);
                }
            }
        }

        saveState();
        renderKanban();

        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = `<i data-lucide="user-plus"></i> Cadastrar lead`;
            lucide.createIcons();
        }

        modalNovoLead.classList.remove('active');
        document.getElementById('form-novo-lead').reset();
        showToast(`✅ Lead "${nome}" cadastrado. Abra o cartão e use “Gerar análise” se precisar de um dossiê.`);
    });
}

// 10. Atualização dos Indicadores de Forecast e View de Pipeline (via Web Worker assíncrono)
async function updateGlobalMetrics() {
    const simulation = (typeof MonteCarloEngine.simulatePipelineAsync === 'function')
        ? await MonteCarloEngine.simulatePipelineAsync(AppState.leads, 10000)
        : MonteCarloEngine.simulatePipeline(AppState.leads, 10000);

    // 1. Forecast Ponderado (Estritamente Fechar Compra / Propostas)
    const headerPonderado = document.getElementById('header-forecast-val');
    if (headerPonderado) {
        headerPonderado.innerText = `R$ ${simulation.forecastPonderado.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
    }

    // 2. Forecast Potencial (Fases em Andamento)
    const headerPotencial = document.getElementById('header-potencial-val');
    if (headerPotencial) {
        headerPotencial.innerText = `R$ ${simulation.forecastPotencial.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
    }

    // 3. Negócios Fechados (Receita Realizada Captada)
    const totalFechados = AppState.leads
        .filter(l => l.status_venda === 'venda_realizada' || (l.valor_fechado && Number(l.valor_fechado) > 0))
        .reduce((sum, l) => sum + (Number(l.valor_fechado) || Number(l.ticket_estimado) || 0), 0);

    const headerFechados = document.getElementById('header-fechados-val');
    if (headerFechados) {
        headerFechados.innerText = `R$ ${totalFechados.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
    }

    const kpiFechados = document.getElementById('kpi-receita-fechada');
    if (kpiFechados) {
        kpiFechados.innerText = `R$ ${totalFechados.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
    }
}

async function renderPipelineView() {
    const simulation = (typeof MonteCarloEngine.simulatePipelineAsync === 'function')
        ? await MonteCarloEngine.simulatePipelineAsync(AppState.leads, 10000)
        : MonteCarloEngine.simulatePipeline(AppState.leads, 10000);

    document.getElementById('kpi-forecast-ponderado').innerText = `R$ ${simulation.forecastPonderado.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
    document.getElementById('kpi-forecast-potencial').innerText = `R$ ${simulation.forecastPotencial.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
    document.getElementById('kpi-pipeline-bruto').innerText = `R$ ${simulation.pipelineBrutoTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
    document.getElementById('kpi-taxa-conversao').innerText = `${simulation.taxaConversaoMedia}%`;

    // Atualiza KPI de Negócios Fechados
    const totalFechados = AppState.leads
        .filter(l => l.status_venda === 'venda_realizada' || (l.valor_fechado && Number(l.valor_fechado) > 0))
        .reduce((sum, l) => sum + (Number(l.valor_fechado) || Number(l.ticket_estimado) || 0), 0);

    const kpiFechados = document.getElementById('kpi-receita-fechada');
    if (kpiFechados) {
        kpiFechados.innerText = `R$ ${totalFechados.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
    }

    // Distribuição de Monte Carlo
    const distContainer = document.getElementById('monte-carlo-distribution');
    distContainer.innerHTML = '';
    simulation.distribution.forEach(d => {
        const row = document.createElement('div');
        row.className = 'dist-bar-row';
        row.innerHTML = `
            <span class="dist-label">${d.rangeLabel}</span>
            <div class="dist-track">
                <div class="dist-fill" style="width: ${d.pct}%"></div>
            </div>
            <span class="dist-pct">${d.pct}%</span>
        `;
        distContainer.appendChild(row);
    });

    // Breakdown por Cluster
    const clusterContainer = document.getElementById('cluster-prob-breakdown');
    clusterContainer.innerHTML = '';
    const clusters = (CockpitConfig.categories || []).map(c => c.id);

    clusters.forEach(c => {
        const leadsCluster = AppState.leads.filter(l => l.cluster_estrategico === c);
        const avgProb = leadsCluster.length > 0 
            ? (leadsCluster.reduce((sum, l) => sum + MonteCarloEngine.calculateLeadProbability(l), 0) / leadsCluster.length * 100).toFixed(0)
            : 0;

        const row = document.createElement('div');
        row.className = 'cluster-row';
        row.innerHTML = `
            <span><strong>${categoryLabel(c)}</strong> (${leadsCluster.length} leads)</span>
            <span style="color:#60A5FA; font-family:var(--font-mono); font-weight:700;">${avgProb}% P(Médio)</span>
        `;
        clusterContainer.appendChild(row);
    });

    // Renderiza a Análise de Período (Mês com quebra semanal)
    renderPeriodAnalysis();
}

// 11. Análise Temporal & Fechamento por Período (Realizado vs Projetado vs Perdido)

function setupPeriodControls() {
    const selectMes = document.getElementById('select-periodo-mes');
    if (selectMes) {
        const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
        const hoje = new Date();
        selectMes.innerHTML = '';
        for (let k = 0; k < 6; k++) {
            const d = new Date(hoje.getFullYear(), hoje.getMonth() + k, 1);
            const opt = document.createElement('option');
            opt.value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            opt.innerText = `${MESES[d.getMonth()]} / ${d.getFullYear()}${k === 0 ? ' (Mês Atual)' : ''}`;
            selectMes.appendChild(opt);
        }
        const optAll = document.createElement('option');
        optAll.value = 'todos';
        optAll.innerText = 'Todos os Períodos';
        selectMes.appendChild(optAll);
        AppState.periodMonth = selectMes.options[0].value;
        selectMes.addEventListener('change', (e) => {
            AppState.periodMonth = e.target.value;
            renderPeriodAnalysis();
        });
    }

    const btnSemana = document.getElementById('btn-gran-semana');
    const btnMes = document.getElementById('btn-gran-mes');

    if (btnSemana && btnMes) {
        btnSemana.addEventListener('click', () => {
            AppState.periodGranularity = 'semana';
            btnSemana.classList.add('active');
            btnMes.classList.remove('active');
            renderPeriodAnalysis();
        });

        btnMes.addEventListener('click', () => {
            AppState.periodGranularity = 'mes';
            btnMes.classList.add('active');
            btnSemana.classList.remove('active');
            renderPeriodAnalysis();
        });
    }
}

function renderPeriodAnalysis() {
    const periodMonth = AppState.periodMonth || 'todos';
    const isSemana = AppState.periodGranularity === 'semana';

    // 1. Definição das Quebras Temporais
    let periodBuckets = [];
    const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
    const hoje = new Date();
    const mesAtual = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;

    if (isSemana) {
        const lastDay = (periodMonth !== 'todos')
            ? new Date(Number(periodMonth.slice(0, 4)), Number(periodMonth.slice(5, 7)), 0).getDate()
            : 31;
        const ranges = [[1, 7], [8, 14], [15, 21], [22, 28], [29, lastDay]];
        periodBuckets = ranges.map((r, k) => ({
            id: `w${k + 1}`,
            label: `Semana ${k + 1}`,
            sublabel: `Dias ${String(r[0]).padStart(2, '0')} a ${String(r[1]).padStart(2, '0')}`,
            range: r,
            isCurrent: periodMonth === mesAtual && hoje.getDate() >= r[0] && hoje.getDate() <= r[1]
        }));
    } else {
        for (let k = 0; k < 6; k++) {
            const d = new Date(hoje.getFullYear(), hoje.getMonth() + k, 1);
            const id = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            periodBuckets.push({
                id,
                label: `${MESES[d.getMonth()]} / ${d.getFullYear()}`,
                sublabel: k === 0 ? 'Mês Atual' : (k === 1 ? 'Próximo Mês' : ''),
                isCurrent: k === 0
            });
        }
    }

    // Inicializa acumuladores
    periodBuckets.forEach(b => {
        b.realizado = 0;
        b.realizadoCount = 0;
        b.projetado = 0;
        b.projetadoCount = 0;
        b.perdido = 0;
        b.perdidoCount = 0;
    });

    // Classificação de cada lead
    AppState.leads.forEach(lead => {
        const ticket = (lead.ticket_estimado !== undefined && lead.ticket_estimado !== null && !isNaN(Number(lead.ticket_estimado)))
            ? Number(lead.ticket_estimado)
            : 0;
        const valorFechado = Number(lead.valor_fechado) || ticket;

        const isRealizado = lead.status_venda === 'venda_realizada' || lead.is_arquivado;
        const isPerdido = isLostLikeStage(lead.status_kanban);
        const isProjetado = !isRealizado && !isPerdido;

        let targetDate = new Date();
        if (isRealizado && lead.data_fechamento_venda) {
            targetDate = new Date(lead.data_fechamento_venda);
        } else if (lead.status_kanban === scheduledStageId() && lead.data_reativacao_programada) {
            targetDate = new Date(lead.data_reativacao_programada);
        } else if (isPerdido && lead.data_perda) {
            targetDate = new Date(lead.data_perda);
        } else if (lead.created_at) {
            targetDate = new Date(lead.created_at);
        }

        const leadYearMonth = `${targetDate.getFullYear()}-${String(targetDate.getMonth() + 1).padStart(2, '0')}`;
        const leadDay = targetDate.getDate();

        if (isSemana) {
            if (periodMonth === 'todos' || leadYearMonth === periodMonth) {
                let bucket = periodBuckets.find(b => leadDay >= b.range[0] && leadDay <= b.range[1]);
                if (!bucket) bucket = periodBuckets[periodBuckets.length - 1];

                if (isRealizado) {
                    bucket.realizado += valorFechado;
                    bucket.realizadoCount++;
                } else if (isPerdido) {
                    bucket.perdido += ticket;
                    bucket.perdidoCount++;
                } else if (isProjetado) {
                    bucket.projetado += ticket;
                    bucket.projetadoCount++;
                }
            }
        } else {
            let bucket = periodBuckets.find(b => b.id === leadYearMonth);
            if (!bucket) {
                if (leadYearMonth < periodBuckets[0].id) bucket = periodBuckets[0];
                else bucket = periodBuckets[periodBuckets.length - 1];
            }

            if (isRealizado) {
                bucket.realizado += valorFechado;
                bucket.realizadoCount++;
            } else if (isPerdido) {
                bucket.perdido += ticket;
                bucket.perdidoCount++;
            } else if (isProjetado) {
                bucket.projetado += ticket;
                bucket.projetadoCount++;
            }
        }
    });

    // 2. Totais do Período Selecionado
    let totalRealizado = 0;
    let totalRealizadoCount = 0;
    let totalProjetado = 0;
    let totalProjetadoCount = 0;
    let totalPerdido = 0;
    let totalPerdidoCount = 0;

    periodBuckets.forEach(b => {
        totalRealizado += b.realizado;
        totalRealizadoCount += b.realizadoCount;
        totalProjetado += b.projetado;
        totalProjetadoCount += b.projetadoCount;
        totalPerdido += b.perdido;
        totalPerdidoCount += b.perdidoCount;
    });

    const elReal = document.getElementById('period-val-realizado');
    if (elReal) elReal.innerText = `R$ ${totalRealizado.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;

    const elCountReal = document.getElementById('period-count-realizado');
    if (elCountReal) elCountReal.innerText = `${totalRealizadoCount} ${totalRealizadoCount === 1 ? 'contrato fechado' : 'contratos fechados'}`;

    const elProj = document.getElementById('period-val-projetado');
    if (elProj) elProj.innerText = `R$ ${totalProjetado.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;

    const elCountProj = document.getElementById('period-count-projetado');
    if (elCountProj) elCountProj.innerText = `${totalProjetadoCount} ${totalProjetadoCount === 1 ? 'oportunidade em maturação' : 'oportunidades em maturação'}`;

    const elPerd = document.getElementById('period-val-perdido');
    if (elPerd) elPerd.innerText = `R$ ${totalPerdido.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;

    const elCountPerd = document.getElementById('period-count-perdido');
    if (elCountPerd) elCountPerd.innerText = `${totalPerdidoCount} ${totalPerdidoCount === 1 ? 'oportunidade declinada' : 'oportunidades declinadas'}`;

    // 3. Renderiza o Gráfico de Barras Triplas
    const barsContainer = document.getElementById('period-bars-chart');
    if (barsContainer) {
        barsContainer.innerHTML = '';

        let maxVal = 1000;
        periodBuckets.forEach(b => {
            if (b.realizado > maxVal) maxVal = b.realizado;
            if (b.projetado > maxVal) maxVal = b.projetado;
            if (b.perdido > maxVal) maxVal = b.perdido;
        });

        periodBuckets.forEach(b => {
            const hRealizado = Math.max(Math.round((b.realizado / maxVal) * 140), b.realizado > 0 ? 8 : 2);
            const hProjetado = Math.max(Math.round((b.projetado / maxVal) * 140), b.projetado > 0 ? 8 : 2);
            const hPerdido = Math.max(Math.round((b.perdido / maxVal) * 140), b.perdido > 0 ? 8 : 2);

            const col = document.createElement('div');
            col.className = 'period-bar-column';
            col.innerHTML = `
                <div class="period-bar-group">
                    <div class="period-bar bar-realizado" style="height: ${hRealizado}px;" title="Realizado: R$ ${b.realizado.toLocaleString('pt-BR')} (${b.realizadoCount})"></div>
                    <div class="period-bar bar-projetado" style="height: ${hProjetado}px;" title="Projetado: R$ ${b.projetado.toLocaleString('pt-BR')} (${b.projetadoCount})"></div>
                    <div class="period-bar bar-perdido" style="height: ${hPerdido}px;" title="Perdido: R$ ${b.perdido.toLocaleString('pt-BR')} (${b.perdidoCount})"></div>
                </div>
                <span class="bar-column-label">${b.label}</span>
                <span class="bar-column-sublabel">${b.sublabel}</span>
            `;
            barsContainer.appendChild(col);
        });
    }

    // 4. Renderiza a Tabela Analítica
    const tableBody = document.getElementById('period-table-body');
    if (tableBody) {
        tableBody.innerHTML = '';

        periodBuckets.forEach(b => {
            const somaAtiva = b.realizado + b.projetado;
            let efetivacao = '0%';
            if (somaAtiva > 0) {
                efetivacao = `${((b.realizado / somaAtiva) * 100).toFixed(0)}%`;
            }

            let statusBadge = '<span class="status-badge-period vazio">Sem Movimento</span>';
            if (b.realizado > 0 && b.realizado >= 2500) {
                statusBadge = '<span class="status-badge-period meta-batida"><i data-lucide="check"></i> Meta Batida</span>';
            } else if (b.projetado > 0 && b.isCurrent) {
                statusBadge = '<span class="status-badge-period em-andamento"><i data-lucide="clock"></i> Em Andamento</span>';
            } else if (b.projetado > 0) {
                statusBadge = '<span class="status-badge-period previsao"><i data-lucide="calendar"></i> Previsto</span>';
            }

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>
                    <strong>${b.label}</strong>
                    <div style="font-size:0.75rem; color:var(--text-muted);">${b.sublabel}</div>
                </td>
                <td class="table-money-realizado">R$ ${b.realizado.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} <span style="font-size:0.7rem; color:var(--text-muted);">(${b.realizadoCount})</span></td>
                <td class="table-money-projetado">R$ ${b.projetado.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} <span style="font-size:0.7rem; color:var(--text-muted);">(${b.projetadoCount})</span></td>
                <td class="table-money-perdido">R$ ${b.perdido.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} <span style="font-size:0.7rem; color:var(--text-muted);">(${b.perdidoCount})</span></td>
                <td><strong style="color:${b.realizado > 0 ? '#34D399' : 'var(--text-secondary)'}">${efetivacao}</strong></td>
                <td>${statusBadge}</td>
            `;
            tableBody.appendChild(tr);
        });
    }

    lucide.createIcons();
}

// 12. Auto-Cópia do Textarea ao Clicar & Toast Flutuante

// A prévia da mensagem agora é editável; a cópia acontece pelo botão "Copiar & Abrir WhatsApp Web".

function showToast(msg, type = 'success', duration = 3000) {
    const toast = document.getElementById('clipboard-toast');
    if (!toast) return;

    const span = document.getElementById('clipboard-toast-text') || toast.querySelector('span');
    if (span) span.innerText = msg;

    const iconContainer = toast.querySelector('i');
    if (type === 'error') {
        toast.classList.add('toast-error');
        if (iconContainer) iconContainer.setAttribute('data-lucide', 'alert-octagon');
    } else {
        toast.classList.remove('toast-error');
        if (iconContainer) iconContainer.setAttribute('data-lucide', 'check-circle-2');
    }
    lucide.createIcons();

    toast.classList.add('show');
    clearTimeout(toast._timeout);
    toast._timeout = setTimeout(() => {
        toast.classList.remove('show');
    }, duration);
}

