"""Escore explicável 0-100 guiado por REGRAS declaradas no perfil do segmento.

O perfil define:
  TEXT_FIELDS_FULL / TEXT_FIELDS_NARROW : campos que formam o texto de busca (amplo e restrito)
  FLAGS   : {nome: (lista_de_regex, 'full'|'narrow')}  -> sinais booleanos achados no texto
  DIMS    : {dimensão: teto}
  RULES   : lista ordenada de regras (a ordem define a ordem das tags -> 'Motivo da prioridade')
  BANDS   : [(piso, nome)...] em ordem decrescente; INCOMPLETE_BAND para etapa 'Dados incompletos'

Tipos de regra (todas têm 'dim' e 'pts'; opcionais: 'tag', 'if' (flags exigidas), 'unless' (flags proibidas),
'group' (só a 1ª regra do grupo que casar pontua)):
  {'t':'flag'}                                   -> pontua se as flags de 'if'/'unless' casam
  {'t':'tier','metric':'years'|'nproj','steps':[(minimo, pts, 'tag{v}' | None), ...]}  -> 1º degrau atingido
  {'t':'present','field':X}                      -> campo preenchido
  {'t':'field_regex','field':X,'regex':R}        -> regex no valor bruto do campo
  {'t':'field_in','field':X,'values':[...]}      -> valor do campo na lista
  {'t':'etapa_map','map':{etapa: pts}}           -> pontos por Etapa
  {'t':'map_field','field':X,'map':{valor: pts}} -> pontos por valor de campo
  {'t':'rating','min':4.8,'etapa':'Dados incompletos','pts':3,'tag':'nota {v} no Google'}
"""
import re
from .textutil import f, has

def years(t, ref_year):
    ys = [int(x) for x in re.findall(r'(\d{1,2})\s*anos', t)]
    for y in re.findall(r'desde\s*(?:o\s*ano\s*de\s*)?(19\d\d|20[0-2]\d)', t):
        ys.append(ref_year - int(y))
    return max([y for y in ys if y <= 60], default=0)

def nproj(t):
    n = [int(x.replace('.', '')) for x in re.findall(r'(?:mais de|\+)\s*([\d.]{2,6})\s*(?:projetos|obras|casas)', t)]
    return max(n, default=0)

def rating(t):
    m = re.search(r'avaliad[ao]\s*(?:em\s*)?(\d),(\d)', t)
    return float(f'{m.group(1)}.{m.group(2)}') if m else None

def _txt(r, fields):
    return f(' | '.join(str(r[c]) for c in fields if c in r.index and isinstance(r[c], str)))

def score_row(r, P):
    t = _txt(r, P.TEXT_FIELDS_FULL)
    t2 = _txt(r, P.TEXT_FIELDS_NARROW)
    fl = {k: has(t2 if scope == 'narrow' else t, *rx) for k, (rx, scope) in P.FLAGS.items()}
    dims = {d: 0 for d in P.DIMS}
    tags = []
    done_groups = set()
    metrics = {'years': years(t, P.REF_YEAR), 'nproj': nproj(t)}
    for rule in P.RULES:
        g = rule.get('group')
        if g and g in done_groups:
            continue
        ok = all(fl[k] for k in rule.get('if', [])) and not any(fl[k] for k in rule.get('unless', []))
        typ = rule.get('t', 'flag'); d = rule['dim']
        if typ == 'flag':
            if ok:
                dims[d] += rule['pts']
                if rule.get('tag'): tags.append(rule['tag'])
                if g: done_groups.add(g)
        elif typ == 'tier':
            v = metrics[rule['metric']]
            for mn, pts, tg in rule['steps']:
                if v >= mn:
                    dims[d] += pts
                    if tg: tags.append(tg.format(v=v))
                    break
        elif typ in ('present', 'field_regex', 'field_in'):
            val = r[rule['field']] if rule['field'] in r.index else None
            hit = isinstance(val, str) and (typ == 'present'
                  or (typ == 'field_regex' and re.search(rule['regex'], val))
                  or False)
            if typ == 'field_in': hit = val in rule['values']
            if hit and ok:
                dims[d] += rule['pts']
                if rule.get('tag'): tags.append(rule['tag'])
                if g: done_groups.add(g)
        elif typ == 'etapa_map':
            dims[d] += rule['map'][r['Etapa']]
        elif typ == 'map_field':
            dims[d] += rule['map'].get(r[rule['field']], 0)
        elif typ == 'rating':
            rt = rating(t)
            if r['Etapa'] == rule['etapa'] and rt and rt >= rule['min']:
                dims[d] += rule['pts']; tags.append(rule['tag'].format(v=f'{rt:.1f}'.replace('.', ',')))
    for d, cap in P.DIMS.items():
        dims[d] = max(0, min(cap, dims[d])) if cap else dims[d]
    return min(100, sum(dims.values())), dims, tags

def band(score, etapa, P):
    if etapa == 'Dados incompletos':
        return P.INCOMPLETE_BAND
    for piso, nome in P.BANDS:
        if score >= piso:
            return nome
    return P.BANDS[-1][1]
