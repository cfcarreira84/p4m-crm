#!/usr/bin/env python3
"""Contrato de carga da base de leads: valida e mapeia o CSV enriquecido para o schema do Supabase.

    python tools/carga_base.py validar  ARQUIVO.csv [--saida preview.json] [--resolver-duplicados] [--excluir-sem-canal] [--origem NOME] [--perfil CLUSTER] [--contrato ARQUIVO.json]
    python tools/carga_base.py carregar ARQUIVO.csv [mesmas opções] [--confirmar]     (sem --confirmar só simula)
    python tools/carga_base.py lista    ARQUIVO.csv [mesmas opções] [--saida-csv LISTA.csv]    (lista completa para revisão, com o enriquecimento)
    python tools/carga_base.py desfazer ORIGEM [--confirmar]                          (remove a carga que ainda não foi trabalhada)

`validar` NÃO escreve no banco: confere o contrato (database/contrato.json), mostra o relatório e gera, se pedido, o JSON exato que será carregado.
`carregar` valida primeiro, compara com o que já existe no banco (não duplica nem sobrescreve) e só grava com --confirmar.
`desfazer` apaga apenas os leads da carga que continuam em "Aguardando Contato" (os já trabalhados ficam).
Somente biblioteca padrão. Usa a service key do database/.env.
Gravar (`--confirmar`) exige backup válido: `python tools/backup_banco.py criar` (veja o guard `exigir_backup`).

Código de saída: 0 = pode carregar; 1 = há erros que bloqueiam a carga.
"""
import csv
import fnmatch
import io
import json
import re
import sys
import unicodedata
import urllib.error
import urllib.request
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path
from urllib.parse import urlparse

RAIZ = Path(__file__).resolve().parent.parent
CAMINHO_CONTRATO_PADRAO = RAIZ / "database" / "contrato.json"
CAMINHO_CONFIG_PROJETO = RAIZ / "project.config.json"
HEADERS_PADRAO = {"User-Agent": "SDRCockpit-AdminCLI/2.0"}

# Colunas mínimas obrigatórias para qualquer base (aliases resolvidos via contrato.json)
CAMPOS_OBRIGATORIOS = (
    "nome_fantasia",
    "prioridade_carga",
    "pontuacao_carga",
    "qualificacao_carga",
    "cidade",
    "uf",
    "tipo",
    "gancho_final",
)

PRIORIDADES = {
    "Alta": "alta",
    "Média-alta": "media_alta",
    "Média": "media",
    "Baixa": "baixa",
    "A qualificar": "a_qualificar",
}
PRIORIDADE_ROTULO = {v: k for k, v in PRIORIDADES.items()}
ETAPAS = {
    "Qualificado": "qualificado",
    "A revisar": "a_revisar",
    "Dados incompletos": "dados_incompletos",
}
RE_MOVEL = re.compile(r"^\+55\d{10,11}$")
RE_FIXO = re.compile(r"^\+55\d{10}$")
RE_EMAIL_UNICO = re.compile(r"^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$")
RE_EMAIL_EXTRAIR = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+")
RE_NOME = re.compile(
    r"^[A-ZÁÉÍÓÚÂÊÔÃÕÇ][\wÀ-ÿ'’.-]+(\s+(d[aeo]s?|e)?\s*[A-ZÁÉÍÓÚÂÊÔÃÕÇ][\wÀ-ÿ'’.-]+){0,4}$"
)

PERFIL_FORCADO = None


def carregar_contrato(caminho: Path = None) -> dict:
    arq = caminho or CAMINHO_CONTRATO_PADRAO
    if arq.exists():
        return json.loads(arq.read_text(encoding="utf-8"))
    return {}


def carregar_config_projeto() -> dict:
    if CAMINHO_CONFIG_PROJETO.exists():
        try:
            return json.loads(CAMINHO_CONFIG_PROJETO.read_text(encoding="utf-8"))
        except Exception:
            return {}
    return {}


CONTRATO_ATIVO = carregar_contrato()
CONFIG_PROJETO = carregar_config_projeto()


def perfis_validos(contrato: dict = None, config_proj: dict = None) -> set:
    cfg = config_proj if config_proj is not None else CONFIG_PROJETO
    con = contrato if contrato is not None else CONTRATO_ATIVO
    perfis = {"B2B_Principal", "B2B_Secundario", "B2B_Parceiros", "B2B_Revenda"}
    for cat in cfg.get("categories", []):
        if cat.get("id"):
            perfis.add(cat["id"])
    if con.get("defaultCluster"):
        perfis.add(con["defaultCluster"])
    for rule in con.get("clusterRules", []):
        if rule.get("cluster"):
            perfis.add(rule["cluster"])
    return perfis


def resolver_coluna(cabecalhos: list, candidatos: list) -> str:
    """Encontra o primeiro cabeçalho do CSV que casa com a lista de candidatos (exato ou curinga *)."""
    for cand in candidatos:
        if "*" in cand:
            for h in cabecalhos:
                if fnmatch.fnmatchcase(h, cand) or fnmatch.fnmatchcase(h.lower(), cand.lower()):
                    return h
        else:
            for h in cabecalhos:
                if h == cand or h.lower() == cand.lower():
                    return h
    return None


