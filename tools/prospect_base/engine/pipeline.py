"""Pipeline genérico: carga -> nomes -> dedupe -> limpeza -> mescla -> escore -> gancho -> exportação.

Todo o conhecimento do segmento/empresa vem do perfil P (módulo em profiles/<nome>/__init__.py).
Regra-mãe: nada é deduzido. Decisões ambíguas ficam em P.NOMERGE / P.FLAGS_BY_KEY / P.MANUAL_NAMES,
sempre validadas com o usuário antes de entrar no perfil.
"""
import re, collections
import pandas as pd
from urllib.parse import urlparse
from . import contacts as C, scoring, names
from .address import clean_addr, city_in
from .textutil import norm, nz

CARRY = ['Tipo', 'Perfil dos projetos', 'Obras de referência', 'Arquitetos responsáveis', 'Gancho de abordagem',
         'Argumento prioritário', 'Prioridade sugerida', 'Mini bio', 'Insights da marca', 'Motivo da qualificação']
BAD_DOMAINS = {'instagram.com', 'beacons.ai', 'api.whatsapp.com', 'wa.me', 'linktr.ee', 'facebook.com', 'bio.site', 'linktree.com'}

def _dom(u):
    if not isinstance(u, str): return None
    return urlparse(u if u.startswith('http') else 'http://' + u).netloc.lower().replace('www.', '')

def _digs(s):
    if not isinstance(s, str): return None
    d = re.sub(r'\D', '', s)
    if len(d) >= 12 and d.startswith('55'): d = d[2:]
    return d[-10:] if len(d) >= 10 else (d if len(d) >= 8 else None)

# ---------------------------------------------------------------- 1. nomes + grupos de duplicados
def stage_names_and_groups(A, P):
    clean = names.make_name_cleaner(P.NAME_DESC_RE, P.NAME_CITIES, P.MANUAL_NAMES, P.BRANDS,
                                    getattr(P, 'NAME_PREFIX_STRIP', None), getattr(P, 'NAME_CITY_SUFFIX_RE', None))
    A['Nome'] = A['Nome original'].map(clean)
    A['dom'] = A['Site'].map(_dom)
    A['t1'] = A['Telefone escritório'].map(lambda s: _digs(s.split('(mesmo')[0]) if isinstance(s, str) else None)
    A['w1'] = A['WhatsApp escritório'].map(_digs)
    A['nk2'] = A['Nome'].map(norm)
    parent = list(range(len(A)))
    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]; i = parent[i]
        return i
    def union(a, b): parent[find(a)] = find(b)
    for key in ['nk2', 't1', 'w1']:
        g = collections.defaultdict(list)
        for i, v in A[key].items():
            if isinstance(v, str) and v: g[v].append(i)
        for ids in g.values():
            for j in ids[1:]: union(ids[0], j)
    g = collections.defaultdict(list)
    for i, v in A['dom'].items():
        if isinstance(v, str) and v not in BAD_DOMAINS: g[v].append(i)
    for ids in g.values():
        for j in ids[1:]: union(ids[0], j)
    # Mesclagens decididas com o usuário que o motor não detecta sozinho (ex.: o número compartilhado está em outra coluna).
    # Perfil opcional: FORCE_MERGE = [('Nome A', 'Nome B'), ...] (nomes originais; cada um deve existir uma única vez).
    for a, b in getattr(P, 'FORCE_MERGE', []):
        ia, ib = A.index[A['Nome original'] == a].tolist(), A.index[A['Nome original'] == b].tolist()
        if len(ia) != 1 or len(ib) != 1:
            raise ValueError(f'FORCE_MERGE sem correspondência única: {a!r} ({len(ia)}) / {b!r} ({len(ib)})')
        union(ia[0], ib[0])
    A['grp'] = [find(i) for i in range(len(A))]
    return A

def _idx_by_key(A, keys):
    """Converte chaves (Nome original, Cidade) em índices da base."""
    out = {}
    for k in keys:
        m = A[(A['Nome original'] == k[0]) & (A['Cidade'].fillna('') == (k[1] or ''))]
        if len(m) != 1:
            raise ValueError(f'Chave de override sem correspondência única no arquivo: {k} -> {len(m)} linhas. '
                             'Alinhar com o usuário antes de seguir.')
        out[k] = m.index[0]
    return out

