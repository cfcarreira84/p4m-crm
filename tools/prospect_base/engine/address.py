"""Endereço, CEP e cidade."""
import re
from .textutil import f as _f

ST = r'(?:AV:?|R\.|Rua|Av\.|Avenida|Av |Al\.|Alameda|Rod\.|Rodovia|Estrada|Estr\.|Pra[çc]a|Pça\.?|Travessa|Tv\.|Largo)'
JUNK = re.compile(r'\s*(·|\bAberto\b|\bFecha\b|\bAbre\b|Telefone|WhatsApp|Whatsapp|Instagram|E-mail|Email|Contato|CONTATO|ATENDIMENTO|Hor[aá]rio|Segunda|Seg\.|Siga|SIGA|Quero|Enviar|ENVIAR|Fale|FALE|©|Copyright|Todos os direitos|\(\d{2}\)|\+55|TEL|E-MAIL).*$')

def clean_addr(a, prefix_re=None):
    """-> (endereço limpo | None, CEP | None).
    prefix_re: prefixos de categoria do segmento que antecedem o endereço (ex.: 'Arquiteto · ')."""
    if not isinstance(a, str):
        return None, None
    s = re.sub(r'\s+', ' ', re.sub('[\u200b\ufeff\ue000-\uf8ff]', '', a)).strip()
    s = re.sub(r'·\s*·', '·', s)
    if not s or re.match(r'^(n[ãa]o (publicado|listado)|endere[çc]o n[ãa]o|s[ãa]o paulo, brasil)', s, re.I):
        return None, None
    cm = re.search(r'\b(\d{5})-?(\d{3})\b', s)
    cep = f'{cm.group(1)}-{cm.group(2)}' if cm else None
    if prefix_re is not None:
        for _ in range(3):
            s = prefix_re.sub('', s).strip()
    if re.fullmatch(r'(aberto|fecha|abre)[^·]*', s, re.I) or re.fullmatch(r'[\d\s().+·-]+', s) or re.match(r'^(aberto|fecha)', s, re.I):
        return None, cep
    m0 = re.fullmatch(r'(\d{1,5})\s+(' + ST + r'.*)', s)
    if m0:
        return f'{m0.group(2)}, {m0.group(1)}', cep
    m = re.search(ST + r'\s*[^,;·|]{2,70}?(?:,\s*|\s+-\s*|\s+n[ºo°.]?\s*|\s+)(?:n[ºo°.]?\s*)?\d{1,5}(?:\.\d{3})?[A-Za-z]?\b', s)
    if m:
        start = m.start(); head = s[start:m.end()]; tail = JUNK.sub('', s[m.end():])
        out = head + tail
    else:
        m2 = re.search(ST + r'\s+\S.*', s)
        if not m2:
            return None, cep
        start = m2.start(); out = JUNK.sub('', m2.group(0))
    pre = s[:start].strip(' -–—·,')
    out = re.sub(r'\s+', ' ', out).strip(' ,-–—.|•')
    mc = re.search(r'^(.*?\d{5}-?\d{3})', out)
    if mc:
        out = mc.group(1)
    else:
        ms = re.search(r'^(.*?\b(?:SP|S[ãa]o Paulo)\b[\s,.\-–—|•]*)', out)
        if ms:
            out = ms.group(1).strip(' ,-–—.|•')
    out = re.sub(r'\b(CEP|Cep)\b[:\s]*(?=\d{5})', '', out).strip(' ,-–—.|•')
    if pre and len(pre) <= 45 and re.search(r'(office|tower|torre|edif|business|center|centro emp|plaza|sky|mondial|midtown|premium|corporate|residence|boulevard|ed\.)', pre, re.I):
        out = f'{pre} - {out}'
    if len(out) > 120:
        out = out[:120].rsplit(' ', 1)[0]
    return (re.sub(r'\s+', ' ', out) or None), cep

def city_in(text, citylist):
    """Primeira cidade da lista citada no texto (a lista deve ter a capital/'São Paulo' por último)."""
    if not isinstance(text, str):
        return None
    t = _f(text).replace('’', "'")
    for c in citylist[:-1]:
        if re.search(r'(?<![a-z])' + re.escape(_f(c)) + r'(?![a-z])', t) and not (c == 'Itu' and re.search(r'itu[^ -]', t)):
            return c
    if re.search(r'são paulo|sao paulo', t) and not re.search(r'(r\.|rua|av\.?|avenida)\s+(estado de )?s[ãa]o paulo', t):
        return 'São Paulo' if re.search(r'sao paulo\s*[-–,–]\s*sp|sao paulo\s*\|', t) else None
    return None