def obter_valor(r: dict, campo: str, contrato: dict = None) -> str:
    con = contrato if contrato is not None else CONTRATO_ATIVO
    candidatos = con.get("columns", {}).get(campo, [campo])
    cabecalhos = list(r.keys())
    primeiro_val = ""
    for cand in candidatos:
        col = resolver_coluna(cabecalhos, [cand])
        if col and r.get(col) is not None:
            val = str(r[col]).strip()
            if val:
                return val
            if not primeiro_val:
                primeiro_val = val
    return primeiro_val


def extrair_dados_segmento(r: dict, contrato: dict = None) -> dict:
    con = contrato if contrato is not None else CONTRATO_ATIVO
    seg_cols = con.get("segmentColumns", {})
    out = {}
    for chave_json, candidatos in seg_cols.items():
        col = resolver_coluna(list(r.keys()), candidatos)
        if col and r.get(col) is not None:
            val = str(r[col]).strip()
            if val:
                out[chave_json] = val
    return out


def detectar_delimitador(texto_csv: str, contrato: dict = None) -> str:
    con = contrato if contrato is not None else CONTRATO_ATIVO
    delim_cfg = con.get("delimiter", "auto")
    if delim_cfg in (",", ";", "\t"):
        return delim_cfg
    primeira_linha = texto_csv.splitlines()[0] if texto_csv else ""
    if primeira_linha.count(";") > primeira_linha.count(","):
        return ";"
    return ","


def ler_csv_flexivel(caminho: Path, contrato: dict = None) -> tuple:
    texto = caminho.read_text(encoding="utf-8-sig")
    delim = detectar_delimitador(texto, contrato)
    leitor = csv.DictReader(io.StringIO(texto), delimiter=delim, strict=True)
    linhas = list(leitor)
    cabecalhos = list(leitor.fieldnames or [])
    return linhas, cabecalhos, delim


def digitos(v: str) -> str:
    return re.sub(r"\D", "", v or "")


def contato_responsavel(texto: str):
    """Primeiro nome próprio identificável do campo de responsáveis; None se não houver."""
    t = (texto or "").strip()
    if not t or re.match(r"^(equipe|n[aã]o|sem|canal de atendimento)\b", t, re.I):
        return None
    primeiro = re.split(r"\s*(?:;|\(|,| e )\s*", t)[0].strip()
    return primeiro if RE_NOME.match(primeiro) and " " in primeiro else None


def perfil(tipo: str, contrato: dict = None) -> str:
    if PERFIL_FORCADO:
        return PERFIL_FORCADO
    con = contrato if contrato is not None else CONTRATO_ATIVO
    t = (tipo or "").strip().lower()
    for regra in con.get("clusterRules", []):
        padrao = regra.get("match", "")
        if padrao and re.search(padrao, t, re.I):
            return regra["cluster"]
    return con.get("defaultCluster", "B2B_Principal")


