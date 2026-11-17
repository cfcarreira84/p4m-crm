#!/usr/bin/env python3
"""Etapa 2: Coleta de metadados reais dos sites corporativos + filtro de concorrentes + classificação."""

import html
import json
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
import requests

BASE_DIR = Path(r"D:\OneDrive\Documentos\202609_Projetos\P4M")
OUT_DIR = BASE_DIR / "higienizado"
EMPRESAS_IN = OUT_DIR / "intermediario_empresas.json"
CACHE_OUT = OUT_DIR / "enriquecimento_cache.json"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
}

COMPETITOR_DOMAINS = {
    "adsplay.com.br", "criteo.com", "rtbhouse.com", "teads.com", "taboola.com",
    "outbrain.com", "seedtag.com", "sunmedia.tv", "adsmovil.com", "logan.com",
    "logan.com.br", "hands.com.br", "tail.digital", "navegg.com", "cadreon.com",
    "xaxis.com", "thetradedesk.com", "mediamath.com", "pubmatic.com", "magnite.com",
    "smartadserver.com", "equativ.com", "xandr.com", "adform.com", "sizmek.com",
    "flashtalking.com", "celtra.com", "bonzai.co", "undertone.com", "kargo.com",
    "triplelift.com", "gumgum.com", "yieldmo.com", "ogury.com", "blis.com",
    "inmobi.com", "appnexus.com", "dv360.com", "amobee.com", "verizonmedia.com",
    "quantcast.com", "simpli.fi", "stackadapt.com", "basis.com", "centro.net",
    "adroll.com", "nextroll.com", "rtb.com", "programatica.com.br", "dyad.com.br",
    "moblyze.com", "medialand.com.br", "adtail.com.br", "pmweb.com.br",
}

RE_COMPETITOR_TEXT = re.compile(
    r"\b(m[ií]dia program[aá]tica|programmatic media|programmatic advertising|demand[- ]side platform|"
    r"supply[- ]side platform|\bdsp\b|\bssp\b|ad\s?network|ad\s?exchange|trading desk|"
    r"adtech|ad tech|rich media platform|monetiza[çc][aã]o de invent[aá]rio)\b",
    re.I,
)

RE_AGENCY = re.compile(
    r"\b(ag[eê]ncia|agency|publicidade|propaganda|comunica[cç][aã]o|criativ[ao]|"
    r"branding|assessoria de imprensa|marketing digital|social media|performance|"
    r"m[ií]dia|media services|conteudo|conte[uú]do|full service|live marketing|eventos)\b",
    re.I,
)

AGENCY_DOMAINS_HINT = (
    "betc.com", "ogilvy.com", "dpz.com.br", "davidtheagency.com", "ampfy.com",
    "wppmediaservices.com.br", "ketchum.com.br", "rai.com.br", "fhpublicidade.com.br",
    "hoc.ag", "cmlo.co", "tagcom.com.br", "pullse.online", "almapbbdo.com.br",
    "africa.com.br", "dm9.com.br", "lew-lara.com.br", "fcb.com", "publicis.com",
    "havas.com", "dentsu.com", "ipg.com", "omnicom", "talentmarcel.com.br",
    "wundermanthompson.com", "vmlyr.com", "vml.com", "gut.agency", "sunocriacao.com.br",
)

GRANDE_MARCA_DOMAINS = (
    "telefonica.com", "vivo.com.br", "itau-unibanco.com.br", "itau.com.br",
    "bradesco.com.br", "santander.com.br", "bb.com.br", "caixa.gov.br",
    "ambev.com.br", "petrobras.com.br", "vale.com", "natura.net", "grupoboticario.com.br",
    "magazineluiza.com.br", "mercadolivre.com", "carrefour.com.br", "unilever.com",
    "nestle.com", "samsung.com", "google.com", "meta.com", "amazon.com",
    "microsoft.com", "ibm.com", "oracle.com", "sap.com", "fgv.br", "sescmg.com.br",
    "senac.br", "sebrae.com.br", "globo.com", "uol.com.br", "estadao.com.br",
    "folha.com.br", "abril.com.br", "sbt.com.br", "recordtv.com.br",
)