# ---------------------------------------------------------------- 2. limpeza por linha
def row_clean(r, P):
    d = {'Nome': r['Nome']}
    if 'Insights da marca' not in r.index and len( [c for c in r.index if str(c).startswith('Insights')] ) == 1:
        col_ins = [c for c in r.index if str(c).startswith('Insights')][0]
        r = r.copy(); r['Insights da marca'] = r[col_ins]
    for c in CARRY: d[c] = nz(r.get(c), P.PLACEHOLDER)
    site, alt = C.norm_site(r['Site'], P.PLACEHOLDER)
    d['Site'] = site
    d['Instagram'] = C.norm_insta(r['Instagram'], P.PLACEHOLDER) or (C.norm_insta(alt, P.PLACEHOLDER) if alt and 'instagram' in alt else None)
    d['_site_bruto_ruim'] = alt
    c = nz(r['Cidade'], P.PLACEHOLDER); extra = None
    if c in P.COMPOSITE: c, extra = P.COMPOSITE[c]
    d['Cidade'] = c; d['_extra_city'] = extra
    ad, cep = clean_addr(r['Endereço'], getattr(P, 'ADDR_PREFIX_RE', None))
    d['Endereço'] = ad; d['CEP'] = cep
    raw = r['Endereço'] if isinstance(r['Endereço'], str) else ''
    d['_addr_phones'] = C.phones(raw) if not re.search(r'(R\.|Rua|Av\.|Avenida)', raw) or re.match(r'^(aberto|fecha)', raw, re.I) else []
    d['_city_from_addr'] = city_in(ad or raw, P.CITYLIST) if (ad or raw) else None
    wa_raw = r['WhatsApp escritório']
    d['_wa'] = C.phones(wa_raw) if r['_key'] not in P.EXCL_WA else []
    d['_wa_unconf'] = isinstance(wa_raw, str) and bool(re.search(r'n[ãa]o confirmad', wa_raw, re.I))
    d['_tel'] = C.phones(r['Telefone escritório'])
    d['_otros'] = C.phones(r['Outros WhatsApp / telefones'])
    d['_em1'] = C.emails(r['E-mail novos projetos'])
    pc = r['E-mail / canal parcerias e fornecedores']
    d['_em2'] = C.emails(pc)
    d['_canal_txt'] = None if (not isinstance(pc, str) or C.emails(pc) or re.match(r'^n[ãa]o listado', pc, re.I)) else nz(pc, P.PLACEHOLDER)
    d['_aba'] = r['aba']; d['_idx'] = r.name
    d['_city_from_search'] = None; d['_cidade_inferida'] = False; d['_semsite'] = False; d['_site_down'] = None
    P.extra_clean(r, d)            # convenções textuais da planilha de origem
    return d

