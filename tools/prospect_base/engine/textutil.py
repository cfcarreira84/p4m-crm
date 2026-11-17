"""Utilitários de texto compartilhados (sem dependência de segmento)."""
import re, unicodedata, zlib

def strip_acc(s):
    return ''.join(c for c in unicodedata.normalize('NFD', str(s)) if unicodedata.category(c) != 'Mn')

def norm(s):
    """Chave de comparação: minúsculo, sem acento, só [a-z0-9]."""
    return re.sub(r'[^a-z0-9]', '', strip_acc(s).lower())

def f(s):
    """Texto para busca por regex: minúsculo e sem acentos."""
    return ''.join(c for c in unicodedata.normalize('NFD', str(s).lower()) if unicodedata.category(c) != 'Mn')

def has(t, *kws):
    return any(re.search(k, t) for k in kws)

def pick(name, opts, salt=''):
    """Escolha determinística (hash do nome): mesma entrada, mesma variação."""
    return opts[zlib.crc32((name + salt).encode()) % len(opts)]

def nz(v, placeholder=None):
    """Valor limpo ou None. Remove vazios, 'nan' e placeholders do segmento."""
    if not isinstance(v, str):
        return None
    v = v.strip()
    if not v or v.lower() == 'nan' or (placeholder and placeholder.match(v)):
        return None
    return v