VERTICAL_RULES = [
    ("Agência de Publicidade / Comunicação", re.compile(r"\b(ag[eê]ncia|agency|publicidade|propaganda|branding|criativ|comunica[cç][aã]o)\b", re.I)),
    ("Imobiliário / Construção", re.compile(r"\b(imobili[aá]ri|construtora|incorporadora|im[oó]veis|engenharia|arquitetura)\b", re.I)),
    ("Saúde / Clínicas", re.compile(r"\b(sa[uú]de|cl[ií]nica|hospital|m[eé]dic|odonto|farm[aá]cia|laborat[oó]rio|est[eé]tica)\b", re.I)),
    ("Educação", re.compile(r"\b(educa[cç][aã]o|escola|faculdade|universidade|ensino|curso|fgv|senac)\b", re.I)),
    ("Serviços Financeiros", re.compile(r"\b(banco|financeir|cr[eé]dito|investimento|seguro|cons[oó]rcio|fintech|ita[uú]|bradesco)\b", re.I)),
    ("Tecnologia / Software", re.compile(r"\b(tecnologia|software|saas|ti\b|cloud|dados|sistemas|digital|intelig[eê]ncia artificial)\b", re.I)),
    ("Indústria / Manufatura", re.compile(r"\b(ind[uú]stria|industrial|f[aá]brica|manufatura|metal[uú]rgica|pl[aá]stico|embalagem)\b", re.I)),
    ("Agronegócio", re.compile(r"\b(agro|agr[ií]cola|fazenda|pecu[aá]ria|sementes|fertilizante)\b", re.I)),
    ("Varejo / E-commerce", re.compile(r"\b(varejo|loja|e-commerce|ecommerce|supermercado|shopping|moda|cal[çc]ados)\b", re.I)),
    ("Automotivo", re.compile(r"\b(automotivo|ve[ií]culo|concession[aá]ria|carro|moto|auto)\b", re.I)),
    ("Telecomunicações", re.compile(r"\b(telecom|telefonia|fibra|operadora|vivo|claro|tim)\b", re.I)),
]

RE_CITY_UF = re.compile(
    r"\b([A-ZÁÉÍÓÚÂÊÔÃÕÇ][a-záéíóúâêôãõç]+(?:\s+(?:d[aeo]s?\s+)?[A-ZÁÉÍÓÚÂÊÔÃÕÇ][a-záéíóúâêôãõç]+){0,3})\s*[-/(]\s*(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)\b"
)


