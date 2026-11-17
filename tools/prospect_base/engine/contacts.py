"""Telefones (E.164), sites, Instagram e e-mails."""
import re
from urllib.parse import urlparse
from .textutil import nz

VALID_DDD = set('11 12 13 14 15 16 17 18 19 21 22 24 27 28 31 32 33 34 35 37 38 41 42 43 44 45 46 47 48 49 51 53 54 55 61 62 63 64 65 66 67 68 69 71 73 74 75 77 79 81 82 83 84 85 86 87 88 89 91 92 93 94 95 96 97 98 99'.split())
PH = re.compile(r'(?<!\d)(?:\+?55[\s.-]*)?\(?(\d{2})\)?[\s.-]*(9)?[\s.-]*(\d{4})[\s.-]*(\d{4})(?!\d)')

def phones(s):
    """Extrai telefones brasileiros válidos de um texto -> lista de '+55DDNUMERO'.
    Números estrangeiros (+1, +351...) são descartados, nunca convertidos."""
    if not isinstance(s, str):
        return []
    s = re.sub(r'\+(?!55)\d{1,3}[\d\s.()\-]{6,}', '', s)
    s = re.sub(r'\([^)]*(mesmo|n[úu]mero|bot[ãa]o|link)[^)]*\)', '', s, flags=re.I)
    out = []
    for m in PH.finditer(s):
        ddd, nine, a, b = m.groups()
        if ddd not in VALID_DDD:
            continue
        if nine:
            num = f'{ddd}9{a}{b}'
            if len(num) != 11:
                continue
        else:
            num = f'{ddd}{a}{b}'
            if a[0] in '01' or len(num) != 10:
                continue
            if a[0] == '9':      # fixo de 8 dígitos começando em 9 é improvável
                continue
        out.append('+55' + num)
    return list(dict.fromkeys(out))

def is_mobile(e164):
    return len(e164) == 14 and e164[5] == '9'

def fmt(e164):
    d = e164[3:]
    return f'+55 {d[:2]} {d[2:7]}-{d[7:]}' if len(d) == 11 else f'+55 {d[:2]} {d[2:6]}-{d[6:]}'

BADHOST = {'instagram.com', 'beacons.ai', 'api.whatsapp.com', 'wa.me', 'linktr.ee', 'facebook.com', 'bio.site', 'linktree.com', 'lin.ee'}

def host(u):
    return urlparse(u if u.startswith('http') else 'http://' + u).netloc.lower().replace('www.', '')

def norm_site(u, placeholder=None):
    """-> (site_normalizado | None, link_de_rede_social_ou_bio | None)"""
    u = nz(u, placeholder)
    if not u:
        return None, None
    if not re.match(r'https?://', u):
        u = 'https://' + u
    if host(u) in BADHOST:
        return None, u
    p = urlparse(u)
    path = p.path.rstrip('/')
    return f'{p.scheme}://{p.netloc.lower()}{path}' + (f'?{p.query}' if p.query else ''), None

def norm_insta(v, placeholder=None):
    v = nz(v, placeholder)
    if not v:
        return None
    m = re.search(r'instagram\.com/([A-Za-z0-9._]+)', v)
    h = m.group(1) if m else (v.lstrip('@') if re.fullmatch(r'@?[A-Za-z0-9._]+', v) else None)
    if not h or h.lower() in {'p', 'reel', 'reels', 'explore', 'rsrc.php', 'accounts', 'stories', 'tv'} or '.php' in h.lower():
        return None
    return f'https://www.instagram.com/{h.lower().rstrip(".")}'

EMAIL = re.compile(r'[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+')
JUNKMAIL = re.compile(r'mysite|teste|example|sentry|wixpress|seuemail|seu@|email@email|@dominio|nome@', re.I)

def emails(s):
    if not isinstance(s, str):
        return []
    s = s.split('&quot;')[0]
    out = []
    for e in EMAIL.findall(s):
        e = e.lower().rstrip('.')
        if JUNKMAIL.search(e) or re.search(r'\.(png|jpg|jpeg|gif|webp|svg)$', e):
            continue
        out.append(e)
    return list(dict.fromkeys(out))
