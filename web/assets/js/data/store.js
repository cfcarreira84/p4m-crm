/**
 * ==============================================================================
 * COCKPIT STORE (INDEXEDDB + DELTA SYNC + REALTIME IN-PLACE + LAZY TIMELINE)
 * ==============================================================================
 * Acelera o carregamento em conexões lentas sem violar a diretriz Zero-Mentira:
 * 1. Abre o Kanban imediatamente com o último estado salvo no IndexedDB local.
 * 2. Sincroniza apenas o delta (updated_at > lastSyncAt) + exclusões (exclusoes_sync).
 * 3. Carrega o histórico (interacoes_sdr) sob demanda ao abrir o modal do lead.
 * 4. Aplica eventos Realtime (INSERT/UPDATE/DELETE) diretamente em memória e no cache.
 * ==============================================================================
 */

const CockpitStore = {
    _dbPromise: null,
    _version: 2,

    get dbName() {
        const url = (typeof CockpitConfig !== 'undefined' && CockpitConfig.supabase?.url) || 'default';
        const slug = url.replace(/[^a-z0-9]/gi, '_').slice(0, 40);
        return `sdr_cockpit_cache_${slug}`;
    },

    openDB() {
        if (typeof indexedDB === 'undefined') return Promise.resolve(null);
        if (this._dbPromise) return this._dbPromise;

        this._dbPromise = new Promise((resolve) => {
            try {
                const req = indexedDB.open(this.dbName, this._version);
                req.onupgradeneeded = (e) => {
                    const db = e.target.result;
                    if (!db.objectStoreNames.contains('leads')) {
                        db.createObjectStore('leads', { keyPath: 'id' });
                    }
                    if (!db.objectStoreNames.contains('timelines')) {
                        db.createObjectStore('timelines', { keyPath: 'leadId' });
                    }
                    if (!db.objectStoreNames.contains('meta')) {
                        db.createObjectStore('meta', { keyPath: 'key' });
                    }
                };
                req.onsuccess = (e) => resolve(e.target.result);
                req.onerror = () => resolve(null);
            } catch (err) {
                resolve(null);
            }
        });
        return this._dbPromise;
    },

    async getMeta(key) {
        const db = await this.openDB();
        if (!db) return null;
        return new Promise((resolve) => {
            try {
                const tx = db.transaction('meta', 'readonly');
                const req = tx.objectStore('meta').get(key);
                req.onsuccess = () => resolve(req.result ? req.result.value : null);
                req.onerror = () => resolve(null);
            } catch (e) {
                resolve(null);
            }
        });
    },

    async setMeta(key, value) {
        const db = await this.openDB();
        if (!db) return;
        return new Promise((resolve) => {
            try {
                const tx = db.transaction('meta', 'readwrite');
                tx.objectStore('meta').put({ key, value });
                tx.oncomplete = () => resolve();
                tx.onerror = () => resolve();
            } catch (e) {
                resolve();
            }
        });
    },

    async getCachedLeads() {
        const db = await this.openDB();
        if (!db) return [];
        return new Promise((resolve) => {
            try {
                const tx = db.transaction(['leads', 'timelines'], 'readonly');
                const leadsReq = tx.objectStore('leads').getAll();
                const tlReq = tx.objectStore('timelines').getAll();
                let rawLeads = [];
                let rawTimelines = [];
                leadsReq.onsuccess = () => { rawLeads = leadsReq.result || []; };
                tlReq.onsuccess = () => { rawTimelines = tlReq.result || []; };
                tx.oncomplete = () => {
                    const tlMap = new Map(rawTimelines.map(item => [item.leadId, item.items || []]));
                    const merged = rawLeads.map(l => ({
                        ...l,
                        timeline: tlMap.has(l.id) ? tlMap.get(l.id) : (Array.isArray(l.timeline) ? l.timeline : []),
                        _timelineLoaded: tlMap.has(l.id) || Boolean(l._timelineLoaded)
                    }));
                    resolve(merged);
                };
                tx.onerror = () => resolve([]);
            } catch (e) {
                resolve([]);
            }
        });
    },

    async putLeads(leads) {
        if (!Array.isArray(leads) || leads.length === 0) return;
        const db = await this.openDB();
        if (!db) return;
        return new Promise((resolve) => {
            try {
                const tx = db.transaction('leads', 'readwrite');
                const store = tx.objectStore('leads');
                leads.forEach(l => {
                    if (!l || !l.id) return;
                    const copy = { ...l };
                    delete copy.interacoes_sdr;
                    store.put(copy);
                });
                tx.oncomplete = () => resolve();
                tx.onerror = () => resolve();
            } catch (e) {
                resolve();
            }
        });
    },

    async deleteLeads(ids) {
        if (!Array.isArray(ids) || ids.length === 0) return;
        const db = await this.openDB();
        if (!db) return;
        return new Promise((resolve) => {
            try {
                const tx = db.transaction(['leads', 'timelines'], 'readwrite');
                const leadStore = tx.objectStore('leads');
                const tlStore = tx.objectStore('timelines');
                ids.forEach(id => {
                    if (!id) return;
                    leadStore.delete(id);
                    tlStore.delete(id);
                });
                tx.oncomplete = () => resolve();
                tx.onerror = () => resolve();
            } catch (e) {
                resolve();
            }
        });
    },

    async saveLeadTimeline(leadId, items) {
        if (!leadId) return;
        const db = await this.openDB();
        if (!db) return;
        return new Promise((resolve) => {
            try {
                const tx = db.transaction('timelines', 'readwrite');
                tx.objectStore('timelines').put({
                    leadId,
                    items: Array.isArray(items) ? items : [],
                    fetchedAt: new Date().toISOString()
                });
                tx.oncomplete = () => resolve();
                tx.onerror = () => resolve();
            } catch (e) {
                resolve();
            }
        });
    },

    /**
     * Sincroniza incrementalmente com o Supabase:
     * - Se houver lastSyncAt e cache local não vazio, busca apenas registros alterados (updated_at > lastSyncAt)
     *   e exclusões registradas em exclusoes_sync.
     * - Caso contrário, faz a carga inicial enxuta (sem interacoes_sdr) e grava no IndexedDB.
     */
    async syncWithServer(currentLeads = []) {
        if (typeof SupabaseBridge === 'undefined') {
            return { success: false, leads: currentLeads, error: 'SupabaseBridge indisponível' };
        }

        const lastSyncAt = await this.getMeta('lastSyncAt');
        const hasLocalCache = Array.isArray(currentLeads) && currentLeads.length > 0 && Boolean(lastSyncAt);

        if (hasLocalCache && typeof SupabaseBridge.fetchLeadsDelta === 'function') {
            const [deltaRes, delRes] = await Promise.all([
                SupabaseBridge.fetchLeadsDelta(lastSyncAt),
                SupabaseBridge.fetchDeletionsSince(lastSyncAt)
            ]);

            if (!deltaRes.success) {
                return { success: false, leads: currentLeads, error: deltaRes.error };
            }

            const byId = new Map(currentLeads.map(l => [l.id, l]));
            const deletedIds = (delRes && delRes.success && Array.isArray(delRes.data)) ? delRes.data : [];

            deletedIds.forEach(id => byId.delete(id));
            if (deletedIds.length > 0) {
                await this.deleteLeads(deletedIds);
            }

            const changed = Array.isArray(deltaRes.data) ? deltaRes.data : [];
            changed.forEach(newRow => {
                const prev = byId.get(newRow.id);
                byId.set(newRow.id, {
                    ...newRow,
                    timeline: prev && Array.isArray(prev.timeline) ? prev.timeline : [],
                    _timelineLoaded: prev ? Boolean(prev._timelineLoaded) : false
                });
            });

            if (changed.length > 0) {
                await this.putLeads(changed);
            }

            const maxUpdated = changed.reduce((acc, r) => {
                const u = r.updated_at || r.created_at || '';
                return u > acc ? u : acc;
            }, lastSyncAt);
            await this.setMeta('lastSyncAt', maxUpdated || new Date().toISOString());

            return {
                success: true,
                mode: 'delta',
                changedCount: changed.length,
                deletedCount: deletedIds.length,
                leads: Array.from(byId.values())
            };
        }

        // Carga completa enxuta (sem embutir interacoes_sdr na listagem inicial do Kanban)
        const fullRes = typeof SupabaseBridge.fetchLeadsLean === 'function'
            ? await SupabaseBridge.fetchLeadsLean()
            : await SupabaseBridge.fetchLeads();

        if (!fullRes.success) {
            return { success: false, leads: currentLeads, error: fullRes.error };
        }

        const prevMap = new Map((currentLeads || []).map(l => [l.id, l]));
        const freshLeads = (fullRes.data || []).map(row => {
            const prev = prevMap.get(row.id);
            const hasEmbeddedTimeline = Array.isArray(row.timeline) && row.timeline.length > 0;
            return {
                ...row,
                timeline: hasEmbeddedTimeline
                    ? row.timeline
                    : (prev && Array.isArray(prev.timeline) ? prev.timeline : []),
                _timelineLoaded: hasEmbeddedTimeline || (prev ? Boolean(prev._timelineLoaded) : false)
            };
        });

        await this.putLeads(freshLeads);
        const maxUpdated = freshLeads.reduce((acc, r) => {
            const u = r.updated_at || r.created_at || '';
            return u > acc ? u : acc;
        }, '');
        await this.setMeta('lastSyncAt', maxUpdated || new Date().toISOString());

        return {
            success: true,
            mode: 'full',
            changedCount: freshLeads.length,
            deletedCount: 0,
            leads: freshLeads
        };
    },

    /**
     * Garante que a linha do tempo (interacoes_sdr) de um lead específico foi carregada sob demanda.
     */
    async ensureTimeline(lead, forceRefresh = false) {
        if (!lead || !lead.id || typeof SupabaseBridge === 'undefined') return [];
        if (lead._timelineLoaded && !forceRefresh && Array.isArray(lead.timeline)) {
            return lead.timeline;
        }
        if (typeof SupabaseBridge.fetchLeadTimeline !== 'function') {
            return lead.timeline || [];
        }
        const res = await SupabaseBridge.fetchLeadTimeline(lead.id);
        if (res.success && Array.isArray(res.data)) {
            lead.timeline = res.data;
            lead._timelineLoaded = true;
            await this.saveLeadTimeline(lead.id, res.data);
        }
        return lead.timeline || [];
    },

    /**
     * Aplica um evento Realtime (INSERT, UPDATE, DELETE) diretamente na lista em memória e no IndexedDB.
     */
    async applyRealtimePayload(leadsList, payload) {
        if (!payload || !Array.isArray(leadsList)) return { updated: false, leads: leadsList };
        const evt = payload.eventType;
        if (evt === 'DELETE' && payload.old && payload.old.id) {
            const delId = payload.old.id;
            const next = leadsList.filter(l => l.id !== delId);
            await this.deleteLeads([delId]);
            return { updated: true, event: 'DELETE', leadId: delId, leads: next };
        }
        if ((evt === 'INSERT' || evt === 'UPDATE') && payload.new && payload.new.id) {
            const row = payload.new;
            const idx = leadsList.findIndex(l => l.id === row.id);
            if (idx >= 0) {
                const prev = leadsList[idx];
                leadsList[idx] = {
                    ...prev,
                    ...row,
                    timeline: Array.isArray(prev.timeline) ? prev.timeline : [],
                    _timelineLoaded: Boolean(prev._timelineLoaded)
                };
            } else {
                leadsList.unshift({
                    ...row,
                    timeline: [],
                    _timelineLoaded: false
                });
            }
            await this.putLeads([leadsList[idx >= 0 ? idx : 0]]);
            if (row.updated_at) await this.setMeta('lastSyncAt', row.updated_at);
            return { updated: true, event: evt, leadId: row.id, leads: leadsList };
        }
        return { updated: false, leads: leadsList };
    }
};

if (typeof window !== 'undefined') {
    window.CockpitStore = CockpitStore;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CockpitStore;
}
