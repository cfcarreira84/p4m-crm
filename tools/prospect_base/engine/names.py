"""Nome de mercado: tira descritores, cidades, ALL CAPS e prefixos."""
import re
from .textutil import strip_acc

SEP = re.compile(r'\s+[\|·•–—]\s+|\s+-\s+|\s*\|\s*|\s-(?=\w)')
SMALL = {'DE', 'DA', 'DO', 'E', 'NA', 'EM', 'DAS', 'DOS', 'LA', '&', '+'}

def caps_fix(n, brands):
    letters = re.sub(r'[^A-Za-zÀ-ÿ]', '', n)
    if not letters or letters.upper() != letters or len(letters) < 4 and n.upper() == n and ' ' not in n:
        return n
    out = []
    for i, tok in enumerate(n.split(' ')):
        core = re.sub(r'[^A-Za-zÀ-ÿ0-9+]', '', tok)
        if core in brands or re.search(r'\d', core) or tok in ('&', '+', '-'):
            out.append(tok)
        elif core in SMALL and i > 0:
            out.append(tok.lower())
        else:
            out.append(tok[:1].upper() + tok[1:].lower())
    return ' '.join(out)

def make_name_cleaner(desc_re, cities, manual, brands, prefix_strip=None, city_suffix_re=None):
    """desc_re: regex de segmentos 'descritivos' (ex.: 'Escritório de arquitetura').
    cities: nomes de cidade sem acento (para detectar segmentos que são só cidade).
    manual: {nome original: nome de mercado} (decisões validadas com o usuário).
    prefix_strip: regex de prefixo a remover (ex.: '^Arquiteta?\\s+(?=\\S+\\s+\\S)')."""
    cities_join = ' '.join(cities)

    def seg_is_city(s):
        n = strip_acc(s).lower()
        n = re.sub(r'\b(arquitet[oa]s?|escritorio|de|em|e|do|da|sp|/|regiao|\W)\b', ' ', n)
        n = re.sub(r'[^a-z ]', ' ', n).split()
        return len(n) == 0 or ' '.join(n) in cities or all(w in cities_join for w in n)

    def clean(n):
        n0 = str(n).strip()
        if n0 in manual:
            return manual[n0]
        n1 = re.sub(r'\s+', ' ', n0).strip(' .')
        segs = [s.strip() for s in SEP.split(n1) if s.strip()]
        if len(segs) > 1:
            keep = [s for s in segs if not desc_re.match(s) and not seg_is_city(s)]
            n1 = keep[0] if keep else segs[0]
        if city_suffix_re is not None:
            n1 = city_suffix_re.sub('', n1).strip(' .-')
        n1 = caps_fix(n1, brands)
        if prefix_strip is not None:
            n1 = re.sub(prefix_strip, '', n1)
        return n1
    return clean