def clean_html_text(s: str) -> str:
    if not s:
        return ""
    s = html.unescape(s)
    s = re.sub(r"<[^>]+>", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def fetch_site_meta(domain: str) -> dict:
    for url in (f"https://{domain}", f"https://www.{domain}"):
        try:
            r = requests.get(url, headers=HEADERS, timeout=5, allow_redirects=True)
            if r.status_code >= 400:
                continue
            if r.encoding and r.encoding.lower() in ("iso-8859-1", "latin-1"):
                r.encoding = r.apparent_encoding or "utf-8"
            text = r.text[:120000]
            t_m = re.search(r"<title[^>]*>(.*?)</title>", text, re.I | re.S)
            d_m = re.search(r'<meta[^>]+name=["\']description["\'][^>]+content=["\'](.*?)["\']', text, re.I | re.S)
            if not d_m:
                d_m = re.search(r'<meta[^>]+content=["\'](.*?)["\'][^>]+name=["\']description["\']', text, re.I | re.S)
            title = clean_html_text(t_m.group(1))[:160] if t_m else ""
            desc = clean_html_text(d_m.group(1))[:260] if d_m else ""
            return {"status": r.status_code, "final_url": r.url, "title": title, "desc": desc}
        except Exception:
            continue
    return {"status": 0, "final_url": "", "title": "", "desc": ""}


def extract_clean_name(domain: str, empresa_bruta: str, title: str) -> str:
    # Se o title tem separador limpo e curto no começo, ex: "Agência Newe | ..."
    if title:
        first_part = re.split(r"\s+[|\-–·:]\s+", title)[0].strip()
        if 2 <= len(first_part) <= 40 and not re.search(r"(home|in[ií]cio|bem[- ]vindo|welcome|403|404|error|cloudflare|just a moment)", first_part, re.I):
            return first_part
    if empresa_bruta and not re.search(r"(analista|assistente|gerente|diretor|coordenador)", empresa_bruta, re.I):
        if empresa_bruta.isupper() and len(empresa_bruta) > 5:
            return empresa_bruta.title()
        return empresa_bruta
    base = domain.split(".")[0].replace("-", " ").replace("_", " ").strip()
    return base.upper() if len(base) <= 4 else base.title()


def classify_company(emp: dict, meta: dict) -> dict:
    dom = emp["dominio"].lower()
    title = meta.get("title", "")
    desc = meta.get("desc", "")
    empresa_bruta = emp.get("empresa_bruta", "")
    combined = f"{dom} {empresa_bruta} {title} {desc}"

    # 1. Concorrente de Mídia Programática? (não desperdiçar esforço enriquecendo)
    is_conc = False
    motivo_conc = ""
    if dom in COMPETITOR_DOMAINS or any(dom.endswith("." + c) for c in COMPETITOR_DOMAINS):
        is_conc = True
        motivo_conc = "Domínio conhecido de Mídia Programática / AdTech"
    elif RE_COMPETITOR_TEXT.search(f"{title} {desc}"):
        # Evitar falso positivo se for apenas uma agência tradicional que cita "mídia"
        m = RE_COMPETITOR_TEXT.search(f"{title} {desc}")
        is_conc = True
        motivo_conc = f"Site indica atuação direta em mídia programática/adtech ({m.group(0)})"

    if is_conc:
        return {
            "dominio": dom,
            "is_concorrente": True,
            "motivo_concorrente": motivo_conc,
            "nome_mercado": "",
            "perfil": "",
            "vertical": "",
            "cidade": "",
            "uf": "",
            "mini_bio": "",
            "insights": "",
            "site_status": meta.get("status", 0),
        }

    # 2. Perfil: Agencia vs Grande_Marca vs PME_Direta
    if any(h in dom for h in AGENCY_DOMAINS_HINT) or RE_AGENCY.search(f"{dom} {empresa_bruta} {title}"):
        perfil = "Agencia"
    elif any(g in dom for g in GRANDE_MARCA_DOMAINS):
        perfil = "Grande_Marca"
    else:
        perfil = "PME_Direta"

    # 3. Vertical
    vertical = ""
    for v_name, v_pat in VERTICAL_RULES:
        if v_pat.search(combined):
            vertical = v_name
            break
    if not vertical:
        vertical = "Agência de Comunicação" if perfil == "Agencia" else "Empresa / Serviços B2B-B2C"

    # 4. Cidade / UF
    cidade, uf = emp.get("cidade_ddd", ""), emp.get("uf_ddd", "")
    m_loc = RE_CITY_UF.search(f"{title} {desc}")
    if m_loc:
        cidade, uf = m_loc.group(1).strip(), m_loc.group(2).strip()

    # 5. Nome limpo e Mini Bio factual
    nome_mercado = extract_clean_name(dom, empresa_bruta, title)
    mini_bio = desc if desc else (title if title and title.lower() != nome_mercado.lower() else "")

    if perfil == "Agencia":
        insights = "Agência: potencial parceria/terceirização de Rich Media (72h, 20 sensores), Programática em portais e LPs sem onerar equipe local."
    elif perfil == "Grande_Marca":
        insights = "Grande marca/instituição: presença em portais de alta credibilidade (Display, Native, Vídeo, Rich Media) e eficiência de verba."
    else:
        insights = "Empresa/PME direta: presença nos 71% do tempo conectado fora das redes sociais (portais) + atendimento P4m Flow IA em 5s no WhatsApp."

    return {
        "dominio": dom,
        "is_concorrente": False,
        "motivo_concorrente": "",
        "nome_mercado": nome_mercado,
        "perfil": perfil,
        "vertical": vertical,
        "cidade": cidade,
        "uf": uf,
        "mini_bio": mini_bio[:260],
        "insights": insights,
        "site_status": meta.get("status", 0),
    }


def main():
    empresas = json.loads(EMPRESAS_IN.read_text(encoding="utf-8"))
    cache = {}
    if CACHE_OUT.exists():
        cache = json.loads(CACHE_OUT.read_text(encoding="utf-8"))

    pendentes = [e for e in empresas if e["dominio"] not in cache]
    print(f"Total empresas: {len(empresas)} | Já em cache: {len(cache)} | Pendentes: {len(pendentes)}")

    if pendentes:
        done = 0
        with ThreadPoolExecutor(max_workers=24) as ex:
            future_map = {ex.submit(fetch_site_meta, e["dominio"]): e for e in pendentes}
            for fut in as_completed(future_map):
                emp = future_map[fut]
                try:
                    meta = fut.result()
                except Exception:
                    meta = {"status": 0, "final_url": "", "title": "", "desc": ""}
                cache[emp["dominio"]] = classify_company(emp, meta)
                done += 1
                if done % 150 == 0 or done == len(pendentes):
                    CACHE_OUT.write_text(json.dumps(cache, ensure_ascii=False, indent=2), encoding="utf-8")
                    print(f"Progresso: {done}/{len(pendentes)}")

    conc_total = sum(1 for v in cache.values() if v.get("is_concorrente"))
    ag_total = sum(1 for v in cache.values() if v.get("perfil") == "Agencia")
    gm_total = sum(1 for v in cache.values() if v.get("perfil") == "Grande_Marca")
    pme_total = sum(1 for v in cache.values() if v.get("perfil") == "PME_Direta")
    print(f"=== ETAPA 2 CONCLUÍDA === Total: {len(cache)} | Concorrentes: {conc_total} | Agencia: {ag_total} | Grande_Marca: {gm_total} | PME_Direta: {pme_total}")


if __name__ == "__main__":
    main()