# ---------------------------------------------------------------- 3. mescla + campos finais
def stage_clean_and_merge(A, P):
    A['_key'] = list(zip(A['Nome original'], A['Cidade'].fillna('')))
    nomerge = _idx_by_key(A, P.NOMERGE)
    for k, i in nomerge.items(): A.loc[i, 'grp'] = 10000 + i
    flags = collections.defaultdict(list)
    for k, i in _idx_by_key(A, P.FLAGS_BY_KEY).items(): flags[i].extend(P.FLAGS_BY_KEY[k])
    rows = {i: row_clean(A.loc[i], P) for i in A.index}
    keep_name = set(getattr(P, 'KEEP_NAME', ()))      # perfil opcional: nome que dá nome ao lead quando há mesclagem
    def richness(d): return (sum(1 for k, v in d.items() if not k.startswith('_') and v) + (100 if d['_aba'] == P.VETTED_STAGE else 0)
                             + (1000 if d['Nome'] in keep_name else 0))
    mlog, recs = [], []
    for g, idxs in A.groupby('grp').groups.items():
        idxs = list(idxs)
        L = sorted(idxs, key=lambda i: -richness(rows[i]))
        p = dict(rows[L[0]]); p['_ids'] = idxs; p['_aba_all'] = {rows[i]['_aba'] for i in idxs}
        for i in L[1:]:
            o = rows[i]
            for k, v in o.items():
                if k.startswith('_'):
                    if k in ('_wa', '_tel', '_otros', '_em1', '_em2', '_addr_phones'): p[k] = list(dict.fromkeys(p[k] + v))
                    elif k == '_semsite': p[k] = p[k] and v
                    elif k in ('_site_down', '_site_bruto_ruim', '_extra_city', '_canal_txt', '_city_from_addr', '_city_from_search') and not p.get(k): p[k] = v
                    continue
                if not p.get(k) and v: p[k] = v
                elif k == 'Site' and v and p.get('Site') and v != p['Site']: flags[L[0]].append(f'Site alternativo: {v}')
        if len(idxs) > 1:
            mlog.append({'Registro mantido': A.loc[L[0], 'Nome original'],
                         'Registros mesclados': ' | '.join(f"{A.loc[i, 'Nome original']} ({A.loc[i, 'aba']})" for i in L[1:]),
                         'Nome final': p['Nome']})
        p['_flags'] = list(flags.get(L[0], [])) + [x for i in idxs if i != L[0] for x in flags.get(i, [])]
        recs.append(p)
    out = []
    for p in recs:
        d = {'Nome': p['Nome']}
        vetted = P.VETTED_STAGE in p['_aba_all']
        d['_mest'] = vetted
        city = p['Cidade']; cfa = p['_city_from_addr']; inf = []
        if cfa and city and cfa != city and not p['_cidade_inferida']: inf.append(f'Cidade do endereço ({cfa}) difere da cidade cadastrada')
        if cfa and (not city or p['_cidade_inferida']):
            if city and cfa != city: inf.append(f'Cidade ajustada de {city} para {cfa} pelo endereço')
            city = cfa
        if not city and p.get('_city_from_search'):
            city = p['_city_from_search']; inf.append('Cidade inferida da região da busca (confirmar)')
        d['Cidade'] = city
        d['UF'] = P.UF_BY_CITY.get(city, P.DEFAULT_UF) if city else None
        d['Região comercial'] = P.regiao(city)
        for k in ['Tipo', 'Endereço', 'CEP', 'Site', 'Instagram']: d[k] = p[k]
        wa = None
        conf = [n for n in p['_wa']] if not p['_wa_unconf'] else []
        if conf: wa = conf[0]
        pool = []
        for n in p['_tel'] + (p['_wa'] if p['_wa_unconf'] else conf[1:]) + p['_otros'] + p['_addr_phones']:
            if n != wa and n not in pool: pool.append(n)
        cel = next((n for n in pool if C.is_mobile(n)), None)
        fixo = next((n for n in pool if not C.is_mobile(n)), None)
        resto = [n for n in pool if n not in (cel, fixo)]
        d['WhatsApp (confirmado)'] = C.fmt(wa) if wa else None
        d['Celular (provável WhatsApp)'] = C.fmt(cel) if cel else None
        d['Telefone fixo'] = C.fmt(fixo) if fixo else None
        d['Outros telefones'] = '; '.join(C.fmt(n) for n in resto) or None
        d['_wa_e164'] = wa; d['_cel_e164'] = cel; d['_fixo_e164'] = fixo
        allnums = ([wa] if wa else []) + pool
        bad = sorted({n[3:5] for n in allnums if n[3:5] not in P.MAIN_DDDS})
        if bad: inf.append('DDD fora da região principal: ' + ', '.join(bad))
        d['E-mail novos projetos'] = p['_em1'][0] if p['_em1'] else None
        d['E-mail parcerias / fornecedores'] = (p['_em2'][0] if p['_em2'] else p['_canal_txt'])
        if not d['E-mail novos projetos'] and p['_em2'] and p['_em2'][0] != d['E-mail parcerias / fornecedores']:
            d['E-mail novos projetos'] = p['_em2'][0]
        for k in ['Arquitetos responsáveis', 'Obras de referência', 'Argumento prioritário', 'Gancho de abordagem', 'Mini bio']:
            d[k] = p[k]
        if d['Nome'] in P.FILL_PEOPLE and not d['Arquitetos responsáveis']: d['Arquitetos responsáveis'] = P.FILL_PEOPLE[d['Nome']]
        P.source_fields(p, d, inf, vetted)       # Insights, Motivo, Perfil, Etapa, notas de origem
        d['Prioridade original'] = p['Prioridade sugerida']
        d['Observação de dados'] = '; '.join(dict.fromkeys(inf + p['_flags'])) or None
        d['_ids'] = p['_ids']
        out.append(d)
    return pd.DataFrame(out), pd.DataFrame(mlog), nomerge, flags

# ---------------------------------------------------------------- 4. escore + gancho
def stage_score(O, P):
    res = O.apply(lambda r: scoring.score_row(r, P), axis=1)
    O['Pontuação'] = [x[0] for x in res]; O['_sc'] = [x[1] for x in res]; O['_tags'] = [x[2] for x in res]
    O['Prioridade'] = [scoring.band(s, e, P) for s, e in zip(O['Pontuação'], O['Etapa'])]
    O['Motivo da prioridade'] = [P.motivo(t, e) for t, e in zip(O['_tags'], O['Etapa'])]
    return O

def stage_hooks(O, P):
    hand = {names.caps_fix(k, P.BRANDS): v for k, v in P.HAND.items()}
    hook_col = getattr(P, 'LAST_COLUMN', 'Gancho')
    O[hook_col] = O.apply(lambda r: hand.get(r['Nome']) or P.make_hook(r), axis=1)
    if hook_col != 'Gancho':
        O['Gancho'] = O[hook_col]
    return O