def _extrair_emails_campo(valor_bruto: str) -> tuple:
    """Retorna (primeiro_email_valido, lista_demais_emails, sobra_nao_email)."""
    v = (valor_bruto or "").strip()
    if not v:
        return None, [], None
    achados = RE_EMAIL_EXTRAIR.findall(v)
    if not achados:
        return None, [], v
    unico = list(dict.fromkeys(e.lower().rstrip(".") for e in achados))
    # Se havia texto descritivo além de uma lista simples de e-mails
    limpo = re.sub(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+", "", v)
    limpo = re.sub(r"[,;|\s]+", " ", limpo).strip()
    sobra = v if (limpo and not re.fullmatch(r"[\s,;|/]+", limpo) and len(achados) == 1 and ":" in v) else None
    return unico[0], unico[1:], sobra


def _mapear_base(r: dict, origem: str, contrato: dict = None) -> dict:
    con = contrato if contrato is not None else CONTRATO_ATIVO
    zap_conf = digitos(obter_valor(r, "whatsapp_e164", con))
    cel = digitos(obter_valor(r, "celular_e164", con))
    whatsapp = zap_conf or cel or None

    site_val = obter_valor(r, "site", con)
    insta_val = obter_valor(r, "instagram", con)
    fontes = [
        {"titulo": t, "url": u}
        for t, u in (("Site", site_val), ("Instagram", insta_val))
        if u
    ]
    arg = obter_valor(r, "argumento_prioritario", con)
    obs_inicial = obter_valor(r, "observacao_dados", con)
    obs = [obs_inicial] if obs_inicial else []

    em1_bruto = obter_valor(r, "email_contato", con)
    em2_bruto = obter_valor(r, "email_parcerias", con)
    em1, extras1, sobra1 = _extrair_emails_campo(em1_bruto)
    em2, extras2, sobra2 = _extrair_emails_campo(em2_bruto if em2_bruto != em1_bruto else "")

    email_contato = em1
    email_parcerias = em2 if (em2 and em2 != em1) else (extras1[0] if extras1 else None)
    demais_emails = [e for e in (extras1 + extras2) if e not in (email_contato, email_parcerias)]
    if demais_emails:
        obs.append("E-mails adicionais: " + ", ".join(demais_emails))
    if sobra1 and sobra1 not in obs:
        obs.append(f"Contato: {sobra1}")
    if sobra2 and sobra2 not in obs and sobra2 != sobra1:
        obs.append(f"Canal: {sobra2}")

    endereco = obter_valor(r, "endereco", con)
    cep = obter_valor(r, "cep", con)
    if cep and cep not in endereco:
        endereco = f"{endereco} (CEP {cep})".strip()

    fixo = digitos(obter_valor(r, "telefone_fixo_e164", con)) or None
    tem_canal = bool(whatsapp or fixo or email_contato or email_parcerias or site_val or insta_val)
    if not tem_canal:
        obs.append("Sem nenhum canal de contato na base: localizar pelo nome e cidade")

    resp_bruto = obter_valor(r, "contato_responsavel", con)
    tipo_val = obter_valor(r, "tipo", con)
    perfil_proj = obter_valor(r, "perfil_projetos", con) or tipo_val
    obras_ref = obter_valor(r, "obras_referencia", con)
    mini_bio = obter_valor(r, "mini_bio", con)
    motivo_qual = obter_valor(r, "motivo_qualificacao", con)
    motivo_prio = obter_valor(r, "motivo_prioridade", con)
    insights = obter_valor(r, "insights", con)
    gancho_final = obter_valor(r, "gancho_final", con)
    gancho_abord = obter_valor(r, "gancho_abordagem", con)

    dados_seg = extrair_dados_segmento(r, con)

    return {
        "nome_fantasia": obter_valor(r, "nome_fantasia", con),
        "cluster_estrategico": perfil(tipo_val, con),
        "cidade": obter_valor(r, "cidade", con) or "Brasil",
        "uf": obter_valor(r, "uf", con) or None,
        "regiao_comercial": obter_valor(r, "regiao_comercial", con) or None,
        "endereco_completo": endereco or None,
        "whatsapp_disparo": whatsapp,
        "whatsapp_confirmado": True if zap_conf else (False if cel else None),
        "telefone_fixo": fixo,
        "email_contato": email_contato,
        "email_parcerias": email_parcerias,
        "website_original": site_val or None,
        "instagram_url": insta_val or None,
        "contato_responsavel": contato_responsavel(resp_bruto),
        "status_kanban": "aguardando_contato",
        "prioridade_carga": PRIORIDADES[obter_valor(r, "prioridade_carga", con)],
        "pontuacao_carga": int(obter_valor(r, "pontuacao_carga", con)),
        "qualificacao_carga": ETAPAS[obter_valor(r, "qualificacao_carga", con)],
        "observacao_dados": " | ".join(dict.fromkeys(x for x in obs if x)) or None,
        "origem_carga": origem,
        "dados_segmento": dados_seg,
        "pre_analise_scout": {
            "origem": f"carga:{origem}",
            "analise_ia": False,
            "status_presenca": perfil_proj,
            "perfil_projetos": perfil_proj,
            "obras_referencia": obras_ref,
            "mini_bio": mini_bio,
            "pontos_fortes": motivo_qual or motivo_prio,
            "pontos_fracos": "",
            "gargalo_critico": insights,
            "solucao_recomendada": f"Argumento prioritário: {arg}" if arg else "",
            "argumento_prioritario": arg,
            "gancho_kickoff_gerado": gancho_final,
            "gancho_abordagem": gancho_abord,
            "responsaveis": resp_bruto,
            "motivo_prioridade": motivo_prio,
            "fontes": fontes,
        },
    }


def enriquecer(r: dict, contrato: dict = None) -> dict:
    """Proposta e oportunidade a partir SOMENTE do que a pesquisa já registrou sobre o lead, guiado por database/contrato.json."""
    con = contrato if contrato is not None else CONTRATO_ATIVO
    enr = con.get("enrichment", {})
    sinais_cfg = enr.get("signals", {})
    perguntas_cfg = enr.get("questions", {})
    modelos_cfg = enr.get("models", {})
    regras_modelos = enr.get("modelRules", [])
    site_url = (enr.get("siteUrl") or "").rstrip("/")

    textos_busca = [
        obter_valor(r, "perfil_projetos", con),
        obter_valor(r, "motivo_prioridade", con),
        obter_valor(r, "motivo_qualificacao", con),
        obter_valor(r, "mini_bio", con),
        obter_valor(r, "obras_referencia", con),
        obter_valor(r, "insights", con),
    ]
    texto = " ".join(t for t in textos_busca if t)
    achados = {}
    for sinal, padrao in sinais_cfg.items():
        m = re.search(padrao, texto, re.I)
        if m:
            achados[sinal] = m.group(0).lower()

    arg = obter_valor(r, "argumento_prioritario", con)
    ordem = []

    def add(k):
        if k in modelos_cfg and k not in ordem:
            ordem.append(k)

    for regra in regras_modelos:
        req_any = regra.get("any", [])
        req_all = regra.get("all", [])
        req_not = regra.get("not", [])
        only_if_empty = regra.get("onlyIfEmpty", False)
        if only_if_empty and ordem:
            continue
        ok_any = (not req_any) or any(s in achados for s in req_any)
        ok_all = (not req_all) or all(s in achados for s in req_all)
        ok_not = not any(s in achados for s in req_not)
        if ok_any and ok_all and ok_not:
            for m_id in regra.get("add", []):
                add(m_id)

    modelos = ordem[:3]
    evid = list(achados.values())

    if modelos:
        partes_mod = []
        for k in modelos:
            info = modelos_cfg[k]
            nome_m = info[0] if isinstance(info, list) else info.get("name", k)
            slug_m = info[1] if isinstance(info, list) and len(info) > 1 else info.get("slug", "")
            if site_url and slug_m:
                partes_mod.append(f"{nome_m} ({site_url}/{slug_m.strip('/')}/)")
            else:
                partes_mod.append(nome_m)
        lista = "; ".join(partes_mod)
        proposta = f"Partir por {lista}. Motivo: a pesquisa registra {', '.join(evid[:4])}."
        if arg:
            proposta += f" Argumentos: {arg}."
    elif arg:
        sufixo_site = f" ({site_url})" if site_url else ""
        proposta = f"Abordar pelo argumento '{arg}' e validar o escopo na conversa{sufixo_site}."
    elif evid:
        proposta = f"Qualificar demanda com base nos sinais identificados ({', '.join(evid[:4])})."
    else:
        proposta = "Sem dados suficientes para elaborar proposta."

    perguntas = [perguntas_cfg[k] for k in sinais_cfg if k in achados and k in perguntas_cfg]
    oportunidade = ("Confirmar " + "; ".join(perguntas[:2]) + ".") if perguntas else ""
    nomes_modelos = [
        (modelos_cfg[k][0] if isinstance(modelos_cfg[k], list) else modelos_cfg[k].get("name", k))
        for k in modelos
    ]
    return {
        "gargalo_critico": oportunidade,
        "solucao_recomendada": proposta,
        "base": evid,
        "metodo": "regras_base",
        "modelos": nomes_modelos,
    }


def mapear(r: dict, origem: str, contrato: dict = None) -> dict:
    con = contrato if contrato is not None else CONTRATO_ATIVO
    lead = _mapear_base(r, origem, con)
    comp = enriquecer(r, con)
    comp["gerado_em"] = date.today().isoformat()
    lead["pre_analise_scout"]["analise_complementar"] = comp
    return lead


def validar_linha(r: dict, n: int, erros: list, avisos: list, contrato: dict = None):
    con = contrato if contrato is not None else CONTRATO_ATIVO
    nome = obter_valor(r, "nome_fantasia", con) or f"(linha {n})"

    def erro(msg):
        erros.append((n, nome, msg))

    def aviso(msg):
        avisos.append((n, nome, msg))

    if not obter_valor(r, "nome_fantasia", con):
        erro("Nome vazio")
    prio = obter_valor(r, "prioridade_carga", con)
    if prio not in PRIORIDADES:
        erro(f"Prioridade inválida: '{prio}'")
    etapa = obter_valor(r, "qualificacao_carga", con)
    if etapa not in ETAPAS:
        erro(f"Etapa inválida: '{etapa}'")
    pont_str = obter_valor(r, "pontuacao_carga", con)
    try:
        p = int(pont_str)
        if not 0 <= p <= 100:
            erro(f"Pontuação fora de 0 a 100: {p}")
    except ValueError:
        erro(f"Pontuação não numérica: '{pont_str}'")

    uf = obter_valor(r, "uf", con)
    if uf and not re.fullmatch(r"[A-Z]{2}", uf):
        erro(f"UF inválida: '{uf}'")

    for campo_tel, rotulo in (("whatsapp_e164", "WhatsApp E.164"), ("celular_e164", "Celular E.164")):
        v_tel = obter_valor(r, campo_tel, con)
        if v_tel and not RE_MOVEL.match(v_tel):
            erro(f"{rotulo} fora do padrão +55 DDD número: '{v_tel}'")

    v_fixo = obter_valor(r, "telefone_fixo_e164", con)
    if v_fixo and not RE_FIXO.match(v_fixo):
        erro(f"Telefone fixo fora do padrão: '{v_fixo}'")

    for campo_em, rotulo in (("email_contato", "E-mail principal"), ("email_parcerias", "E-mail secundário")):
        v_em = obter_valor(r, campo_em, con)
        if v_em and not RE_EMAIL_EXTRAIR.search(v_em):
            aviso(f"{rotulo} não contém um e-mail; o texto vai para a observação de dados: '{v_em[:60]}'")

    for campo_url, rotulo in (("site", "Site"), ("instagram", "Instagram")):
        v_url = obter_valor(r, campo_url, con)
        if v_url and (urlparse(v_url).scheme not in ("http", "https") or not urlparse(v_url).netloc):
            erro(f"{rotulo} não é uma URL http(s): '{v_url}'")

    regras_gancho = con.get("hookValidation", {})
    max_len = int(regras_gancho.get("maxLength", 600))
    exigir_2_blocos = bool(regras_gancho.get("requireTwoParagraphs", False))
    avisar_1_bloco = bool(regras_gancho.get("warnSingleParagraph", True))
    max_p1 = int(regras_gancho.get("firstParagraphMax", 330))
    padrao_robo = regras_gancho.get("forbiddenRobotPattern", r"pelo que vi|encontrei [^.\n:]{3,160}: ")
    padroes_proibidos = list(regras_gancho.get("forbiddenPatterns", []))
    termos_cfg = CONFIG_PROJETO.get("ai", {}).get("forbiddenTerms", [])

    g = obter_valor(r, "gancho_final", con)
    g_abord = obter_valor(r, "gancho_abordagem", con)
    if not g:
        erro("Gancho vazio")
    if len(g) > max_len:
        erro(f"Gancho com {len(g)} caracteres (máximo {max_len})")
    if "\n\n" not in g:
        if exigir_2_blocos:
            erro("Gancho em um bloco só: separe a descoberta da apresentação com uma linha em branco")
        elif avisar_1_bloco and g:
            aviso("Gancho em parágrafo único (válido para disparo compacto)")
    elif len(g.split("\n\n")[0]) > max_p1:
        aviso(f"Primeiro parágrafo do gancho com mais de {max_p1} caracteres: enxugue o que chamou atenção")

    if padrao_robo and re.search(padrao_robo, g, re.I):
        erro("Gancho repete o posicionamento do lead (\"encontrei X: <o que ele faz>\" ou \"pelo que vi\"): diga o que chamou atenção, em frase humana")
    if "[" in g or "]" in g:
        erro("Gancho com colchetes (marcador ou rascunho)")

    texto_ganchos = f"{g} {g_abord}".strip()
    for pat in padroes_proibidos:
        m = re.search(pat, texto_ganchos, re.I)
        if m:
            erro(f"Gancho com afirmação não permitida: '{m.group(0)}'")
            break
    for termo in termos_cfg:
        if termo and re.search(rf"\b{re.escape(termo)}\b", texto_ganchos, re.I):
            erro(f"Gancho cita termo proibido ('{termo}')")

    valores_aprovados = {v.replace(" ", "") for v in regras_gancho.get("approvedCurrencyValues", [])}
    for valor in re.findall(r"R\$\s?[\d.,]+(?:\s?mil)?", g):
        if valor.replace(" ", "") not in valores_aprovados:
            aviso(f"Gancho cita valor em reais ({valor}); confirme se está aprovado comercialmente")

    if not obter_valor(r, "mini_bio", con):
        aviso("Mini bio vazia")

    tem_movel = bool(obter_valor(r, "whatsapp_e164", con) or obter_valor(r, "celular_e164", con))
    outros = []
    if obter_valor(r, "telefone_fixo_e164", con):
        outros.append("telefone fixo")
    if RE_EMAIL_EXTRAIR.search(obter_valor(r, "email_contato", con)) or RE_EMAIL_EXTRAIR.search(obter_valor(r, "email_parcerias", con)):
        outros.append("e-mail")
    if obter_valor(r, "site", con):
        outros.append("site")
    if obter_valor(r, "instagram", con):
        outros.append("instagram")

    if not tem_movel and not outros:
        aviso("Sem nenhum canal de contato: localizar pelo nome e cidade")
    elif not tem_movel:
        aviso("Sem WhatsApp: contato manual por " + ", ".join(outros))

    resp_val = obter_valor(r, "contato_responsavel", con)
    if resp_val and not contato_responsavel(resp_val):
        aviso("Responsável não identificado como um nome próprio; o texto fica no dossiê")


ULTIMO = {}  # resultado da última validação (leads mapeados e origem), usado por `carregar`


def _validar(argv) -> int:
    caminho = Path(argv[2])
    saida = argv[argv.index("--saida") + 1] if "--saida" in argv else None
    resolver = "--resolver-duplicados" in argv
    sem_canal_fora = "--excluir-sem-canal" in argv
    fora_perfil_fora = "--excluir-fora-perfil" in argv
    origem = argv[argv.index("--origem") + 1] if "--origem" in argv else None
    caminho_contrato = Path(argv[argv.index("--contrato") + 1]) if "--contrato" in argv else None

    global CONTRATO_ATIVO, PERFIL_FORCADO
    if caminho_contrato:
        CONTRATO_ATIVO = carregar_contrato(caminho_contrato)
    else:
        CONTRATO_ATIVO = carregar_contrato()

    PERFIL_FORCADO = argv[argv.index("--perfil") + 1] if "--perfil" in argv else None
    validos = perfis_validos(CONTRATO_ATIVO, CONFIG_PROJETO)
    if PERFIL_FORCADO and PERFIL_FORCADO not in validos:
        print(f"[ERRO] --perfil inválido: {PERFIL_FORCADO}. Use um de: {', '.join(sorted(validos))}")
        return 1

    if not origem:
        d = re.search(r"\d{4}-\d{2}-\d{2}", caminho.name)
        prefixo = (
            re.sub(r"[^a-z0-9_]+", "_", PERFIL_FORCADO.lower())
            if PERFIL_FORCADO
            else CONTRATO_ATIVO.get("defaultOriginPrefix", "carga")
        )
        origem = f"{prefixo}_{d.group(0) if d else date.today().isoformat()}"

    linhas, cabecalhos, delim = ler_csv_flexivel(caminho, CONTRATO_ATIVO)
    faltando = []
    for campo_obrig in CAMPOS_OBRIGATORIOS:
        cands = CONTRATO_ATIVO.get("columns", {}).get(campo_obrig, [campo_obrig])
        if not resolver_coluna(cabecalhos, cands):
            faltando.append(f"{campo_obrig} (esperado: {' ou '.join(cands)})")
    if faltando:
        print("[ERRO] colunas obrigatórias ausentes no arquivo: " + ", ".join(faltando))
        return 1

    erros, avisos = [], []
    descartadas = set()
    for i, r in enumerate(linhas, start=2):
        etapa_bruta = obter_valor(r, "qualificacao_carga", CONTRATO_ATIVO)
        if fora_perfil_fora and etapa_bruta.lower().startswith("fora do perfil"):
            descartadas.add(i)
            avisos.append((i, obter_valor(r, "nome_fantasia", CONTRATO_ATIVO), f"Descartado por etapa ({etapa_bruta})"))
            continue
        validar_linha(r, i, erros, avisos, CONTRATO_ATIVO)

    # duplicidades: telefone móvel e nome+cidade
    chaves = defaultdict(list)
    for i, r in enumerate(linhas, start=2):
        if i in descartadas:
            continue
        z = digitos(obter_valor(r, "whatsapp_e164", CONTRATO_ATIVO)) or digitos(obter_valor(r, "celular_e164", CONTRATO_ATIVO))
        if z:
            chaves[("tel", z)].append(i)
        nome_k = re.sub(r"\s+", " ", obter_valor(r, "nome_fantasia", CONTRATO_ATIVO).lower())
        cid_k = obter_valor(r, "cidade", CONTRATO_ATIVO).lower()
        chaves[("nome", nome_k, cid_k)].append(i)

    dup = {k: v for k, v in chaves.items() if len(v) > 1}
    for k, idx in dup.items():
        rotulo = f"{'telefone' if k[0] == 'tel' else 'nome+cidade'} repetido nas linhas {idx}"
        if resolver:
            melhor = max(idx, key=lambda i: (int(obter_valor(linhas[i - 2], "pontuacao_carga", CONTRATO_ATIVO) or 0), -i))
            descartadas.update(i for i in idx if i != melhor)
            avisos.append((idx[0], obter_valor(linhas[idx[0] - 2], "nome_fantasia", CONTRATO_ATIVO), rotulo + f" (mantida a linha {melhor}, de maior pontuação)"))
        else:
            erros.append((idx[0], obter_valor(linhas[idx[0] - 2], "nome_fantasia", CONTRATO_ATIVO), rotulo + " (use --resolver-duplicados para manter a de maior pontuação)"))

    if sem_canal_fora:
        for n, nome, msg in avisos:
            if msg.startswith("Sem nenhum canal") and n not in descartadas:
                descartadas.add(n)

    hosts = Counter(
        urlparse(obter_valor(r, "site", CONTRATO_ATIVO)).netloc.lower().removeprefix("www.")
        for r in linhas
        if obter_valor(r, "site", CONTRATO_ATIVO)
    )
    for h, c in hosts.items():
        if h and c > 1:
            avisos.append((0, h, f"site repetido em {c} linhas"))

    ok = [i for i in range(2, len(linhas) + 2) if i not in descartadas and not any(e[0] == i for e in erros)]
    mapeadas = [mapear(linhas[i - 2], origem, CONTRATO_ATIVO) for i in ok] if not erros else []

    # ---- relatório
    print(f"Arquivo: {caminho.name} (delim='{delim}')  |  origem da carga: {origem}")
    print(f"Linhas: {len(linhas)}  |  descartadas: {len(descartadas)}  |  a carregar: {len(linhas) - len(descartadas)}\n")
    cont = lambda campo: Counter(obter_valor(r, campo, CONTRATO_ATIVO) or "(vazio)" for i, r in enumerate(linhas, start=2) if i not in descartadas)
    for rotulo, campo in (("Prioridade", "prioridade_carga"), ("Etapa", "qualificacao_carga"), ("Tipo", "tipo")):
        print(f"{rotulo}: " + "; ".join(f"{k} {v}" for k, v in cont(campo).most_common(8)))

    uteis = [r for i, r in enumerate(linhas, start=2) if i not in descartadas]
    movel = sum(1 for r in uteis if obter_valor(r, "whatsapp_e164", CONTRATO_ATIVO) or obter_valor(r, "celular_e164", CONTRATO_ATIVO))
    conf = sum(1 for r in uteis if obter_valor(r, "whatsapp_e164", CONTRATO_ATIVO))
    print(f"\nContato: {movel} com WhatsApp/celular ({conf} confirmados), {len(uteis) - movel} sem WhatsApp (busca manual)")
    fila = sum(
        1
        for r in uteis
        if obter_valor(r, "prioridade_carga", CONTRATO_ATIVO) in ("Alta", "Média-alta", "Média")
        and (obter_valor(r, "whatsapp_e164", CONTRATO_ATIVO) or obter_valor(r, "celular_e164", CONTRATO_ATIVO))
    )
    print(f"Fila de trabalho inicial (prioridade Alta, Média-alta ou Média, com celular): {fila}")
    print("Perfil no CRM: " + "; ".join(f"{k} {v}" for k, v in Counter(perfil(obter_valor(r, "tipo", CONTRATO_ATIVO), CONTRATO_ATIVO) for r in uteis).most_common()))
    print("Região: " + "; ".join(f"{k} {v}" for k, v in cont("regiao_comercial").most_common(8)))

    resumo = Counter(a[2].split(":")[0].split(" (")[0] if a[2].startswith("Sem WhatsApp") else a[2][:48] for a in avisos)
    print(f"\nAvisos ({len(avisos)}):")
    for k, v in resumo.most_common(8):
        print(f"  {v:4}  {k}")
    if erros:
        print(f"\nERROS ({len(erros)}), a carga está bloqueada:")
        for n, nome, msg in erros[:30]:
            print(f"  linha {n}: {nome} -> {msg}")
        if len(erros) > 30:
            print(f"  ... e mais {len(erros) - 30}")
        return 1
    print("\n[OK] contrato atendido: a base pode ser carregada.")
    ULTIMO.update({"mapeadas": mapeadas, "origem": origem})
    if saida:
        Path(saida).write_text(json.dumps(mapeadas, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"Prévia gravada em {saida} ({len(mapeadas)} leads).")
    return 0


# ----------------------------------------------------------------------------- banco (service key)
def carregar_env() -> dict:
    caminho = RAIZ / "database" / ".env"
    env = {}
    for linha in caminho.read_text(encoding="utf-8-sig").splitlines():
        linha = linha.strip()
        if linha and not linha.startswith("#") and "=" in linha:
            k, v = linha.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    if not env.get("SUPABASE_SERVICE_ROLE_KEY") and env.get("SUPABASE_SERVICE_KEY"):
        env["SUPABASE_SERVICE_ROLE_KEY"] = env["SUPABASE_SERVICE_KEY"]
    if not (env.get("SUPABASE_URL") and env.get("SUPABASE_SERVICE_ROLE_KEY")):
        raise SystemExit("[erro] SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY precisam estar no database/.env")
    return env


def rest(env, metodo, caminho, corpo=None, extra=None):
    chave = env["SUPABASE_SERVICE_ROLE_KEY"]
    req = urllib.request.Request(
        f"{env['SUPABASE_URL'].rstrip('/')}/rest/v1/{caminho}",
        method=metodo,
        data=json.dumps(corpo).encode("utf-8") if corpo is not None else None,
        headers={
            **HEADERS_PADRAO,
            "apikey": chave,
            "Authorization": f"Bearer {chave}",
            "Content-Type": "application/json",
            **(extra or {}),
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            bruto = r.read()
            return r.status, dict(r.headers), (json.loads(bruto) if bruto else None)
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"HTTP {e.code}: {e.read().decode('utf-8', 'replace')[:400]}")


def normalizar(texto: str) -> str:
    t = unicodedata.normalize("NFD", (texto or "").lower())
    return re.sub(r"[^a-z0-9]+", " ", "".join(c for c in t if unicodedata.category(c) != "Mn")).strip()


def listar_existentes(env):
    itens, passo, ini = [], 1000, 0
    while True:
        _, _, lote = rest(
            env,
            "GET",
            f"empresas_alvo?select=id,nome_fantasia,whatsapp_disparo,status_kanban,origem_carga&order=created_at&limit={passo}&offset={ini}",
        )
        itens += lote
        if len(lote) < passo:
            return itens
        ini += passo


def exigir_backup(env) -> bool:
    """Guard: nenhuma gravação no banco sem backup íntegro, recente (24 h) e igual ao estado atual."""
    import backup_banco
    pasta, motivo = backup_banco.backup_recente(env)
    if pasta is None:
        print(f"\n[parado] sem backup válido: {motivo}.")
        print('Rode primeiro:  python tools/backup_banco.py criar --motivo "antes da carga"')
        return False
    print(f"Backup válido: {pasta.name} (íntegro e igual ao banco atual).")
    return True


def cmd_carregar(argv) -> int:
    codigo = _validar(["x", "validar"] + argv[2:])
    if codigo != 0:
        print("\n[parado] corrija os erros do contrato antes de carregar.")
        return codigo
    leads, origem = ULTIMO["mapeadas"], ULTIMO["origem"]
    confirmar = "--confirmar" in argv
    env = carregar_env()
    existentes = listar_existentes(env)
    zaps = {e["whatsapp_disparo"]: e for e in existentes if e.get("whatsapp_disparo")}
    nomes = {normalizar(e["nome_fantasia"]): e for e in existentes}

    novos, pulados = [], []
    for l in leads:
        dup = zaps.get(l["whatsapp_disparo"]) if l["whatsapp_disparo"] else None
        motivo = "mesmo WhatsApp" if dup else None
        if not dup:
            dup = nomes.get(normalizar(l["nome_fantasia"]))
            motivo = "mesmo nome" if dup else None
        (pulados if dup else novos).append((l, dup, motivo))

    print(f"\n=== Plano da carga '{origem}' ===")
    print(f"No banco hoje: {len(existentes)} leads")
    print(f"A inserir: {len(novos)}  |  já existem (não serão tocados): {len(pulados)}")
    for l, dup, motivo in pulados[:30]:
        print(f"  - {l['nome_fantasia']}  ~  {dup['nome_fantasia']} ({motivo}, fase {dup['status_kanban']})")
    if len(pulados) > 30:
        print(f"  ... e mais {len(pulados) - 30} já existentes")
    sem_zap = sum(1 for l, _, _ in novos if not l["whatsapp_disparo"])
    print(f"Dos novos, sem WhatsApp (busca manual): {sem_zap}")
    if not confirmar:
        print("\nSIMULAÇÃO: nada foi gravado. Para gravar, repita o comando com --confirmar.")
        return 0

    if not exigir_backup(env):
        return 3
    gravados = 0
    for i in range(0, len(novos), 100):
        lote = [l for l, _, _ in novos[i : i + 100]]
        try:
            rest(env, "POST", "empresas_alvo", lote, {"Prefer": "return=minimal"})
        except RuntimeError as e:
            print(f"\n[ERRO] o lote que começa em {i} falhou: {e}")
            print(f"Gravados até aqui: {gravados}. Rode de novo: o que já entrou é reconhecido e não duplica.")
            return 1
        gravados += len(lote)
        print(f"  gravados {gravados}/{len(novos)}")
    _, cab, _ = rest(
        env,
        "GET",
        f"empresas_alvo?select=id&origem_carga=eq.{origem}",
        extra={"Prefer": "count=exact", "Range": "0-0"},
    )
    print(f"\n[OK] carga concluída. Leads com origem '{origem}' no banco: {cab.get('Content-Range', '?').split('/')[-1]}")
    return 0


def cmd_lista(argv) -> int:
    codigo = _validar(["x", "validar"] + argv[2:])
    if codigo != 0:
        return codigo
    leads = ULTIMO["mapeadas"]
    rank = {"alta": 5, "media_alta": 4, "media": 3, "a_qualificar": 2, "baixa": 1}
    leads = sorted(leads, key=lambda l: (-rank[l["prioridade_carga"]], -l["pontuacao_carga"], l["nome_fantasia"].lower()))
    destino = Path(argv[argv.index("--saida-csv") + 1]) if "--saida-csv" in argv else Path("lista_completa.csv")
    cab = [
        "#",
        "Nome",
        "Perfil no CRM",
        "Prioridade",
        "Pontuação",
        "Qualificação",
        "Região comercial",
        "Cidade",
        "WhatsApp",
        "Tipo do WhatsApp",
        "Telefone fixo",
        "E-mail",
        "Site",
        "Instagram",
        "Responsável",
        "Argumento prioritário",
        "Modelos sugeridos",
        "Proposta recomendada (regras da base)",
        "Oportunidade a validar",
        "Base da sugestão",
        "Observação de dados",
        "Primeira mensagem (gancho da base)",
    ]
    with destino.open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f, delimiter=";", quoting=csv.QUOTE_MINIMAL)
        w.writerow(cab)
        for i, l in enumerate(leads, 1):
            sc, c = l["pre_analise_scout"], l["pre_analise_scout"]["analise_complementar"]
            w.writerow([
                i,
                l["nome_fantasia"],
                l["cluster_estrategico"],
                PRIORIDADE_ROTULO[l["prioridade_carga"]],
                l["pontuacao_carga"],
                l["qualificacao_carga"].replace("_", " "),
                l["regiao_comercial"] or "",
                l["cidade"],
                l["whatsapp_disparo"] or "",
                {True: "confirmado", False: "provável", None: ""}[l["whatsapp_confirmado"]],
                l["telefone_fixo"] or "",
                l["email_contato"] or l["email_parcerias"] or "",
                l["website_original"] or "",
                l["instagram_url"] or "",
                l["contato_responsavel"] or sc.get("responsaveis", ""),
                sc.get("argumento_prioritario", ""),
                "; ".join(c["modelos"]),
                c["solucao_recomendada"],
                c["gargalo_critico"],
                "; ".join(c["base"]),
                l["observacao_dados"] or "",
                sc.get("gancho_kickoff_gerado", ""),
            ])
    print(f"\nLista completa: {len(leads)} leads gravados em {destino}")
    com_modelo = sum(1 for l in leads if l["pre_analise_scout"]["analise_complementar"]["modelos"])
    sem_dados = sum(
        1
        for l in leads
        if l["pre_analise_scout"]["analise_complementar"]["solucao_recomendada"].startswith("Sem dados suficientes")
    )
    so_arg = len(leads) - com_modelo - sem_dados
    print(f"Enriquecimento por regras: {com_modelo} com modelos sugeridos, {so_arg} com argumento/sinais, {sem_dados} sem dados suficientes para propor.")
    return 0


def cmd_desfazer(argv) -> int:
    if len(argv) < 3:
        print(__doc__)
        return 2
    origem, env = argv[2], carregar_env()
    base = f"empresas_alvo?origem_carga=eq.{origem}"
    _, c1, _ = rest(env, "GET", base + "&select=id", extra={"Prefer": "count=exact", "Range": "0-0"})
    _, c2, _ = rest(
        env,
        "GET",
        base + "&status_kanban=eq.aguardando_contato&select=id",
        extra={"Prefer": "count=exact", "Range": "0-0"},
    )
    total, intactos = c1.get("Content-Range", "?/?").split("/")[-1], c2.get("Content-Range", "?/?").split("/")[-1]
    print(
        f"Carga '{origem}': {total} leads; {intactos} ainda em Aguardando Contato (seriam removidos); os demais já foram trabalhados e ficam."
    )
    if "--confirmar" not in argv:
        print("SIMULAÇÃO: nada foi apagado. Repita com --confirmar para remover.")
        return 0
    if not exigir_backup(env):
        return 3
    rest(env, "DELETE", base + "&status_kanban=eq.aguardando_contato", extra={"Prefer": "return=minimal"})
    print("[OK] leads não trabalhados da carga removidos.")
    return 0


def main(argv) -> int:
    comandos = {"validar": _validar, "carregar": cmd_carregar, "lista": cmd_lista, "desfazer": cmd_desfazer}
    if len(argv) < 3 or argv[1] not in comandos:
        print(__doc__)
        return 2
    return comandos[argv[1]](argv)


if __name__ == "__main__":
    sys.exit(main(sys.argv))
