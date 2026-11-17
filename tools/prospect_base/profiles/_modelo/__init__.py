"""MODELO DE PERFIL PARA UM NOVO SEGMENTO (loja de móveis planejados, pet shop, design de interiores, restaurantes, hotéis...).

COMO USAR: copie esta pasta para profiles/<segmento_empresa>/ e preencha CADA item abaixo.
Tudo que estiver como 'TODO' bloqueia a execução (engine/profile_check.py). NÃO preencha por dedução:
cada item abaixo vem de uma resposta do usuário (ver README.md > Briefing de segmento).
"""
import re, pandas as pd
from datetime import date

NAME = 'TODO'                    # ex.: 'pet_shop_marca'
REF_YEAR = date.today().year      # base para 'desde AAAA' -> anos de atuação
VETTED_STAGE = 'TODO'            # rótulo do estágio JÁ qualificado manualmente (ex.: 'MESTRE'); o resto vira 'A revisar'/'Dados incompletos'

# ---- 1. ENTRADA --------------------------------------------------------------------------
# O engine trabalha com colunas CANÔNICAS. O load() deve devolver um
# DataFrame com: 'Nome original','aba','Tipo','Cidade','Endereço','Site','Instagram','Telefone escritório',
# 'WhatsApp escritório','Outros WhatsApp / telefones','E-mail novos projetos','E-mail / canal parcerias e fornecedores',
# 'Perfil dos projetos','Obras de referência','Arquitetos responsáveis' (= responsáveis/decisores do segmento),
# 'Gancho de abordagem','Argumento prioritário','Prioridade sugerida','Mini bio','Insights da marca','Motivo da qualificação'.
# Colunas inexistentes na origem entram vazias. Mapeamento de colunas = decisão a alinhar com o usuário.
def load(src):
    raise NotImplementedError('TODO: mapear as abas/colunas da planilha deste segmento para as colunas canônicas')

PLACEHOLDER = re.compile(r'^(n[ãa]o (publicado|listado)|nome n[ãa]o capturado)', re.I)   # textos-padrão que significam "vazio"

# ---- 2. NOMES ----------------------------------------------------------------------------
NAME_CITIES = []                                    # cidades (minúsculas, sem acento) que aparecem coladas ao nome
NAME_DESC_RE = re.compile(r'^(loja|restaurante|hotel|clinica|pet shop)\b', re.I)   # segmentos DESCRITIVOS a descartar
MANUAL_NAMES = {}                                   # {nome original: nome de mercado}, só com validação do usuário
BRANDS = set()                                      # siglas que ficam em MAIÚSCULAS
NAME_PREFIX_STRIP = None; NAME_CITY_SUFFIX_RE = None

# ---- 3. GEOGRAFIA ------------------------------------------------------------------------
CITYLIST = []                                       # cidades-alvo (com acento); a capital/'São Paulo' por último
COMPOSITE = {}                                      # {'Cidade (texto composto)': ('Cidade', 'nota')}
REG = {}                                            # cidade -> região comercial (definir com o usuário)
def regiao(c):
    if not c: return 'A confirmar'
    return REG.get(c, 'Demais regiões')
DEFAULT_UF = 'TODO'; UF_BY_CITY = {}
MAIN_DDDS = set()                                   # DDDs da área de atuação; outros são sinalizados
ADDR_PREFIX_RE = None

# ---- 4. DECISÕES VALIDADAS (chave = (Nome original, Cidade)) --------------------------------
NOMERGE = []; EXCL_WA = set(); FLAGS_BY_KEY = {}; FILL_PEOPLE = {}

def extra_clean(r, d):
    """Convenções textuais da planilha de origem (ex.: cidade inferida da busca). Pode ficar vazio."""
    pass

def source_fields(p, d, inf, vetted):
    """Define Etapa e limpa Insights/Motivo/Perfil. Padrão genérico abaixo; ajustar se a origem tiver convenções."""
    d['Insights da marca'] = p.get('Insights da marca')
    d['Motivo da qualificação'] = p.get('Motivo da qualificação')
    d['Perfil dos projetos'] = p.get('Perfil dos projetos')
    d['Etapa'] = 'Qualificado' if vetted else ('A revisar' if p.get('Perfil dos projetos') else 'Dados incompletos')
    d['_semsite'] = False
    if not p.get('Site'): inf.append('Sem site próprio')

# ---- 5. ESCORE (aderência ao que a empresa vende) -----------------------------------------------
TEXT_FIELDS_FULL = ['Tipo','Perfil dos projetos','Obras de referência','Mini bio','Insights da marca','Motivo da qualificação','Arquitetos responsáveis']
TEXT_FIELDS_NARROW = ['Tipo','Perfil dos projetos','Mini bio','Insights da marca','Motivo da qualificação']
FLAGS = {}       # {'sinal': ([regex sem acento, minúsculo], 'full'|'narrow')}  -> ver engine/scoring.py
DIMS = {'seg': 40, 'porte': 20, 'aderencia': 15, 'acesso': 15, 'evid': None, 'previa': None}   # pesos: validar com o usuário
RULES = []       # regras e pontos: ver docstring de engine/scoring.py
BANDS = [(60,'Alta'),(46,'Média-alta'),(30,'Média'),(0,'Baixa')]; INCOMPLETE_BAND = 'A qualificar'
PRIORITY_ORDER = ['Alta','Média-alta','Média','Baixa','A qualificar']
def motivo(tags, etapa):
    return '; '.join(tags).capitalize() if tags else 'Poucos dados para avaliar o encaixe'

# ---- 6. GANCHO (última coluna) -------------------------------------------------------------
HAND = {}        # {Nome: gancho} escrito à mão para a faixa Alta
def make_hook(r):
    raise NotImplementedError('TODO: modelo de gancho do segmento, só com fatos da base + argumentos aprovados da empresa')

# ---- 7. SAÍDA ------------------------------------------------------------------------------
COLUMNS = ['TODO']; LAST_COLUMN = 'TODO'; OUTPUT_LABELS = {}   # OUTPUT_LABELS troca rótulos (ex.: 'Arquitetos responsáveis' -> 'Responsáveis')
OUTPUT_NAME = 'TODO'; DICTIONARY = []