# ---------------------------------------------------------------- 5. exportação
def build_base(O, P):
    order = {n: i for i, n in enumerate(P.PRIORITY_ORDER)}
    d = O.copy(); d['_o'] = d['Prioridade'].map(order)
    d = d.sort_values(['_o', 'Pontuação', 'Nome'], ascending=[True, False, True]).reset_index(drop=True)
    d = d.rename(columns={'_wa_e164': 'WhatsApp (E.164)', '_cel_e164': 'Celular (E.164)', '_fixo_e164': 'Telefone fixo (E.164)'})
    B = d[P.COLUMNS].copy()
    bad = {'nan', 'none', 'não publicado', ''}
    for c in B.columns:
        B[c] = B[c].apply(lambda v: None if (v is None or (isinstance(v, float) and pd.isna(v)) or str(v).strip().lower() in bad)
                          else (v.strip() if isinstance(v, str) else v))
    B['Pontuação'] = B['Pontuação'].astype('Int64')
    return B

def validate(B, P):
    """Checklist obrigatório: falha alto se algo estiver fora do padrão."""
    errs = []
    if list(B.columns)[-1] != P.LAST_COLUMN: errs.append(f'{P.LAST_COLUMN} deve ser a última coluna')
    if B[P.LAST_COLUMN].isna().any(): errs.append('há ganchos vazios')
    if B[P.LAST_COLUMN].duplicated().any(): errs.append('há ganchos repetidos')
    for c in B.columns:
        if B[c].astype(str).str.contains(r'\bnan\b', case=False, regex=True).any(): errs.append(f'"nan" na coluna {c}')
    for c in ['WhatsApp (E.164)', 'Celular (E.164)', 'Telefone fixo (E.164)']:
        s = B[c].dropna()
        if (~s.str.match(r'^\+55\d{10,11}$')).any(): errs.append(f'E.164 inválido em {c}')
    dup = B['Nome'][B['Nome'].duplicated(keep=False)].unique().tolist()
    return errs, dup

def export(B, mlog, P, outdir, nomerge, flags, A):
    import os
    from openpyxl.styles import Font, PatternFill, Alignment
    extra = [{'Registro mantido': f'{k[0]} ({k[1]})', 'Registros mesclados': 'NÃO mesclado: ' + ' / '.join(flags.get(i, ['decisão validada com o usuário'])),
              'Nome final': A.loc[i, 'Nome']} for k, i in nomerge.items()]
    L = pd.concat([mlog, pd.DataFrame(extra)], ignore_index=True) if extra else mlog
    D = pd.DataFrame(P.DICTIONARY, columns=['Coluna', 'Tipo', 'Descrição'])
    os.makedirs(outdir, exist_ok=True)
    base = os.path.join(outdir, P.OUTPUT_NAME)
    with pd.ExcelWriter(base + '.xlsx', engine='openpyxl') as w:
        B.rename(columns=P.OUTPUT_LABELS).to_excel(w, sheet_name='BASE', index=False)
        D.to_excel(w, sheet_name='Dicionário de dados', index=False)
        L.to_excel(w, sheet_name='Log de higienização', index=False)
        for ws in w.book:
            for c in ws[1]:
                c.font = Font(name='Arial', bold=True, color='FFFFFF', size=10)
                c.fill = PatternFill('solid', fgColor='5B2A2A'); c.alignment = Alignment(vertical='center', wrap_text=True)
            ws.freeze_panes = 'B2'; ws.auto_filter.ref = ws.dimensions
            for col in ws.columns:
                mx = max((len(str(c.value)) for c in col[:80] if c.value), default=8)
                ws.column_dimensions[col[0].column_letter].width = min(max(12, mx * 0.9), 60)
            for row in ws.iter_rows(min_row=2):
                for c in row: c.font = Font(name='Arial', size=9)
        bs = w.book['BASE']; bs.column_dimensions[bs.cell(1, len(B.columns)).column_letter].width = 90
    B.rename(columns=P.OUTPUT_LABELS).to_csv(base + '.csv', index=False, encoding='utf-8')
    return base

def run(P, src, outdir):
    A = P.load(src)
    A = stage_names_and_groups(A, P)
    O, mlog, nomerge, flags = stage_clean_and_merge(A, P)
    O = stage_score(O, P)
    O = stage_hooks(O, P)
    B = build_base(O, P)
    errs, dup = validate(B, P)
    base = export(B, mlog, P, outdir, nomerge, flags, A)
    return {'base': B, 'O': O, 'mlog': mlog, 'errors': errs, 'duplicate_names': dup, 'path': base, 'n_input_rows': len(A)}
